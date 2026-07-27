"""Desktop / PyInstaller path helpers for Campus Agent."""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

APP_DIR_NAME = "CampusAgent"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False)) or os.environ.get("CAMPUS_DESKTOP", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def bundle_root() -> Path:
    env = os.environ.get("CAMPUS_PROJECT_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass).resolve()
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def user_data_root() -> Path:
    if not is_frozen() and not os.environ.get("CAMPUS_DESKTOP"):
        return bundle_root()
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home())
    root = Path(base) / APP_DIR_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def user_data_dir() -> Path:
    d = user_data_root() / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_user_env() -> Path | None:
    root = user_data_root()
    user_env = root / ".env"
    if user_env.is_file():
        return user_env
    desktopish = is_frozen() or os.environ.get("CAMPUS_DESKTOP", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    if not desktopish:
        bundled = bundle_root() / ".env"
        return bundled if bundled.is_file() else None
    for name in (".env", ".env.example"):
        src = bundle_root() / name
        if not src.is_file():
            continue
        try:
            shutil.copy2(src, user_env)
            return user_env
        except OSError:
            if name == ".env":
                return src
    return None


def frontend_dist() -> Path:
    candidates = [
        bundle_root() / "frontend" / "dist",
        Path(sys.executable).resolve().parent / "frontend" / "dist" if getattr(sys, "frozen", False) else None,
    ]
    for c in candidates:
        if c and c.is_dir():
            return c
    return bundle_root() / "frontend" / "dist"
