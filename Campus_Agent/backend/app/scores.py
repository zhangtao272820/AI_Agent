"""Subject scores: class / study gains (deterministic)."""

from __future__ import annotations

from typing import Any

from . import catalog

SUBJECT_IDS = ("chinese", "math", "english", "science")


def empty_scores() -> dict[str, float]:
    return {s: 0.0 for s in SUBJECT_IDS}


def initial_scores(grade_tier: str) -> dict[str, float]:
    table = catalog.subjects_catalog().get("grade_tier_initial") or {}
    base = table.get(grade_tier) or table.get("mid") or {}
    out = empty_scores()
    for sid in SUBJECT_IDS:
        out[sid] = float(base.get(sid, 90))
    return out


def subject_max(subject_id: str) -> float:
    for s in catalog.subjects_catalog().get("subjects") or []:
        if s["id"] == subject_id:
            return float(s["max"])
    return 150.0


def total_score(scores: dict[str, float]) -> float:
    return sum(float(scores.get(s, 0)) for s in SUBJECT_IDS)


def _learn_ability(grade_tier: str) -> int:
    for g in catalog.personality_catalog().get("grade_tiers") or []:
        if g["id"] == grade_tier:
            return int(g.get("learn_ability", 3))
    return 3


def _clamp_subject(scores: dict[str, float], subject_id: str) -> None:
    mx = subject_max(subject_id)
    scores[subject_id] = round(min(mx, max(0.0, float(scores[subject_id]))), 1)


def apply_class_gain(
    scores: dict[str, float],
    *,
    subject_id: str,
    grade_tier: str,
    study_mult: float = 1.0,
) -> float:
    cfg = catalog.subjects_catalog().get("class_gain") or {}
    base = float(cfg.get("base", 1.2))
    factor = float(cfg.get("learn_ability_factor", 0.35))
    gain = (base + _learn_ability(grade_tier) * factor) * study_mult
    scores[subject_id] = float(scores.get(subject_id, 0)) + gain
    _clamp_subject(scores, subject_id)
    return gain


def apply_study_gain(
    scores: dict[str, float],
    *,
    subject_id: str,
    grade_tier: str,
    at_library: bool = False,
    study_mult: float = 1.0,
) -> float:
    cfg = catalog.subjects_catalog().get("study_gain") or {}
    base = float(cfg.get("base", 0.8))
    factor = float(cfg.get("learn_ability_factor", 0.3))
    bonus = float(cfg.get("library_bonus", 0.25)) if at_library else 0.0
    gain = (base + _learn_ability(grade_tier) * factor + bonus) * study_mult
    scores[subject_id] = float(scores.get(subject_id, 0)) + gain
    _clamp_subject(scores, subject_id)
    return gain


def mock_exam_snapshot(all_scores: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    """Rank by total; all_scores: student_id → scores."""
    rows = []
    for sid, sc in all_scores.items():
        rows.append({"student_id": sid, "scores": dict(sc), "total": total_score(sc)})
    rows.sort(key=lambda r: r["total"], reverse=True)
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows


def public_scores(scores: dict[str, float]) -> dict[str, Any]:
    return {
        **{s: round(float(scores.get(s, 0)), 1) for s in SUBJECT_IDS},
        "total": round(total_score(scores), 1),
    }
