"""LLM 结构化记忆抽取（替代正则意图提取）。"""

from __future__ import annotations

import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from .config import Settings, api_key, aux_llm_model
from .memory import MemoryFact
from .qwen_character import chat_once_with_model

logger = logging.getLogger(__name__)


class MemoryExtractOut(BaseModel):
    facts: list[str] = Field(default_factory=list)
    likes_add: list[str] = Field(default_factory=list)
    dislikes_add: list[str] = Field(default_factory=list)
    confidence: float = 0.0


_SYSTEM = """你是恋爱养成游戏的记忆官。根据本轮对话，抽取「关于用户或双方」的稳定事实。
只输出 JSON：
{"facts":["短句事实"],"likes_add":["她新表露的喜好"],"dislikes_add":["雷点"],"confidence":0.0~1.0}
规则：
- facts 最多 3 条，每条不超过 40 字；无新信息则 facts=[]。
- 不要编造；confidence < 0.5 时 facts 必须为空。
- 禁止输出 markdown。"""


def should_extract_memories_llm(
    settings: Settings,
    *,
    user_text: str,
    turn_n: int,
) -> bool:
    """正常游玩保留记忆质量；短敷衍 / 过密调用则跳过 aux。"""
    if not bool(settings.companion_memory_llm_enabled):
        return False
    if not api_key(settings):
        return False
    text = (user_text or "").strip()
    min_chars = max(1, int(settings.companion_memory_llm_min_chars or 8))
    if len(text) < min_chars:
        return False
    from .life_friction import is_structurally_cold_input

    if is_structurally_cold_input(text):
        return False
    every = max(1, int(settings.companion_memory_llm_every_turns or 3))
    # 前两轮实质发言必抽（名字/喜好落地）；其后每隔 N 轮
    if turn_n <= 2:
        return True
    return turn_n % every == 0


def extract_memories_llm(
    settings: Settings,
    *,
    user_text: str,
    assistant_text: str,
    character_name: str,
) -> list[MemoryFact]:
    if not api_key(settings):
        return []
    user_blob = (
        f"角色：{character_name}\n"
        f"用户说：{user_text}\n"
        f"角色答：{assistant_text[:400]}\n"
        "请抽取记忆 JSON。"
    )
    try:
        raw = chat_once_with_model(
            settings,
            model=aux_llm_model(settings),
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_blob},
            ],
        )
        text = (raw or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:].strip()
        data = json.loads(text)
        parsed = MemoryExtractOut.model_validate(data)
        if parsed.confidence < 0.5:
            return []
        out: list[MemoryFact] = []
        for fact in parsed.facts[:3]:
            fact = str(fact).strip()
            if len(fact) >= 2:
                out.append(MemoryFact(text=fact[:120], source="user", tags=["llm"]))
        for like in parsed.likes_add[:2]:
            like = str(like).strip()
            if like:
                out.append(MemoryFact(text=f"{character_name}喜欢：{like}"[:120], source="system", tags=["preference"]))
        for dislike in parsed.dislikes_add[:2]:
            dislike = str(dislike).strip()
            if dislike:
                out.append(
                    MemoryFact(
                        text=f"{character_name}不喜欢：{dislike}"[:120],
                        source="system",
                        tags=["preference"],
                    )
                )
        return out
    except Exception as ex:
        logger.warning("memory llm extract failed: %s", ex)
        return []


def apply_preference_patches(
    preferences: dict[str, Any],
    facts: list[MemoryFact],
) -> dict[str, Any]:
    likes = list(preferences.get("likes") or [])
    dislikes = list(preferences.get("dislikes") or [])
    for m in facts:
        if "喜欢：" in m.text and m.text not in likes:
            likes.append(m.text.split("喜欢：", 1)[-1][:40])
        if "不喜欢：" in m.text and m.text not in dislikes:
            dislikes.append(m.text.split("不喜欢：", 1)[-1][:40])
    return {
        **preferences,
        "likes": likes[-12:],
        "dislikes": dislikes[-12:],
    }
