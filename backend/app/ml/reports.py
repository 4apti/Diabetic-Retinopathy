"""Phase 3 — structured clinical findings, evidence fusion and report NLG.

Triggered automatically once a Phase 2 ``ai_findings`` row is completed
(falling back to a text-only report when Grad-CAM cannot run). Everything is
persisted in ``screening_reports`` and regenerated only when the engine
signature (``model_version``) changes.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..models import AIFinding, ImageUpload, ScreeningReport
from .consistency import (
    CLASSIFIER_ONLY,
    CONSISTENT,
    FLAGGED,
    LOW_LESION_EVIDENCE,
)
from .gradcam import (
    generate_gradcam,
    region_notes_from_cam,
    report_dir,
)
from .registry import registry
from ..sync import enqueue_sync

logger = logging.getLogger("netrascan.reports")

# ---------------------------------------------------------------------------
# Fixed clinical terminology lookup (standard ICDR — not generated per case).
# ---------------------------------------------------------------------------
ICDR_LABELS = {
    0: "No DR",
    1: "Mild NPDR",
    2: "Moderate NPDR",
    3: "Severe NPDR",
    4: "Proliferative DR",
}

# ---------------------------------------------------------------------------
# Severity-appropriate next-step recommendations.
#
# Thresholds follow the International Clinical Diabetic Retinopathy (ICDR)
# severity scale and the American Academy of Ophthalmology Diabetic
# Retinopathy Preferred Practice Pattern (2019), which recommends:
#   No DR           -> repeat retinal exam in ~12 months
#   Mild NPDR       -> 6-12 months
#   Moderate NPDR   -> 6 months (closer follow-up; refer if worsening)
#   Severe NPDR     -> prompt referral to an ophthalmologist
#   Proliferative DR-> urgent ophthalmology referral
# ---------------------------------------------------------------------------
RECOMMENDATIONS = {
    0: "Routine follow-up: repeat a retinal screening in 12 months, and keep "
       "blood sugar, blood pressure and cholesterol well controlled.",
    1: "Routine follow-up: repeat a retinal screening within 6-12 months.",
    2: "Close follow-up: another retinal examination and a clinical consult "
       "within 6 months is advised.",
    3: "Prompt referral: please see an ophthalmologist within the next few "
       "weeks for a comprehensive dilated eye exam.",
    4: "Urgent referral: please see an ophthalmologist urgently, ideally "
       "within days, for evaluation and treatment.",
}

EMBEDDED_DISCLAIMER = (
    "IMPORTANT: This is an AI-generated screening aid, not a confirmed "
    "diagnosis. Please consult an ophthalmologist for clinical evaluation."
)

LOW_RAM_GRADCAM_FLOOR_MB = 1500  # keep the training process alive during Phase 2


def _gradcam_ram_floor_mb() -> int:
    """Overridable via NETRASCAN_RAM_FLOOR_MB (0 = always allow heatmaps)."""
    import os

    try:
        return int(os.environ.get("NETRASCAN_RAM_FLOOR_MB", LOW_RAM_GRADCAM_FLOOR_MB))
    except (TypeError, ValueError):
        return LOW_RAM_GRADCAM_FLOOR_MB


def _free_ram_mb() -> int:
    """Free physical RAM in MB on Windows (best-effort; 0 is never returned)."""
    try:
        import ctypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
        return int(stat.ullAvailPhys // (1024 * 1024))
    except Exception:  # noqa: BLE001 — non-Windows/ctypes-less: assume enough RAM
        return 4096


def model_signature(clf) -> str:
    """Short engine signature used to invalidate stale reports on re-analysis
    or after a checkpoint update."""
    if clf is None:
        return "unknown"
    meta = getattr(clf, "_meta", {}) or {}
    qwk = meta.get("validation_qwk")
    return f"efficientnet_b0_dr:{qwk if qwk is not None else 'na'}"


def build_structured_findings(finding: AIFinding) -> dict:
    """Restructure the Phase 2 ``ai_findings`` row into a clinician-readable
    object (no new AI — just organizing what already exists)."""
    try:
        lesion_raw = json.loads(finding.lesion_list or "[]")
    except json.JSONDecodeError:
        lesion_raw = []

    summary: dict[str, dict] = {}
    for item in lesion_raw:
        ltype = str(item.get("type", "unknown"))
        count = int(item.get("count", 0))
        entry = summary.setdefault(ltype, {"type": ltype, "count": 0, "avg_confidence": None})
        entry["count"] += count

    flagged_reason = None
    if finding.consistency_status == FLAGGED:
        flagged_reason = (
            "the predicted severity grade does not align with the detected "
            "lesion load — both engines should be reviewed together"
        )
    elif finding.consistency_status == LOW_LESION_EVIDENCE:
        flagged_reason = (
            "a moderate-or-higher grade was predicted even though the lesion "
            "detector found no lesions — possible detector miss"
        )
    elif finding.consistency_status == CLASSIFIER_ONLY:
        flagged_reason = (
            "only the severity classifier was available for this scan; "
            "no lesion detector ran"
        )

    return {
        "icdr_grade": int(finding.icdr_grade) if finding.icdr_grade is not None else None,
        "icdr_grade_label": ICDR_LABELS.get(int(finding.icdr_grade) if finding.icdr_grade is not None else -1, "Unknown"),
        "lesion_summary": sorted(summary.values(), key=lambda s: -s["count"]),
        "total_lesion_count": int(finding.lesion_count or 0),
        "consistency_status": finding.consistency_status,
        "flagged_reason": flagged_reason,
        "model_version": finding.model_version or "unknown",
    }


def build_evidence_fusion(
    image_id: str,
    structured: dict,
    gradcam_path: Optional[str],
    region_notes: Optional[str],
) -> dict:
    return {
        "image_id": image_id,
        "gradcam_path": gradcam_path,
        "structured_findings": structured,
        "region_notes": region_notes,
    }


def generate_report_text(
    patient_name: str,
    image_id: str,
    analyzed_at: Optional[datetime],
    structured: dict,
    region_notes: Optional[str],
) -> str:
    """Option A — deterministic template NLG. Patient-facing, plain language."""
    grade = structured["icdr_grade"]
    label = structured["icdr_grade_label"]
    summary = structured["lesion_summary"]
    consistency = structured["consistency_status"]
    total = structured["total_lesion_count"]
    flagged_reason = structured["flagged_reason"]

    lines: list[str] = []
    lines.append("NetraScan — AI Diabetic Retinopathy Screening Report")
    lines.append("")
    lines.append(
        f"Patient: {patient_name}   |   Scan: #{image_id[:8]}   |   "
        f"Analyzed on: {analyzed_at.strftime('%d %b %Y %H:%M') if analyzed_at else 'n/a'}"
    )
    lines.append("")

    # Severity summary
    if grade is None:
        lines.append("The severity of diabetic retinopathy could not be determined for this scan.")
    else:
        lines.append(f"Findings: This screening shows {label} (ICDR grade {grade}).")

    # Lesion load
    if total == 0:
        if consistency == CLASSIFIER_ONLY:
            lines.append("No lesion-detection engine was available, so no lesion counts are reported.")
        else:
            lines.append("No retinal lesions were detected by the lesion-detection engine.")
    else:
        parts = []
        for item in summary:
            if item["count"] <= 0:
                continue
            noun = item["type"].replace("_", " ")
            parts.append(f"{item['count']} {noun}{'s' if item['count'] != 1 else ''}")
        lines.append("The AI detected " + ", ".join(parts) + ".")

    # Where the model looked
    if region_notes:
        lines.append(f"The AI's attention was {region_notes}.")

    # Consistency / flag
    if consistency == CONSISTENT:
        lines.append("Both diagnostic engines agree on this grading.")
    elif consistency == FLAGGED:
        lines.append("This scan was flagged for review: " + (flagged_reason or "the engines disagree") + ".")
    elif consistency == LOW_LESION_EVIDENCE:
        lines.append("This scan was flagged for review: " + (flagged_reason or "lesion load is lower than the predicted grade") + ".")
    elif consistency == CLASSIFIER_ONLY:
        lines.append("Only one diagnostic engine was available for this scan, so clinical review is advised.")

    # Recommended next step
    rec = RECOMMENDATIONS.get(grade)
    if rec:
        lines.append("Recommended next step: " + rec)
    if consistency in (FLAGGED, LOW_LESION_EVIDENCE):
        lines.append("Because the engines did not fully agree, an ophthalmologist should review this result before acting on it.")

    lines.append("")
    lines.append(EMBEDDED_DISCLAIMER)
    return "\n".join(lines)


def ensure_report(
    db: Session,
    finding: AIFinding,
    *,
    allow_gradcam: bool = True,
    force: bool = False,
) -> Optional[ScreeningReport]:
    """Generate (or refresh) the report for a completed finding.

    Idempotent and cheap when nothing changed: any mismatch in ``model_version``
    between the finding and the stored report triggers a rebuild. Grad-CAM runs
    only when the weights are actually loaded and there is enough free RAM
    (so a live upload during training never OOMs the trainer).
    """
    if finding.icdr_grade is None or finding.analysis_status != "completed":
        return None

    current_sig = model_signature(registry.classifier)
    if finding.model_version is None:
        finding.model_version = current_sig if current_sig != "unknown" else "unknown"

    report = (
        db.query(ScreeningReport).filter(ScreeningReport.image_id == finding.image_id).first()
    )
    if report is not None and not force:
        stale = report.model_version != finding.model_version
        missing_heatmap = allow_gradcam and report.gradcam_path is None
        if not stale and not missing_heatmap:
            enqueue_sync(db, finding.image_id)  # Phase 4 — cover pre-Phase-4 rows
            return report  # cached report is current — don't regenerate
        # fall through: rebuild because the model changed or heatmap is missing

    upload = db.query(ImageUpload).filter(ImageUpload.image_id == finding.image_id).first()
    image_path = Path(upload.file_path) if upload and upload.file_path else None

    gradcam_path: Optional[str] = None
    cam = None
    if (
        allow_gradcam
        and registry.classifier is not None
        and image_path is not None
        and image_path.exists()
        and _free_ram_mb() >= _gradcam_ram_floor_mb()
    ):
        out = report_dir() / f"{finding.image_id}_gradcam.png"
        res = generate_gradcam(
            image_path,
            predicted_class=finding.icdr_grade,
            out_path=out,
            model=registry.classifier._model,
            ordinal=registry.classifier.ordinal,
            device="cpu",
        )
        gradcam_path = res.path
        if res.path is not None:
            cam = res.cam

    structured = build_structured_findings(finding)
    region_notes = region_notes_from_cam(cam)

    report_text = generate_report_text(
        patient_name=upload.patient.full_name if upload and upload.patient else "Patient",
        image_id=finding.image_id,
        analyzed_at=finding.analyzed_at,
        structured=structured,
        region_notes=region_notes,
    )

    if report is None:
        report = ScreeningReport(
            image_id=finding.image_id,
            report_text=report_text,
            structured_findings=json.dumps(structured),
            region_notes=region_notes,
            gradcam_path=gradcam_path,
            generation_method="template",
            model_version=finding.model_version,
            generated_at=datetime.utcnow(),
        )
        db.add(report)
    else:
        report.report_text = report_text
        report.structured_findings = json.dumps(structured)
        report.region_notes = region_notes
        report.gradcam_path = gradcam_path
        report.generation_method = "template"
        report.model_version = finding.model_version
        report.generated_at = datetime.utcnow()

    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001 — DB write must not break the request
        logger.warning("Could not persist report for %s: %s", finding.image_id, exc)
        db.rollback()

    # Phase 4 — a real report exists: it is now eligible for store-and-forward
    # sync into the telemedicine queue (idempotent).
    try:
        enqueue_sync(db, finding.image_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not enqueue %s for sync: %s", finding.image_id, exc)
    return report