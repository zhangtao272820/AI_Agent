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

    # 文本 Agent：OpenAI 兼容（百炼 DashScope）
    openai_api_key: str = ""
    openai_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    # 默认用偏免费/低成本的文本模型；具体以控制台「模型广场」可用名为准
    openai_model: str = "qwen3.5-flash"

    dashscope_api_key: str = ""

    output_dir: str = ".data/video/out"
    cors_origins: str = "http://localhost:56291,http://127.0.0.1:56291"
    api_host: str = "0.0.0.0"
    api_port: int = 37891

    # 通义万相文生视频（DashScope VideoSynthesis；模型名以控制台为准）
    wan_video_model: str = "wan2.6-t2v"
    wan_video_fallback_model: str = "wanx2.1-t2v-plus"
    wan_video_size: str = "1280*720"
    wan_video_duration: int = 10
    wan_poll_interval_sec: float = 3.0
    wan_wait_timeout_sec: int = 600

    # 无 Key 或显式开启时走占位视频，便于联调 UI
    video_use_mock: bool = False

    # 音乐 Agent（仅 HTTP 调用 Music_Agent 生成 BGM）
    music_agent_http_url: str = "http://127.0.0.1:37890"
    bgm_enabled: bool = True
    bgm_prompt_suffix: str = "，节奏感强、无歌词、适合短视频剪辑的纯伴奏背景音乐"
    bgm_duration_seconds: int = 10
    bgm_music_key: str = "C"
    bgm_tempo_bpm: int = 96
    bgm_emotion: str = "energetic"

    qa_max_fail_retries: int = 2

    llm_max_tokens_director: int = 1024
    llm_max_tokens_camera: int = 768
    llm_max_tokens_qa: int = 512

    # 非空时由 FastAPI 托管前端 dist（Docker 单容器模式，与 Music_Agent 一致）
    video_frontend_dist: str = ""


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    try:
        from .platform_config import apply_platform_models

        apply_platform_models(s)
    except Exception:
        pass
    return s
