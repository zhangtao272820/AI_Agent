from __future__ import annotations

import os
from pathlib import Path


def project_root() -> Path:
    env = os.environ.get("CAMPUS_PROJECT_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parent.parent.parent


def is_desktop() -> bool:
    return os.environ.get("CAMPUS_DESKTOP", "").strip().lower() in {"1", "true", "yes"}


def user_data_root() -> Path:
    if not is_desktop() and not os.environ.get("CAMPUS_USER_DATA"):
        return project_root()
    custom = os.environ.get("CAMPUS_USER_DATA", "").strip()
    if custom:
        p = Path(custom)
        p.mkdir(parents=True, exist_ok=True)
        return p.resolve()
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home())
    root = Path(base) / "CampusAgent"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def data_dir() -> Path:
    return project_root() / "data"


def writable_data_dir() -> Path:
    d = user_data_root() / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_db_path() -> Path:
    env = os.environ.get("CAMPUS_SAVE_DB", "").strip()
    if env:
        return Path(env).resolve()
    if is_desktop() or os.environ.get("CAMPUS_USER_DATA"):
        return writable_data_dir() / "campus_save.db"
    return data_dir() / "campus_save.db"


def frontend_dist() -> Path | None:
    candidates = [
        project_root() / "frontend" / "dist",
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return None


def llm_api_key() -> str:
    return (
        os.environ.get("CAMPUS_API_KEY", "").strip()
        or os.environ.get("DASHSCOPE_API_KEY", "").strip()
        or os.environ.get("OPENAI_API_KEY", "").strip()
    )


def character_model() -> str:
    return os.environ.get("CAMPUS_LLM_MODEL", "qwen-flash-character").strip()


def aux_model() -> str:
    return os.environ.get("CAMPUS_AUX_LLM_MODEL", "qwen-flash").strip()


def llm_base_url() -> str:
    return os.environ.get(
        "CAMPUS_LLM_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ).strip()
