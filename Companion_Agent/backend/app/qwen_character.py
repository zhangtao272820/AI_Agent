"""千问 Character 模型调用（OpenAI 兼容 + 流式）。"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from openai import OpenAI

from .config import Settings, api_key

logger = logging.getLogger(__name__)


def _client(settings: Settings) -> OpenAI:
    key = api_key(settings)
    if not key:
        raise RuntimeError("未配置 DASHSCOPE_API_KEY 或 OPENAI_API_KEY")
    return OpenAI(api_key=key, base_url=settings.openai_base_url)


def build_messages(session_messages: list[dict[str, str]], system_prompt: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for m in session_messages:
        role = m.get("role")
        content = m.get("content")
        if role in ("user", "assistant") and isinstance(content, str):
            out.append({"role": role, "content": content})
    return out


def chat_stream(
    settings: Settings,
    *,
    messages: list[dict[str, str]],
    on_delta: Callable[[str, str], None] | None = None,
) -> str:
    client = _client(settings)
    stream = client.chat.completions.create(
        model=settings.companion_llm_model,
        messages=messages,
        temperature=settings.llm_temperature,
        max_tokens=settings.llm_max_tokens,
        stream=True,
    )
    parts: list[str] = []
    for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if not delta:
            continue
        parts.append(delta)
        if on_delta:
            on_delta(delta, "".join(parts))
    text = "".join(parts).strip()
    if not text:
        raise RuntimeError("模型未返回内容")
    return text


def chat_once(
    settings: Settings,
    *,
    messages: list[dict[str, str]],
    max_tokens: int | None = None,
) -> str:
    client = _client(settings)
    resp = client.chat.completions.create(
        model=settings.companion_llm_model,
        messages=messages,
        temperature=settings.llm_temperature,
        max_tokens=int(max_tokens) if max_tokens is not None else settings.llm_max_tokens,
        stream=False,
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("模型未返回内容")
    return text


def chat_once_with_model(
    settings: Settings,
    *,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int = 320,
    temperature: float = 0.3,
) -> str:
    from .llm_errors import note_aux_failure

    client = _client(settings)
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
        )
    except Exception as ex:
        note_aux_failure(ex)
        raise
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        raise RuntimeError("模型未返回内容")
    return text
