import json
import logging
import re
import threading
import time
from pathlib import Path

import httpx

from .config import Settings, get_settings, resolve_proj_path
from .prompts import image_prompt_character, image_prompt_wine, image_negative_prompt_pixel_cn

logger = logging.getLogger(__name__)

_img_sem: threading.Semaphore | None = None
_img_sem_n: int | None = None
_img_sem_lock = threading.Lock()


def _image_gen_semaphore() -> threading.Semaphore:
    global _img_sem, _img_sem_n
    n = max(1, get_settings().tavern_image_max_concurrent)
    with _img_sem_lock:
        if _img_sem is None or _img_sem_n != n:
            _img_sem = threading.Semaphore(n)
            _img_sem_n = n
        return _img_sem


def _revision_suffix(settings: Settings) -> str:
    r = (settings.tavern_image_asset_revision or "").strip()
    if not r or re.fullmatch(r"[A-Za-z0-9_-]+", r) is None:
        if r:
            logger.warning("Invalid tavern_image_asset_revision (use [A-Za-z0-9_-]+), ignoring: %s", r)
        return ""
    return f"_{r}"


def _cache_key(settings: Settings, kind: str, entity_id: str) -> str:
    r = (settings.tavern_image_asset_revision or "").strip()
    if r and re.fullmatch(r"[A-Za-z0-9_-]+", r) is not None:
        return f"{kind}:{entity_id}:{r}"
    return f"{kind}:{entity_id}"


def resolve_image_provider(settings: Settings) -> str:
    """auto：按模型名推断；否则 qwen / wanx。"""
    p = (settings.tavern_image_provider or "auto").strip().lower()
    m = (settings.tavern_image_model or "").lower()
    if p == "qwen":
        return "qwen"
    if p == "wanx":
        return "wanx"
    if "qwen-image" in m:
        return "qwen"
    if "wanx" in m:
        return "wanx"
    return "qwen"


def _extract_qwen_image_url(rsp) -> str | None:
    """从 MultiModalConversation 响应中取首张图 URL。"""
    try:
        out = getattr(rsp, "output", None)
        if out is None and isinstance(rsp, dict):
            out = rsp.get("output")
        if out is None:
            return None
        choices = getattr(out, "choices", None) or (
            out.get("choices") if isinstance(out, dict) else None
        )
        if not choices:
            return None
        ch0 = choices[0]
        msg = getattr(ch0, "message", None) or (
            ch0.get("message") if isinstance(ch0, dict) else None
        )
        if msg is None:
            return None
        content = getattr(msg, "content", None) or (
            msg.get("content") if isinstance(msg, dict) else None
        )
        if not content:
            return None
        for item in content:
            if isinstance(item, dict):
                u = item.get("image")
                if u:
                    return str(u)
            u = getattr(item, "image", None)
            if u:
                return str(u)
    except Exception:
        logger.exception("parse qwen image response")
    return None


def _generate_qwen_image(*, settings: Settings, prompt: str, api_key: str) -> str | None:
    try:
        import dashscope
        from dashscope import MultiModalConversation

        dashscope.base_http_api_url = "https://dashscope.aliyuncs.com/api/v1"
    except ImportError:
        logger.exception("dashscope not installed")
        return None

    messages = [{"role": "user", "content": [{"text": prompt}]}]
    neg = image_negative_prompt_pixel_cn()

    call_kw: dict = {
        "api_key": api_key,
        "model": settings.tavern_image_model,
        "messages": messages,
        "result_format": "message",
        "stream": False,
        "watermark": False,
        "prompt_extend": settings.tavern_image_prompt_extend,
        "negative_prompt": neg,
        "size": settings.tavern_image_size,
    }
    if settings.tavern_image_seed is not None:
        call_kw["seed"] = settings.tavern_image_seed
    try:
        rsp = MultiModalConversation.call(**call_kw)
    except TypeError:
        call_kw.pop("seed", None)
        try:
            rsp = MultiModalConversation.call(**call_kw)
        except Exception:
            logger.exception("MultiModalConversation.call failed")
            return None
    except Exception:
        logger.exception("MultiModalConversation.call failed")
        return None

    code = getattr(rsp, "status_code", None)
    if code is not None and code != 200:
        logger.error(
            "Qwen-Image HTTP %s code=%s msg=%s",
            code,
            getattr(rsp, "code", ""),
            getattr(rsp, "message", ""),
        )
        return None

    return _extract_qwen_image_url(rsp)


def _generate_wanx_image(*, settings: Settings, prompt: str, api_key: str) -> str | None:
    try:
        from dashscope import ImageSynthesis
    except ImportError:
        logger.exception("dashscope not installed")
        return None

    w_kw: dict = {
        "model": settings.tavern_image_model,
        "prompt": prompt,
        "api_key": api_key,
        "size": settings.tavern_image_size,
        "negative_prompt": image_negative_prompt_pixel_cn(),
    }
    if settings.tavern_image_seed is not None:
        w_kw["seed"] = settings.tavern_image_seed
    try:
        rsp = ImageSynthesis.call(**w_kw)
    except TypeError:
        w_kw.pop("seed", None)
        try:
            rsp = ImageSynthesis.call(**w_kw)
        except Exception:
            logger.exception("ImageSynthesis.call failed")
            return None
    except Exception:
        logger.exception("ImageSynthesis.call failed")
        return None

    if rsp is None:
        return None

    status_code = getattr(rsp, "status_code", None)
    if status_code is not None and status_code != 200:
        logger.error("Wanx synthesis status: %s body: %s", status_code, rsp)
        return None

    url = None
    output = getattr(rsp, "output", None)
    if output is not None:
        results = getattr(output, "results", None)
        if results:
            first = results[0]
            url = getattr(first, "url", None) or (
                first.get("url") if isinstance(first, dict) else None
            )
    if not url and isinstance(rsp, dict):
        out = rsp.get("output") or {}
        results = out.get("results") or []
        if results and isinstance(results[0], dict):
            url = results[0].get("url")

    return url


def _ensure_dirs(settings: Settings) -> Path:
    base = resolve_proj_path(settings.asset_dir)
    base.mkdir(parents=True, exist_ok=True)
    resolve_proj_path(settings.image_cache_json).parent.mkdir(parents=True, exist_ok=True)
    return base


def _load_cache(settings: Settings) -> dict[str, str]:
    p = resolve_proj_path(settings.image_cache_json)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _save_cache(settings: Settings, cache: dict[str, str]) -> None:
    p = resolve_proj_path(settings.image_cache_json)
    p.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def _api_key(settings: Settings) -> str:
    return settings.dashscope_api_key or settings.openai_api_key


def synthesize_and_store(
    *,
    settings: Settings,
    kind: str,
    entity_id: str,
    prompt: str,
    filename: str,
) -> str | None:
    """调用 DashScope（千问 Qwen-Image 或万相 Wanx），保存到本地并返回相对 URL。"""
    key = _api_key(settings)
    if not key:
        logger.warning("No DASHSCOPE_API_KEY / OPENAI_API_KEY for image synthesis")
        return None

    base = _ensure_dirs(settings)
    target = base / filename
    if target.exists():
        return f"/api/static/{filename}"

    sem = _image_gen_semaphore()
    sem.acquire()
    try:
        if target.exists():
            return f"/api/static/{filename}"

        provider = resolve_image_provider(settings)
        if provider == "qwen":
            url = _generate_qwen_image(settings=settings, prompt=prompt, api_key=key)
        else:
            url = _generate_wanx_image(settings=settings, prompt=prompt, api_key=key)

        if not url:
            logger.warning(
                "Image gen empty, retry once after delay (%s %s)",
                kind,
                entity_id,
            )
            time.sleep(1.6)
            if provider == "qwen":
                url = _generate_qwen_image(settings=settings, prompt=prompt, api_key=key)
            else:
                url = _generate_wanx_image(settings=settings, prompt=prompt, api_key=key)

        if not url:
            logger.error(
                "No image URL from provider=%s model=%s (%s %s)",
                provider,
                settings.tavern_image_model,
                kind,
                entity_id,
            )
            return None

        try:
            r = httpx.get(url, timeout=120.0)
            r.raise_for_status()
            target.write_bytes(r.content)
        except Exception:
            logger.exception("Download generated image failed")
            return None
    finally:
        sem.release()

    rel = f"/api/static/{filename}"
    cache = _load_cache(settings)
    cache[_cache_key(settings, kind, entity_id)] = rel
    _save_cache(settings, cache)
    return rel


def get_or_create_wine_image(settings: Settings, wine_id: str) -> str | None:
    from .matrix import find_wine

    w = find_wine(wine_id)
    if not w:
        return None
    fname = f"wine_{wine_id}{_revision_suffix(settings)}.png"
    base = _ensure_dirs(settings)
    if (base / fname).exists():
        return f"/api/static/{fname}"
    return synthesize_and_store(
        settings=settings,
        kind="wine",
        entity_id=wine_id,
        prompt=image_prompt_wine(w),
        filename=fname,
    )


def get_or_create_character_image(settings: Settings, character_id: str) -> str | None:
    from .matrix import find_character

    c = find_character(character_id)
    if not c:
        return None
    fname = f"character_{character_id}{_revision_suffix(settings)}.png"
    base = _ensure_dirs(settings)
    if (base / fname).exists():
        return f"/api/static/{fname}"
    return synthesize_and_store(
        settings=settings,
        kind="character",
        entity_id=character_id,
        prompt=image_prompt_character(c),
        filename=fname,
    )
