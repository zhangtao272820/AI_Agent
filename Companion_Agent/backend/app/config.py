from functools import lru_cache
from pathlib import Path
import os
import sys

from pydantic_settings import BaseSettings, SettingsConfigDict


def _detect_project_root() -> Path:
    env = os.environ.get("COMPANION_PROJECT_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    if getattr(sys, "frozen", False):
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass).resolve()
        return Path(sys.executable).resolve().parent
    # backend/app/config.py → Companion_Agent/
    return Path(__file__).resolve().parent.parent.parent


PROJECT_ROOT = _detect_project_root()
_BACKEND_DIR = PROJECT_ROOT / "backend"


def _user_data_root() -> Path:
    """Writable root for SQLite in desktop / frozen builds."""
    desktop = os.environ.get("COMPANION_DESKTOP", "").strip().lower() in {"1", "true", "yes"}
    if not desktop and not getattr(sys, "frozen", False):
        return PROJECT_ROOT
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home())
    root = Path(base) / "CompanionAgent"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


USER_DATA_ROOT = _user_data_root()


def data_dir() -> Path:
    """Catalogs live under PROJECT_ROOT/data; DBs may use USER_DATA_ROOT/data."""
    return PROJECT_ROOT / "data"


def user_db_dir() -> Path:
    d = USER_DATA_ROOT / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def resolve_frontend_dist() -> Path:
    candidates = [
        PROJECT_ROOT / "frontend" / "dist",
        Path(sys.executable).resolve().parent / "frontend" / "dist" if getattr(sys, "frozen", False) else None,
    ]
    for c in candidates:
        if c and c.is_dir():
            return c
    return PROJECT_ROOT / "frontend" / "dist"


_ENV_CANDIDATES = [
    Path(p)
    for p in (
        os.environ.get("COMPANION_ENV_FILE", ""),
        str(USER_DATA_ROOT / ".env"),
        str(PROJECT_ROOT / ".env"),
        str(PROJECT_ROOT / ".env.local"),
    )
    if p
]
_ENV_FILES = tuple(p for p in _ENV_CANDIDATES if p.is_file())


def resolve_proj_path(p: str | Path) -> Path:
    path = Path(p)
    return path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES or None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    dashscope_api_key: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    companion_llm_model: str = "qwen-flash-character-2026-02-26"
    # 空字符串 = 与 companion_llm_model 相同（避免默默另开 qwen-flash 额度池）
    companion_aux_llm_model: str = ""
    companion_judge_mode: str = "hybrid"
    companion_summary_every_turns: int = 10
    companion_context_keep_pairs: int = 4
    # 记忆 LLM：默认开，但只在「实质发言」且每隔 N 轮调用；短敷衍用规则提取兜底
    companion_memory_llm_enabled: bool = True
    companion_memory_llm_every_turns: int = 3
    companion_memory_llm_min_chars: int = 8

    companion_tts_enabled: bool = True
    companion_tts_model: str = "qwen3-tts-flash"
    companion_tts_instruct_model: str = "qwen3-tts-instruct-flash"
    companion_tts_voice: str = "Cherry"
    companion_tts_mode: str = "full"
    companion_tts_fallback: str = "none"
    companion_tts_cache_dir: str = "data/tts_cache"
    companion_tts_skip_short_chars: int = 20

    companion_daily_ap_enabled: bool = True
    companion_daily_ap_max: int = 5

    cors_origins: str = "http://localhost:5175,http://127.0.0.1:5175"
    api_host: str = "0.0.0.0"
    api_port: int = 13115

    llm_temperature: float = 0.92
    llm_max_tokens: int = 512
    history_max_turns: int = 4


@lru_cache
def get_settings() -> Settings:
    return Settings()


def api_key(settings: Settings) -> str:
    return (settings.dashscope_api_key or settings.openai_api_key or "").strip()


def aux_llm_model(settings: Settings) -> str:
    """裁决 / 记忆 / 摘要用模型：未单独配置时跟主对话模型，避免隐式 qwen-flash。"""
    explicit = (settings.companion_aux_llm_model or "").strip()
    if explicit:
        return explicit
    return (settings.companion_llm_model or "").strip() or "qwen-flash-character-2026-02-26"
