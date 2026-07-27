"""Daily weather roll and template events."""

from __future__ import annotations

import random
from typing import Any

from . import catalog


def roll_weather(rng: random.Random | None = None) -> str:
    r = rng or random.Random()
    weathers = catalog.weather_catalog().get("weathers") or []
    if not weathers:
        return "cloudy"
    ids = [w["id"] for w in weathers]
    weights = [float(w.get("weight", 1)) for w in weathers]
    return r.choices(ids, weights=weights, k=1)[0]


def weather_label(weather_id: str) -> str:
    for w in catalog.weather_catalog().get("weathers") or []:
        if w["id"] == weather_id:
            return str(w.get("label", weather_id))
    return weather_id


def weather_meta(weather_id: str) -> dict[str, Any]:
    for w in catalog.weather_catalog().get("weathers") or []:
        if w["id"] == weather_id:
            return dict(w)
    return {"id": weather_id, "label": weather_id}


def pick_event(weather_id: str, rng: random.Random | None = None) -> dict[str, Any] | None:
    r = rng or random.Random()
    pool = [
        e
        for e in (catalog.weather_catalog().get("events") or [])
        if weather_id in (e.get("weather_ids") or [])
    ]
    if not pool:
        return None
    # thunderstorm power_outage: 55% chance; others 25%
    chance = 0.55 if weather_id == "thunderstorm" else 0.25
    if r.random() > chance:
        return None
    return dict(r.choice(pool))
