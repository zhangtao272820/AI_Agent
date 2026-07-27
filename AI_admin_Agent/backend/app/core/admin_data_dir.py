"""Admin 持久化数据目录（SQLite、用户偏好、进化补丁、trace 等）。"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

_LEGACY_JSON = (
    "admin-user-preferences.json",
    "admin-prompt-patches.shadow.json",
    "admin-evolved-playbook.json",
    "agent-trace.jsonl",
)


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _legacy_dot_data() -> Path:
    return _backend_root() / ".data"


def admin_data_dir() -> Path:
    raw = os.getenv("ADMIN_DATA_DIR", "").strip()
    d = Path(raw) if raw else _legacy_dot_data()
    d.mkdir(parents=True, exist_ok=True)
    return d


def admin_sqlite_path() -> Path:
    return admin_data_dir() / "agent_data.db"


def migrate_legacy_admin_data() -> None:
    """
    一次性迁移旧路径 SQLite / JSON，避免 Docker 重建容器后数据回到空库。
    - 旧库：app/db/agent_data.db
    - 旧 JSON：backend/.data/*
    """
    target_db = admin_sqlite_path()
    if not target_db.is_file():
        legacy_db = Path(__file__).resolve().parents[1] / "db" / "agent_data.db"
        if legacy_db.is_file():
            shutil.copy2(legacy_db, target_db)
        else:
            dot_db = _legacy_dot_data() / "agent_data.db"
            if dot_db.is_file() and dot_db.resolve() != target_db.resolve():
                shutil.copy2(dot_db, target_db)

    target_dir = admin_data_dir()
    legacy_dir = _legacy_dot_data()
    if legacy_dir.resolve() == target_dir.resolve() or not legacy_dir.is_dir():
        return
    for name in _LEGACY_JSON:
        src = legacy_dir / name
        dst = target_dir / name
        if src.is_file() and not dst.is_file():
            shutil.copy2(src, dst)
