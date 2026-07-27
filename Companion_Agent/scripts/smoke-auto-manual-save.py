"""Smoke: auto overwrite + manual snapshot + legacy migration."""
from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import world_store  # noqa: E402
from app.world_store import (  # noqa: E402
    create_manual_save,
    create_world_save,
    delete_world_save,
    get_auto_save,
    init_world_db,
    list_world_saves,
    load_into_auto,
    upsert_world_save,
)


def test_auto_manual() -> None:
    td = Path(tempfile.mkdtemp())
    world_store._db_path = lambda: td / "companion_save.db"  # type: ignore[method-assign]

    uid = "test_user_auto_manual"
    init_world_db()

    s1 = create_world_save(user_id=uid, protagonist_name="测")
    assert s1.kind == "auto", s1.kind
    lst = list_world_saves(uid)
    assert len(lst) == 1 and lst[0]["kind"] == "auto"

    s1.calendar.day_index = 3
    upsert_world_save(s1)
    auto = get_auto_save(uid)
    assert auto and auto.calendar.day_index == 3

    m = create_manual_save(user_id=uid, source_save_id=s1.save_id)
    assert m.kind == "manual"
    assert m.calendar.day_index == 3
    lst = list_world_saves(uid)
    assert len(lst) == 2 and lst[0]["kind"] == "auto" and lst[1]["kind"] == "manual"

    auto.calendar.day_index = 5
    upsert_world_save(auto)

    loaded = load_into_auto(user_id=uid, source_save_id=m.save_id)
    assert loaded is not None
    assert loaded.kind == "auto"
    assert loaded.calendar.day_index == 3
    assert loaded.save_id == s1.save_id

    s2 = create_world_save(user_id=uid, protagonist_name="测2")
    assert s2.save_id == s1.save_id
    assert s2.calendar.day_index == 1
    lst = list_world_saves(uid)
    assert len([x for x in lst if x["kind"] == "auto"]) == 1
    assert len([x for x in lst if x["kind"] == "manual"]) == 1

    try:
        delete_world_save(s2.save_id, user_id=uid)
        raise AssertionError("should not delete auto")
    except ValueError as e:
        assert "自动档" in str(e)

    assert delete_world_save(m.save_id, user_id=uid) is True
    lst = list_world_saves(uid)
    assert len(lst) == 1 and lst[0]["kind"] == "auto"
    print("OK auto/manual", lst[0]["save_id"])


def test_legacy_migration() -> None:
    td = Path(tempfile.mkdtemp())
    db = td / "companion_save.db"
    world_store._db_path = lambda: db  # type: ignore[method-assign]

    conn = sqlite3.connect(str(db))
    conn.execute(
        """
        CREATE TABLE world_saves (
            save_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    uid = "legacy_user"
    payloads = [
        (
            "old1",
            "2026-01-01T00:00:00+00:00",
            {
                "save_id": "old1",
                "user_id": uid,
                "protagonist_name": "A",
                "calendar": {"day_index": 1, "weekday": 1, "period": "morning"},
                "bonds": {},
            },
        ),
        (
            "old2",
            "2026-06-01T00:00:00+00:00",
            {
                "save_id": "old2",
                "user_id": uid,
                "protagonist_name": "B",
                "calendar": {"day_index": 9, "weekday": 2, "period": "evening"},
                "bonds": {},
            },
        ),
        (
            "old3",
            "2026-03-01T00:00:00+00:00",
            {
                "save_id": "old3",
                "user_id": uid,
                "protagonist_name": "C",
                "calendar": {"day_index": 4, "weekday": 3, "period": "afternoon"},
                "bonds": {},
            },
        ),
    ]
    for sid, ts, payload in payloads:
        conn.execute(
            "INSERT INTO world_saves (save_id, user_id, payload_json, updated_at) VALUES (?, ?, ?, ?)",
            (sid, uid, json.dumps(payload), ts),
        )
    conn.commit()
    conn.close()

    init_world_db()
    lst = list_world_saves(uid)
    assert len(lst) == 3, lst
    autos = [s for s in lst if s["kind"] == "auto"]
    manuals = [s for s in lst if s["kind"] == "manual"]
    assert len(autos) == 1, autos
    assert autos[0]["save_id"] == "old2", autos[0]
    assert len(manuals) == 2
    print("OK migration", [(s["save_id"], s["kind"], s["day_index"]) for s in lst])


if __name__ == "__main__":
    test_auto_manual()
    test_legacy_migration()
    print("ALL OK")
