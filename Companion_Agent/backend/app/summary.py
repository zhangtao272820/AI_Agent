"""L3 滚动对话摘要（无向量库，aux LLM 每 N 轮压缩）。"""

from __future__ import annotations

import logging

from .config import Settings, api_key, aux_llm_model
from .prompt_budget import SUMMARY_MAX_CHARS
from .qwen_character import chat_once_with_model

logger = logging.getLogger(__name__)

_MAX_SUMMARY_CHARS = SUMMARY_MAX_CHARS


def should_summarize(turns: int, every: int) -> bool:
    if every <= 0:
        return False
    return turns > 0 and turns % every == 0


def build_summary(
    settings: Settings,
    *,
    existing_summary: str,
    messages: list[dict[str, str]],
    character_name: str,
) -> str:
    if not api_key(settings):
        return existing_summary

    # 取较早的消息块做压缩，保留最近轮次在 L1
    if len(messages) <= 8:
        return existing_summary

    older = messages[:-8]
    lines: list[str] = []
    for m in older[-24:]:
        role = "用户" if m.get("role") == "user" else character_name
        content = str(m.get("content") or "").strip()
        if content:
            lines.append(f"{role}：{content[:120]}")

    if not lines:
        return existing_summary

    block = "\n".join(lines)
    prior = existing_summary.strip()
    system = (
        "你是 Galgame 存档摘要器。将对话压缩为一段中文摘要，保留：用户称呼/喜好、关系进展、"
        "重要事件与情绪转折。不超过 180 字。只输出摘要正文，不要列表标题。"
    )
    user = f"""已有摘要：
{prior or "（无）"}

待合并的新对话：
{block}

输出更新后的完整摘要："""
    try:
        model = aux_llm_model(settings)
        text = chat_once_with_model(
            settings,
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        ).strip()
        if not text:
            return existing_summary
        return text[:_MAX_SUMMARY_CHARS]
    except Exception as ex:
        logger.warning("summary failed: %s", ex)
        return existing_summary


def trim_messages_for_context(
    messages: list[dict[str, str]],
    *,
    keep_pairs: int,
) -> list[dict[str, str]]:
    """保留最近 keep_pairs 轮（user+assistant）对话。"""
    if keep_pairs <= 0:
        return messages[-2:]
    limit = keep_pairs * 2
    if len(messages) <= limit:
        return list(messages)
    return list(messages[-limit:])
