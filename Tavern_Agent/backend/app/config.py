from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
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

    # 对话：OpenAI 兼容（阿里云百炼 / DashScope）
    openai_api_key: str = ""
    openai_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    openai_model: str = "qwen-plus"

    # 文生图：千问 Qwen-Image（MultiModalConversation）或万相 Wanx（ImageSynthesis）
    dashscope_api_key: str = ""
    # auto：由模型名推断（含 qwen-image 走千问，含 wanx 走万相）
    tavern_image_provider: str = "auto"
    tavern_image_model: str = "qwen-image-2.0"
    tavern_image_size: str = "1024*1024"
    # 像素风等强约束建议 false，避免被「智能改写」冲掉风格
    tavern_image_prompt_extend: bool = False
    # 同时最多几个生图请求（避免首开页面并发过大触发云侧限流，导致部分裂图）
    tavern_image_max_concurrent: int = 3
    # 变更此项可换新文件名，便于在提示词升级后让 Docker/本地重新生图而不手删缓存（仅 [A-Za-z0-9_-]）
    tavern_image_asset_revision: str = ""
    # 可选固定随机种子，提高跨环境可重复性（模型仍可能略有波动）；不设则完全随机
    tavern_image_seed: int | None = Field(default=None)

    asset_dir: str = ".data/tavern/assets"
    image_cache_json: str = ".data/tavern/image_cache.json"
    # Docker 或生产：Vite 构建目录的绝对路径，空则只提供 /api（开发时由 Vite 代理）
    tavern_frontend_dist: str = ""

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @field_validator("tavern_image_seed", mode="before")
    @classmethod
    def _seed_empty(cls, v):
        if v is None or v == "":
            return None
        return v


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    try:
        from .platform_config import apply_platform_models

        apply_platform_models(s)
    except Exception:
        pass
    return s
