"""NPC period-end intents: pursuit / date response (rules first)."""

from __future__ import annotations

import random
from typing import Any

from . import relationship as rel


def evaluate_pursuit(
    *,
    npc: dict[str, Any],
    edge: dict[str, Any] | None,
    pc_charm: int,
    rng: random.Random | None = None,
) -> dict[str, Any] | None:
    """Return intent dict if NPC wants to approach PC."""
    r = rng or random.Random()
    thr = float(npc.get("pursuit_threshold") or 70)
    affinity = float((edge or {}).get("affinity") or 0)
    if affinity < thr * 0.85:
        return None
    # charm helps lower effective threshold
    effective = thr - max(0, (pc_charm - 50) * 0.15)
    if affinity < effective:
        return None
    if r.random() > 0.35:
        return None
    return {
        "type": "pursuit",
        "from_id": npc["id"],
        "from_name": npc.get("name"),
        "blurb": f"{npc.get('name')}好像想找你说几句话。",
    }


def evaluate_date_response(
    *,
    npc: dict[str, Any],
    edge: dict[str, Any],
    weather_id: str,
    accept_tendency: float | None = None,
) -> bool:
    if not rel.dating_allowed(edge):
        return False
    affinity = float(edge.get("affinity") or 0)
    base = 0.25 + affinity / 200.0
    if accept_tendency is not None:
        base = 0.4 * base + 0.6 * float(accept_tendency)
    if weather_id in {"rainy", "thunderstorm", "cold"}:
        base -= 0.08
    if weather_id == "sunny":
        base += 0.05
    stance = str(npc.get("romance_stance") or "")
    if stance in {"playful", "bold"}:
        base += 0.08
    if stance in {"slow_burn", "guarded"}:
        base -= 0.05
    return random.random() < max(0.05, min(0.92, base))


def weekend_location_for(student: dict[str, Any], weather_id: str, rng: random.Random) -> str:
    bias = str(student.get("weekend_bias") or "library")
    pool = [bias, bias, "classroom", "library", "playground", "shop", "cafeteria"]
    dorm = student.get("dorm_id")
    if dorm:
        pool.extend([dorm, dorm])
    if weather_id in {"rainy", "thunderstorm"}:
        pool = [p for p in pool if p not in {"playground", "rooftop"}] or ["library", "classroom"]
        pool.extend(["hallway", "cafeteria"])
    if weather_id == "cold" and dorm:
        pool.extend([dorm, dorm])
    return rng.choice(pool)
