from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = _BACKEND_DIR.parent


def resolve_proj_path(p: str | Path) -> Path:
    path = Path(p)
    return path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", _BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    openai_model: str = "qwen-flash-2025-07-28"
    dashscope_api_key: str = ""

    qwen_vl_model: str = "qwen-vl-plus"
    qwen_helper_model: str = "qwen-flash-2025-07-28"
    qwen_asr_model: str = "qwen3-asr-flash-2025-09-08"
    qwen_text_model: str = "qwen-flash-2025-07-28"
    use_helper_for_vision: bool = True
    vl_max_tokens: int = 900
    helper_max_tokens: int = 480

    output_dir: str = ".data/multimodal/out"
    upload_dir: str = ".data/multimodal/uploads"
    cors_origins: str = "http://localhost:13107,http://127.0.0.1:13107"
    api_host: str = "0.0.0.0"
    api_port: int = 13107

    max_image_mb: int = 12
    max_video_mb: int = 80
    max_audio_mb: int = 25
    max_video_duration_sec: int = 120
    video_frame_sample: int = 6

    music_agent_http_url: str = "http://127.0.0.1:13110"
    video_agent_http_url: str = "http://127.0.0.1:13111"
    music_agent_ui_url: str = "http://127.0.0.1:13110"
    video_agent_ui_url: str = "http://127.0.0.1:13111"

    multimodal_frontend_dist: str = ""
    use_mock_when_no_key: bool = True


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    try:
        from .platform_config import apply_platform_models

        apply_platform_models(s)
    except Exception:
        pass
    return s
