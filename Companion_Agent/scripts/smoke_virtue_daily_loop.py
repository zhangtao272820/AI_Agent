"""Smoke：美德式一日主环 — soft choices、Hub 挑战、VirtuesChrome 壳与立绘接线标记。"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.life_briefs import soft_choices_for_agenda, today_suggestions  # noqa: E402
from app.scene_agenda import SceneAgenda  # noqa: E402
from app.world_store import create_world_save  # noqa: E402


def fail(msg: str) -> None:
    print(f"FAIL {msg}")
    raise SystemExit(1)


def main() -> None:
    # 无议程也有默认选项
    bare = soft_choices_for_agenda(None)
    if len(bare) < 2:
        fail(f"None agenda should yield >=2 soft choices, got {bare}")

    chat = soft_choices_for_agenda(SceneAgenda(source="chat", goal="", soft_choices_hint=True))
    if len(chat) < 2:
        fail(f"chat agenda should yield soft choices, got {chat}")

    appt = soft_choices_for_agenda(
        SceneAgenda(source="appointment", goal="确认约会", soft_choices_hint=True)
    )
    if len(appt) < 2:
        fail(f"appointment soft choices empty: {appt}")

    save = create_world_save(user_id="smoke-virtue-loop", protagonist_name="测")
    sug = today_suggestions(save)
    if not isinstance(sug, list):
        fail("today_suggestions should be list")

    hub_tsx = (ROOT / "frontend" / "src" / "components" / "TownHubScreen.tsx").read_text(
        encoding="utf-8"
    )
    if "gal-hub-challenge" not in hub_tsx:
        fail("TownHubScreen missing challenge card")
    if "VirtuesChrome" not in hub_tsx:
        fail("TownHubScreen missing VirtuesChrome")
    if "gal-hub-ping-strip" in hub_tsx:
        fail("Hub still has inline ping strip; pings should live in phone panel")
    if "gal-hub-phone-hint" not in hub_tsx:
        fail("Hub missing phone hint for unread pings")

    chrome = (ROOT / "frontend" / "src" / "components" / "VirtuesChrome.tsx").read_text(
        encoding="utf-8"
    )
    for marker in ("gal-virtues-chrome", "gal-virtues-sheet--phone", "gal-virtues-sheet--bag"):
        if marker not in chrome:
            fail(f"VirtuesChrome missing {marker}")

    loc = (ROOT / "frontend" / "src" / "components" / "LocationScreen.tsx").read_text(
        encoding="utf-8"
    )
    if "SpritePortrait" not in loc:
        fail("LocationScreen should use SpritePortrait for heroine art")
    if "HeartTrack" not in loc:
        fail("LocationScreen missing HeartTrack")
    if "VirtuesChrome" not in loc:
        fail("LocationScreen missing VirtuesChrome")

    heroine = (ROOT / "frontend" / "src" / "components" / "HeroinePanel.tsx").read_text(
        encoding="utf-8"
    )
    if "SpritePortrait" not in heroine or "HeartTrack" not in heroine:
        fail("HeroinePanel should surface sprite + heart track")

    map_tsx = (ROOT / "frontend" / "src" / "components" / "TownMapPicker.tsx").read_text(
        encoding="utf-8"
    )
    if "gal-map-pin-event-badge" not in map_tsx:
        fail("TownMapPicker missing appointment event bubble")

    gal = (ROOT / "frontend" / "src" / "components" / "GalInputBar.tsx").read_text(encoding="utf-8")
    if "自己说" not in gal:
        fail("GalInputBar missing collapse affordance")

    scene = (ROOT / "frontend" / "src" / "components" / "GalScene.tsx").read_text(encoding="utf-8")
    if "gal-hud--virtues" not in scene:
        fail("GalScene missing virtues HUD strip")

    print("OK virtue daily-loop + VirtuesChrome + sprite/heart UI markers")
    print(f"  default soft={bare}")
    print(f"  day1 suggestions={len(sug)}")


if __name__ == "__main__":
    main()
