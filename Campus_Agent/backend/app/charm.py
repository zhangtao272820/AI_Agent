"""Public charm from beauty / body / grade."""

from __future__ import annotations

from typing import Any

from . import catalog


def compute_charm(student: dict[str, Any]) -> int:
    pers = catalog.personality_catalog()
    beauty_pts = 22
    for b in pers.get("beauty_tiers") or []:
        if b["id"] == student.get("beauty_tier"):
            beauty_pts = int(b.get("charm_pts", 22))
            break

    grade_pts = 12
    for g in pers.get("grade_tiers") or []:
        if g["id"] == student.get("grade_tier"):
            grade_pts = int(g.get("charm_pts", 12))
            break

    body_pts = 14
    if student.get("gender") == "female":
        cup = student.get("bust_cup")
        for c in pers.get("bust_cups") or []:
            if c["id"] == cup:
                body_pts = int(c.get("body_charm_pts", 14))
                break
    else:
        male_map = (pers.get("charm_formula") or {}).get("male_body_pts") or {}
        body_pts = int(male_map.get(student.get("figure_archetype"), 14))

    # pts tables already weight-ish; soft clamp
    raw = beauty_pts + body_pts + grade_pts
    return int(max(1, min(100, raw)))
