import logging
import time
from pathlib import Path
from typing import Any

from .config import Settings, resolve_proj_path

logger = logging.getLogger(__name__)

# 演示用占位（无计费、无 Key）
MOCK_VIDEO_PAGE = "https://www.w3.org/WAI/content-assets/wcag-act-rules/test-assets/perspective-video/video.mp4"


def _dashscope_key(settings: Settings) -> str:
    return (settings.dashscope_api_key or settings.openai_api_key or "").strip()


def synthesize_video_url(
    settings: Settings,
    *,
    prompt: str,
    negative_prompt: str,
    out_dir: Path,
    duration_seconds: int | None = None,
) -> dict[str, Any]:
    """
    返回 {"video_url": str, "local_path": str|None, "mode": "wan"|"mock", "error": str|None}
    wan 模式返回公网 URL；若下载到本地则附带 local_path。
    """
    base_dur = duration_seconds if duration_seconds is not None else settings.wan_video_duration
    duration = min(max(int(base_dur), 5), 15)

    key = _dashscope_key(settings)
    use_mock = settings.video_use_mock or not key

    if use_mock:
        logger.info("文生视频使用 mock：%s", MOCK_VIDEO_PAGE)
        return {
            "video_url": MOCK_VIDEO_PAGE,
            "local_path": None,
            "mode": "mock",
            "error": None,
            "detail": "VIDEO_USE_MOCK=1 或未配置 Key",
            "requested_duration_sec": duration,
        }

    try:
        from dashscope import VideoSynthesis
    except ImportError as ex:
        logger.warning("未安装 dashscope，降级 mock：%s", ex)
        return {
            "video_url": MOCK_VIDEO_PAGE,
            "local_path": None,
            "mode": "mock",
            "error": None,
            "detail": "pip install dashscope",
            "requested_duration_sec": duration,
        }

    size = settings.wan_video_size
    models_to_try = [
        settings.wan_video_model.strip(),
        settings.wan_video_fallback_model.strip(),
    ]
    seen: set[str] = set()
    last_err: str | None = None

    for model in models_to_try:
        if not model or model in seen:
            continue
        seen.add(model)
        try:
            rsp = VideoSynthesis.async_call(
                model=model,
                prompt=prompt,
                negative_prompt=negative_prompt or None,
                api_key=key,
                duration=duration,
                size=size,
            )
            out = getattr(rsp, "output", None)
            if isinstance(out, dict):
                task_id = out.get("task_id")
            else:
                task_id = getattr(out, "task_id", None) if out else None
            if rsp.status_code != 200 or not task_id:
                last_err = getattr(rsp, "message", None) or str(rsp)
                logger.warning("async_call 失败 model=%s: %s", model, last_err)
                continue

            deadline = time.monotonic() + settings.wan_wait_timeout_sec
            while time.monotonic() < deadline:
                time.sleep(settings.wan_poll_interval_sec)
                rsp = VideoSynthesis.fetch(task=task_id, api_key=key)
                if rsp.status_code != 200:
                    last_err = getattr(rsp, "message", None) or str(rsp)
                    break
                out = getattr(rsp, "output", None)
                if isinstance(out, dict):
                    status = out.get("task_status")
                    video_url = out.get("video_url")
                else:
                    status = getattr(out, "task_status", None) if out else None
                    video_url = getattr(out, "video_url", None) if out else None
                if status == "SUCCEEDED":
                    if video_url:
                        return {
                            "video_url": str(video_url),
                            "local_path": None,
                            "mode": "wan",
                            "error": None,
                            "detail": f"model={model}",
                            "requested_duration_sec": duration,
                        }
                    last_err = "任务成功但无 video_url"
                    break
                if status in ("FAILED", "UNKNOWN"):
                    if isinstance(out, dict):
                        last_err = out.get("message") or str(out)
                    else:
                        last_err = getattr(out, "message", None) or str(out)
                    break
            else:
                last_err = last_err or "等待结果超时"
        except Exception as ex:
            last_err = str(ex)
            logger.exception("VideoSynthesis 调用异常 model=%s", model)

    logger.warning("万相全部失败，降级 mock。最后错误：%s", last_err)
    return {
        "video_url": MOCK_VIDEO_PAGE,
        "local_path": None,
        "mode": "mock",
        "error": last_err,
        "detail": "fallback",
        "requested_duration_sec": duration,
    }


def ensure_output_dir(settings: Settings) -> Path:
    p = resolve_proj_path(settings.output_dir)
    p.mkdir(parents=True, exist_ok=True)
    return p
