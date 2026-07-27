"""Seat grid: 2 groups × N rows × 3 seats (default 6 rows = 36 capacity)."""

from __future__ import annotations

import random
from typing import Any, Literal

SeatRelation = Literal["deskmate", "aisle", "front_back", "diagonal", "note", "none"]

GROUPS = 2
ROWS = 6
SEATS_PER_ROW = 3

RELATION_MULT: dict[str, float] = {
    "deskmate": 1.40,
    "front_back": 1.30,
    "aisle": 1.20,
    "diagonal": 1.10,
    "note": 1.0,
    "none": 1.0,
}

DIRECT_CHAT = frozenset({"deskmate", "aisle", "front_back", "diagonal"})


def all_coords(*, rows: int = ROWS) -> list[dict[str, int]]:
    out: list[dict[str, int]] = []
    for group in range(GROUPS):
        for row in range(rows):
            for seat in range(SEATS_PER_ROW):
                out.append({"group": group, "row": row, "seat": seat})
    return out


def assign_seating(student_ids: list[str], *, rng: random.Random | None = None) -> list[dict[str, Any]]:
    ids = list(student_ids)
    r = rng or random.Random()
    r.shuffle(ids)
    coords = all_coords()
    if len(ids) > len(coords):
        raise ValueError(f"seating_overflow:students={len(ids)} capacity={len(coords)}")
    # Prefer front rows; leave unused seats at the back.
    used = coords[: len(ids)]
    r.shuffle(used)
    return [
        {"student_id": sid, **coord}
        for sid, coord in zip(ids, used, strict=True)
    ]


def find_seat(seating: list[dict[str, Any]], student_id: str) -> dict[str, Any] | None:
    for s in seating:
        if s["student_id"] == student_id:
            return s
    return None


def seat_relation(a: dict[str, Any], b: dict[str, Any]) -> SeatRelation:
    if a["student_id"] == b["student_id"]:
        return "none"
    same_group = a["group"] == b["group"]
    same_row = a["row"] == b["row"]
    dr = abs(a["row"] - b["row"])
    ds = abs(a["seat"] - b["seat"])

    # 同桌：同组同排，中↔左或中↔右
    if same_group and same_row and {a["seat"], b["seat"]} in ({0, 1}, {1, 2}):
        return "deskmate"
    # 同组左右两端 → 纸条
    if same_group and same_row and {a["seat"], b["seat"]} == {0, 2}:
        return "note"
    # 过道邻座：同排，左组右(2) ↔ 右组左(0)
    if (
        same_row
        and a["group"] != b["group"]
        and ((a["group"] == 0 and a["seat"] == 2 and b["group"] == 1 and b["seat"] == 0)
             or (b["group"] == 0 and b["seat"] == 2 and a["group"] == 1 and a["seat"] == 0))
    ):
        return "aisle"
    # 正前后
    if same_group and a["seat"] == b["seat"] and dr == 1:
        return "front_back"
    # 斜对角
    if same_group and dr == 1 and ds == 1:
        return "diagonal"
    return "note"


def relation_between(seating: list[dict[str, Any]], id_a: str, id_b: str) -> SeatRelation:
    sa = find_seat(seating, id_a)
    sb = find_seat(seating, id_b)
    if not sa or not sb:
        return "none"
    return seat_relation(sa, sb)


def can_direct_chat(rel: SeatRelation) -> bool:
    return rel in DIRECT_CHAT


def chat_cost(rel: SeatRelation) -> int:
    if rel in DIRECT_CHAT:
        return 1
    if rel == "note":
        return 2
    return 99


def neighbors_of(seating: list[dict[str, Any]], student_id: str) -> list[tuple[str, SeatRelation]]:
    me = find_seat(seating, student_id)
    if not me:
        return []
    out: list[tuple[str, SeatRelation]] = []
    for s in seating:
        if s["student_id"] == student_id:
            continue
        rel = seat_relation(me, s)
        if rel in DIRECT_CHAT:
            out.append((s["student_id"], rel))
    return out
