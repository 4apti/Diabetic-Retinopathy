"""Phase 3 — real Grad-CAM explainability for the trained EfficientNet-B0.

Computes a gradient-weighted class-activation map against the actual Phase 2
checkpoint (``efficientnet_b0_dr.pt``) via manual forward/backward hooks on the
last convolutional block (``features[-1]`` in the torchvision implementation).
No placeholder/canned visualizations: the heatmap reflects the gradients of the
model's own decision.

Two classifier variants are supported, matching Phase 2's ``classifier.py``:
  * 5-class head (``out_features == 5``): target = the predicted class score.
  * ordinal-regression head (``out_features == 1``): there is no discrete class,
    so the raw scalar output is used as the backprop target. The heatmap then
    means "regions driving the severity score upward", NOT "regions driving
    class N" — this semantic difference is intentional and documented.

Every failure path (OOM, hook mismatch, corrupt checkpoint) returns ``None`` so
the rest of the pipeline (structured findings + text report) proceeds and the
UI shows "Heatmap unavailable" rather than blocking the report.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from ..config import settings
from .preprocessing import preprocess_image, preprocess_image_display

logger = logging.getLogger("netrascan.gradcam")

# CAM overlay blend factor (higher = more heatmap, less fundus underneath).
OVERLAY_ALPHA = 0.45


@dataclass
class GradcamResult:
    path: Optional[str]  # saved PNG path, or None when computation failed
    cam: Optional[np.ndarray]  # normalized 2-D CAM at input resolution (for region notes)


def _load_classifier_model():
    """Reuse the checkpoint loader so Grad-CAM sees the exact same model class
    and weights as /analyze."""
    from .classifier import DRClassifier

    clf = DRClassifier().load()
    return clf._model, clf.ordinal


def generate_gradcam(
    image_path: Path,
    predicted_class: Optional[int],
    out_path: Path,
    size: int = 380,
    model=None,
    ordinal: bool = False,
    device: str = "cpu",
) -> GradcamResult:
    """Compute and save the Grad-CAM overlay for a single fundus image.

    ``model`` may be passed in to reuse an already-loaded instance (the
    registry keeps one resident); when None the checkpoint is loaded once.
    """
    if model is None:
        model, ordinal = _load_classifier_model()

    import cv2
    import torch
    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    tensor = preprocess_image(image, size=size)  # CHW, normalized — what the model sees
    display = preprocess_image_display(image, size=size)  # HWC uint8 — overlay base

    try:
        x = torch.from_numpy(tensor).unsqueeze(0).to(device)
        x.requires_grad_(True)

        activations: dict = {}
        gradients: dict = {}

        def fwd_hook(_mod, _inp, out):
            activations["a"] = out

        def bwd_hook(_mod, _ginp, gout):
            gradients["g"] = gout[0]

        target = model.features[-1]
        fwd_handle = target.register_forward_hook(fwd_hook)
        bwd_handle = target.register_full_backward_hook(bwd_hook)

        logits = model(x)

        if ordinal:
            # Single scalar head: backprop from the severity score itself.
            score = logits[0, 0]
        elif predicted_class is not None:
            score = logits[0, predicted_class]
        else:
            score = logits[0, int(torch.argmax(logits[0]))]

        model.zero_grad()
        score.backward()
        fwd_handle.remove()
        bwd_handle.remove()

        act = activations["a"].detach()
        grad = gradients["g"].detach()
        weights = grad.mean(dim=(2, 3), keepdim=True)  # alpha_c
        cam = torch.relu((weights * act).sum(dim=1))  # (1, H, W)
        cam = cam.squeeze(0).cpu().numpy().astype(np.float32)
        cam = cam - cam.min()
        denom = cam.max()
        cam = cam / denom if denom > 1e-8 else cam

        cam = cv2.resize(cam, (size, size), interpolation=cv2.INTER_LINEAR)

        heat = cv2.applyColorMap((cam * 255).astype(np.uint8), cv2.COLORMAP_JET)  # BGR
        base = cv2.cvtColor(display, cv2.COLOR_RGB2BGR)
        overlay = cv2.addWeighted(base, 1.0 - OVERLAY_ALPHA, heat, OVERLAY_ALPHA, 0)

        out_path.parent.mkdir(parents=True, exist_ok=True)
        ok = cv2.imwrite(str(out_path), overlay)
        if not ok:
            logger.warning("Grad-CAM: cv2.imwrite returned False for %s", out_path)
            return GradcamResult(path=None, cam=cam)

        logger.info("Grad-CAM saved -> %s (class %s, ordinal=%s)", out_path, predicted_class, ordinal)
        return GradcamResult(path=str(out_path), cam=cam)

    except Exception as exc:  # noqa: BLE001 — OOM/hook mismatch must not block the report
        logger.warning("Grad-CAM failed for %s: %s", image_path, exc)
        return GradcamResult(path=None, cam=None)
    finally:
        try:
            fwd_handle.remove()
        except Exception:
            pass
        try:
            bwd_handle.remove()
        except Exception:
            pass


QUADRANT_LABELS = {
    "TL": "upper-left region of the image",
    "TR": "upper-right region of the image",
    "BL": "lower-left region of the image",
    "BR": "lower-right region of the image",
}


def region_notes_from_cam(cam: Optional[np.ndarray]) -> Optional[str]:
    """Coarse, image-relative quadrant activation (no laterality is recorded in
    Phase 1's capture flow, so we cannot claim anatomical terms like
    'superior-temporal' — see README / admin Model Info)."""
    if cam is None:
        return None
    h, w = cam.shape
    hh, hw = h // 2, w // 2
    quads = {
        "TL": float(cam[:hh, :hw].sum()),
        "TR": float(cam[:hh, hw:].sum()),
        "BL": float(cam[hh:, :hw].sum()),
        "BR": float(cam[hh:, hw:].sum()),
    }
    total = cam.sum()
    if total <= 0:
        return None
    dominant = max(quads, key=quads.get)
    share = quads[dominant] / total
    label = QUADRANT_LABELS[dominant]
    if share >= 0.60:
        return f"concentrated in the {label}"
    if share >= 0.45:
        return f"most active in the {label}"
    return "spread across the image, with no single dominant region"


def report_dir() -> Path:
    return settings.upload_dir / "reports"