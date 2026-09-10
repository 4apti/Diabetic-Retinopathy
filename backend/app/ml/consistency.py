"""Dual-engine consistency check.

Maps YOLOv8 lesion output (type + count) to a rough expected severity band,
compares it against the EfficientNet-B0 predicted ICDR grade, and reports
whether the two engines agree.
"""

from __future__ import annotations

from typing import Optional

LESION_WEIGHTS = {
    "microaneurysm": 0.5,
    "hemorrhage": 1.5,
    "hard_exudate": 1.2,
    "soft_exudate": 1.5,
}


def lesion_severity_band(lesion_counts: dict[str, int]) -> tuple[int, int]:
    """Rough expected ICDR band [low, high] derived from lesion load."""
    score = 0.0
    for label, count in lesion_counts.items():
        score += LESION_WEIGHTS.get(label, 1.0) * count

    if score <= 0:
        return 0, 0
    if score <= 2:
        return 0, 1
    if score <= 5:
        return 1, 2
    if score <= 9:
        return 2, 3
    return 3, 4


def check_consistency(
    lesion_counts: dict[str, int],
    classifier_grade: Optional[int],
) -> str:
    """Return 'Consistent' or 'Flagged for Review'."""
    if classifier_grade is None:
        return "Flagged for Review"

    low, high = lesion_severity_band(lesion_counts)

    # No lesions but a moderate+ grading is suspicious; heavy lesion load with
    # a no-DR grading is also suspicious.
    if low <= classifier_grade <= high:
        return "Consistent"
    return "Flagged for Review"