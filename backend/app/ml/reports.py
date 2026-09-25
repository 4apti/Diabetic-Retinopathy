"""Phase 3 — structured clinical findings, evidence fusion and report NLG.

Triggered automatically once a Phase 2 ``ai_findings`` row is completed
(falling back to a text-only report when Grad-CAM cannot run). Everything is
persisted in ``screening_reports`` and regenerated only when the engine
signature (``model_version``) changes.

Since the Phase-4-A fix cycle the reports use a universal clinical layout:
fixed header snapshot (demographics frozen at generation time), a Findings body
with a full per-lesion-type breakdown (including explicit "0"), a highlighted
Observations section, a severity-appropriate Recommendation and a standardized
closing disclaimer. The region description (Fix 2) is computed from the real
Grad-CAM heatmap (thresholded + connected components against the optic-disc
reference), not a generic line.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
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
    analyze_heatmap_regions,
    generate_gradcam,
    report_dir,
)
from .registry import registry
from ..cases import ensure_case_tracking
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

# Every lesion class the detector can report. The report must name all of them,
# including explicit "0" counts (Fix 3), so it never reads as selective.
LESION_TYPES = ["microaneurysm", "hemorrhage", "hard_exudate", "soft_exudate"]
LESION_PRINT = {
    "microaneurysm": "Microaneurysms",
    "hemorrhage": "Hemorrhages",
    "hard_exudate": "Hard exudates",
    "soft_exudate": "Soft exudates / cotton-wool spots",
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

# Standardized closing disclaimer, identical on every report (Fix 4).
STANDARD_DISCLAIMER = (
    "This report has been generated through AI-assisted analysis (CNN severity "
    "classification and YOLOv8 lesion detection) of the submitted fundus image. "
    "It is intended as a screening aid and does not constitute a confirmed "
    "clinical diagnosis. Please consult a qualified ophthalmologist for "
    "clinical evaluation and management."
)

EMBEDDED_DISCLAIMER = STANDARD_DISCLAIMER  # kept as an alias for compat

# Hard-exudate load considered "heavy" for the macular-oedema risk note.
HEAVY_EXUDATE_COUNT = 8

LOW_RAM_GRADCAM_FLOOR_MB = 300  # heatmaps disabled only when RAM is critically low


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


def _lesion_entries(finding: AIFinding) -> list[dict]:
    """Parse the stored lesion list, tolerant of both {type,count} and the
    richer {type,count,boxes} format persisted since the Phase-4-A fix."""
    try:
        raw = json.loads(finding.lesion_list or "[]")
    except json.JSONDecodeError:
        raw = []
    entries: list[dict] = []
    for item in raw:
        ltype = str(item.get("type", "unknown"))
        boxes = item.get("boxes")
        if isinstance(boxes, list):
            count = len(boxes)
        else:
            count = int(item.get("count", 0))
            boxes = None
        entries.append({"type": ltype, "count": count, "boxes": boxes})
    return entries


def build_lesion_breakdown(entries: list[dict]) -> list[dict]:
    """Full per-lesion-type count, explicitly including types with zero
    detections (Fix 3 — the report reads complete, not selective)."""
    counts: dict[str, int] = defaultdict(int)
    for e in entries:
        counts[e["type"]] += e["count"]
    return [{"type": t, "count": counts.get(t, 0)} for t in LESION_TYPES]


def _grade_basis_note(
    grade: Optional[int],
    breakdown: list[dict],
    consistency: str,
) -> str:
    """Names the lesion types that actually drive the ICDR grade (Fix 3) —
    never letting an exudate count alone imply the severity. Venous beading and
    IRMA are part of ETDRS severe-NPDR staging but are NOT detectable by the
    current YOLOv8 lesion detector, and that limitation is stated honestly."""
    counts = {b["type"]: b["count"] for b in breakdown}
    ma = counts.get("microaneurysm", 0)
    he = counts.get("hemorrhage", 0)
    hexu = counts.get("hard_exudate", 0)
    sexu = counts.get("soft_exudate", 0)

    if grade is None:
        return "The severity grade could not be determined for this scan."

    if grade == 0:
        return (
            f"No microaneurysms or other retinopathy lesions were detected "
            f"(microaneurysms {ma}, hemorrhages {he}, hard exudates {hexu}, "
            f"soft exudates {sexu}), consistent with no DR."
        )
    if grade == 1:
        return (
            f"The mild grade is driven by the presence of microaneurysms ({ma}) — "
            f"the hallmark earliest lesion of non-proliferative DR in ICDR staging."
        )
    if grade == 2:
        drivers = []
        if he > 0:
            drivers.append(f"hemorrhages ({he})")
        if ma > 0:
            drivers.append(f"microaneurysms ({ma})")
        if not drivers:
            drivers = ["the combined lesion load shown below"]
        return (
            f"Per standard ICDR staging the moderate grade is driven by "
            f"{', '.join(drivers)} — not by exudates alone. Exudates ({hexu} hard, "
            f"{sexu} soft), when present, are a sign of lipid leakage rather than "
            f"the severity driver."
        )
    if grade == 3:
        return (
            f"The severe grade reflects extensive microaneurysm ({ma}) and "
            f"hemorrhage ({he}) load across the field. Venous beading and IRMA — "
            f"the other features of ETDRS severe-NPDR staging — cannot be detected "
            f"by the current lesion detector and must be assessed at the slit lamp."
        )
    return (
        f"The proliferative grade indicates suspected neovascularization, which "
        f"a fundus-photo lesion detector cannot confirm; an urgent clinical "
        f"assessment is required."
    )


def _assess_macular_edema(breakdown: list[dict], region: Optional[dict]) -> dict:
    """Separate, explicit macular-oedema risk signal (Fix 3) — distinct from the
    NPC severity grade. Evidence = heavy hard exudation AND either AI-attention
    hotspots in the macular zone or exudate boxes sitting within it."""
    counts = {b["type"]: b["count"] for b in breakdown}
    hexu = counts.get("hard_exudate", 0)
    if hexu < HEAVY_EXUDATE_COUNT:
        return {"possible_macular_edema": False, "macular_edema_note": None}

    region = region or {}
    macula_attention = bool(region.get("macula_attention"))
    near_macula = int(region.get("exudates_near_macula") or 0)
    evidence = macula_attention or near_macula >= max(3, int(0.3 * hexu))

    if evidence:
        basis = []
        if macula_attention:
            basis.append("the AI's attention is concentrated near the macula")
        if near_macula > 0:
            basis.append(f"{near_macula} of {hexu} hard exudates sit in the macular zone")
        return {
            "possible_macular_edema": True,
            "macular_edema_note": (
                f"Hard exudates are heavy ({hexu}) and {', and '.join(basis)}. "
                f"Clinically significant macular edema should be assessed "
                f"separately from the NPDR severity grade."
            ),
        }
    return {
        "possible_macular_edema": True,
        "macular_edema_note": (
            f"Hard exudate load is heavy ({hexu}). Though the AI attention is not "
            f"centered on the macula, a clinical check for possible macular edema "
            f"is advisable given the exudate load."
        ),
    }


def build_observations(
    grade,
    label,
    breakdown: list[dict],
    consistency: str,
    flagged_reason: Optional[str],
    macula: dict,
    region: Optional[dict],
) -> list[str]:
    """Plain-language abnormal-findings list for the highlighted Observations
    block shared by the patient and clinical layouts."""
    counts = {b["type"]: b["count"] for b in breakdown}

    def _counted(n: int, noun: str) -> str:
        return f"{n} {noun}" + ("" if n == 1 else "s")

    obs: list[str] = []
    if grade is not None and grade > 0:
        obs.append(
            f"{label} (ICDR grade {grade}) was detected — "
            f"{_counted(counts.get('microaneurysm', 0), 'microaneurysm')}, "
            f"{_counted(counts.get('hemorrhage', 0), 'hemorrhage')}, "
            f"{_counted(counts.get('hard_exudate', 0), 'hard exudate')} and "
            f"{_counted(counts.get('soft_exudate', 0), 'soft exudate')}."
        )
    elif grade == 0:
        obs.append("No signs of diabetic retinopathy were detected in this scan.")

    if macula.get("possible_macular_edema") and macula.get("macular_edema_note"):
        obs.append(macula["macular_edema_note"])

    if region and region.get("macula_attention"):
        obs.append("The AI's attention is concentrated near the macular region.")

    if consistency == FLAGGED:
        obs.append(
            "Both engines did not fully agree on this scan — it has been flagged "
            "for human review."
        )
    elif consistency == LOW_LESION_EVIDENCE:
        obs.append(
            "A moderate-or-higher severity was predicted despite few or no "
            "lesions detected — possible detector miss, clinical review advised."
        )
    elif consistency == CLASSIFIER_ONLY:
        obs.append(
            "Only the severity classifier was available for this scan; no lesion "
            "detector ran."
        )

    if not obs:
        obs.append("No abnormal findings of note were detected.")
    return obs


def build_structured_findings(
    finding: AIFinding,
    region: Optional[dict] = None,
) -> dict:
    """Restructure the Phase 2 ``ai_findings`` row into a clinician-readable
    object (no new AI — just organizing what already exists). Since the Phase
    4-A fix this includes the full lesion breakdown, the grade driver statement,
    the macular-oedema risk and the computed heatmap region analysis."""
    entries = _lesion_entries(finding)
    breakdown = build_lesion_breakdown(entries)
    total = sum(b["count"] for b in breakdown)

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

    grade = int(finding.icdr_grade) if finding.icdr_grade is not None else None
    label = ICDR_LABELS.get(grade, "Unknown") if grade is not None else "Unknown"
    macula = _assess_macular_edema(breakdown, region)

    summary = sorted(
        (b for b in breakdown if b["count"] > 0), key=lambda s: -s["count"]
    )
    observations = build_observations(
        grade,
        label,
        breakdown,
        finding.consistency_status,
        flagged_reason,
        macula,
        region,
    )

    rec = RECOMMENDATIONS.get(grade, "")
    if macula["possible_macular_edema"]:
        rec += (
            " Given the possible macular-edema risk, an optical coherence "
            "tomography (OCT) assessment is advisable as part of the follow-up."
        )
    if finding.consistency_status in (FLAGGED, LOW_LESION_EVIDENCE):
        rec += (
            " Because the two engines did not fully agree, an ophthalmologist "
            "should review this result before acting on it."
        )

    return {
        "icdr_grade": grade,
        "icdr_grade_label": label,
        "lesion_breakdown": breakdown,
        "lesion_summary": summary,
        "total_lesion_count": total,
        "consistency_status": finding.consistency_status,
        "flagged_reason": flagged_reason,
        "model_version": finding.model_version or "unknown",
        "grade_basis": _grade_basis_note(
            grade, breakdown, finding.consistency_status
        ),
        "possible_macular_edema": macula["possible_macular_edema"],
        "macular_edema_note": macula["macular_edema_note"],
        "region_analysis": region if region is not None else None,
        "region_notes": (region or {}).get("description"),
        "observations": observations,
        "recommendation": rec,
        "disclaimer": STANDARD_DISCLAIMER,
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
    header: dict,
) -> str:
    """Deterministic template NLG. Patient-facing, plain language, but in the
    same universal layout (header / findings / observations / recommendation /
    disclaimer) as the clinical view (Fix 4)."""
    grade = structured["icdr_grade"]
    label = structured["icdr_grade_label"]
    consistency = structured["consistency_status"]
    breakdown = structured["lesion_breakdown"]
    counts = {b["type"]: b["count"] for b in breakdown}
    region_notes = structured["region_notes"]
    observations = structured["observations"]
    rec = structured["recommendation"]
    disclaimer = structured["disclaimer"]

    lines: list[str] = []
    lines.append("NetraScan — AI Diabetic Retinopathy Screening Report")
    lines.append("")
    lines.append(
        f"Patient: {header.get('patient_name') or patient_name}"
        f"{'  |  Age: ' + str(header.get('patient_age')) if header.get('patient_age') is not None else ''}"
        f"{'  |  Gender: ' + header.get('patient_gender') if header.get('patient_gender') else ''}"
    )
    lines.append(
        f"Patient ID: {header.get('patient_id') or '—'}   |   Scan ID: #{image_id[:8]}"
    )
    lines.append(
        f"Date of scan: {header.get('scan_date') or (analyzed_at.strftime('%d %b %Y') if analyzed_at else '—')}"
    )
    lines.append(
        f"Referring PHC / ASHA worker: {header.get('referring_phc') or '—'} / "
        f"{header.get('submitting_worker') or '—'}"
    )
    lines.append(f"Eye: {header.get('eye_laterality') or 'Not captured'}")
    lines.append("")

    # Body — Findings
    lines.append("FINDINGS")
    if grade is None:
        lines.append(
            "• Severity: the degree of diabetic retinopathy could not be "
            "determined for this scan."
        )
    else:
        lines.append(
            f"• Severity: {label} (ICDR grade {grade}) [{consistency}]"
        )
    for t in LESION_TYPES:
        lines.append(f"• {LESION_PRINT[t]}: {counts.get(t, 0)}")
    if region_notes:
        lines.append(f"• Region of AI attention: {region_notes}.")
    lines.append(f"• Basis for the grade: {structured['grade_basis']}")

    # Observations — highlighted in the UI; plain block in the text.
    lines.append("")
    lines.append("OBSERVATIONS")
    for item in observations:
        lines.append(f"• {item}")

    # Recommendation
    lines.append("")
    lines.append("RECOMMENDATION")
    lines.append(rec if rec else "An ophthalmology review is advised.")

    # Standardized closing disclaimer
    lines.append("")
    lines.append("DISCLAIMER")
    lines.append(disclaimer)
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

    # Fix 2 — region description from the real heatmap (thresholded clusters vs
    # the optic-disc reference), including per-type lesion-box overlap.
    lesion_boxes = {
        e["type"]: e["boxes"]
        for e in _lesion_entries(finding)
        if e.get("boxes") and e["type"] in LESION_TYPES
    }
    region = None
    if cam is not None:
        from .gradcam import analyze_heatmap_regions  # local to keep imports light

        analysis = analyze_heatmap_regions(
            cam,
            image_path=image_path,
            lesion_boxes=lesion_boxes,
            size=380,
        )
        if analysis is not None:
            region = {
                "cluster_count": analysis.cluster_count,
                "used_optic_disc": analysis.used_optic_disc,
                "disc": analysis.disc,
                "clusters": analysis.clusters,
                "description": analysis.description,
                "macula_attention": analysis.macula_attention,
                "exudates_near_macula": analysis.exudates_near_macula,
                "spread_evenly": analysis.spread_evenly,
            }
    elif image_path is not None and image_path.exists():
        # No heatmap (RAM floor / classifier offline): keep the hamlet null so
        # the report clearly shows "region analysis unavailable".
        region = None
    region_notes = (region or {}).get("description")

    # Universal report header — demographics snapshot at generation time so the
    # report never changes when the patient profile is edited later (Fix 4).
    patient = upload.patient if upload is not None else None
    worker = upload.uploaded_by_user if upload is not None else None
    header = {
        "patient_id": patient.id if patient is not None else None,
        "patient_name": patient.full_name if patient is not None else None,
        "patient_age": patient.age if patient is not None else None,
        "patient_gender": patient.gender if patient is not None else None,
        "referring_phc": (
            ", ".join(filter(None, [patient.village, patient.district]))
            if patient is not None and (patient.village or patient.district)
            else None
        ),
        "submitting_worker": worker.full_name if worker is not None else None,
        "scan_date": (upload.uploaded_at if upload is not None else None),
        "eye_laterality": None,  # OD/OS is not captured by the Phase 1 flow yet
    }

    structured = build_structured_findings(finding, region=region)

    report_text = generate_report_text(
        patient_name=header["patient_name"] or "Patient",
        image_id=finding.image_id,
        analyzed_at=finding.analyzed_at,
        structured=structured,
        header=header,
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
            patient_id=header["patient_id"],
            patient_name=header["patient_name"],
            patient_age=header["patient_age"],
            patient_gender=header["patient_gender"],
            referring_phc=header["referring_phc"],
            submitting_worker=header["submitting_worker"],
            scan_date=header["scan_date"],
            eye_laterality=header["eye_laterality"],
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
        report.patient_id = header["patient_id"]
        report.patient_name = header["patient_name"]
        report.patient_age = header["patient_age"]
        report.patient_gender = header["patient_gender"]
        report.referring_phc = header["referring_phc"]
        report.submitting_worker = header["submitting_worker"]
        report.scan_date = header["scan_date"]
        report.eye_laterality = header["eye_laterality"]

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

    # Phase 4 Part A — the report existing means the case is trackable. Create
    # (or refresh) the case_tracking row with its severity band.
    try:
        ensure_case_tracking(db, finding)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not create case tracking for %s: %s", finding.image_id, exc)
    return report