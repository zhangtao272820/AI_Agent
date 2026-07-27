"""会话级记忆：L2 事实提取、标签与 prompt 注入（无向量库）。"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, Field

from .prompt_budget import MEMORY_IN_PROMPT, MEMORY_STORE_MAX

_MAX_MEMORIES = MEMORY_STORE_MAX
_MAX_IN_PROMPT = MEMORY_IN_PROMPT


class MemoryFact(BaseModel):
    text: str = Field(..., min_length=1, max_length=120)
    source: str = Field("user", pattern="^(user|system)$")
    tags: list[str] = Field(default_factory=list)


_PATTERNS: list[tuple[re.Pattern[str], str, list[str]]] = [
    (re.compile(r"我叫([^\s，。！？,.!?]{1,12})"), "用户自称{name}", ["user_name"]),
    (re.compile(r"我是([^\s，。！？,.!?]{1,16})"), "用户身份/自称：{name}", ["user_name"]),
    (re.compile(r"我喜欢([^\s，。！？,.!?]{1,20})"), "用户喜欢{name}", ["preference"]),
    (re.compile(r"我最(?:喜欢|爱)([^\s，。！？,.!?]{1,20})"), "用户最喜欢{name}", ["preference"]),
    (re.compile(r"我(?:不|讨厌|害怕)([^\s，。！？,.!?]{1,16})"), "用户不喜欢/害怕{name}", ["preference"]),
    (re.compile(r"我的(?:生日|生日是)([^\s，。！？,.!?]{1,20})"), "用户生日：{name}", ["user_name", "preference"]),
    (re.compile(r"我住在([^\s，。！？,.!?]{1,20})"), "用户住在{name}", ["preference"]),
    (re.compile(r"我在([^\s，。！？,.!?]{1,20})(?:工作|上班|读书|学习)"), "用户在{name}", ["preference"]),
    (re.compile(r"记住[：:，,\s]?(.{2,40})"), "用户希望记住：{name}", ["event"]),
]


def extract_memories(user_text: str, existing: list[MemoryFact]) -> list[MemoryFact]:
    """遗留规则提取；主路径优先 memory_llm。"""
    text = user_text.strip()
    if not text:
        return []

    seen = {m.text for m in existing}
    found: list[MemoryFact] = []

    for pattern, template, tags in _PATTERNS:
        for match in pattern.finditer(text):
            name = match.group(1).strip("「」\"' ")
            if not name or len(name) < 2:
                continue
            fact_text = template.format(name=name)
            if fact_text in seen:
                continue
            seen.add(fact_text)
            found.append(MemoryFact(text=fact_text, source="user", tags=list(tags)))

    if "生日" in text and "我的生日" not in text:
        rough = re.search(r"生日(?:是|在)?([^\s，。！？,.!?]{2,16})", text)
        if rough:
            fact = f"用户提到生日：{rough.group(1).strip()}"
            if fact not in seen:
                found.append(MemoryFact(text=fact, source="user", tags=["preference"]))

    return found


def merge_memories(existing: list[MemoryFact], new_items: list[MemoryFact]) -> list[MemoryFact]:
    merged = list(existing)
    seen = {m.text for m in merged}
    for item in new_items:
        if item.text in seen:
            continue
        merged.append(item)
        seen.add(item.text)
    if len(merged) > _MAX_MEMORIES:
        merged = merged[-_MAX_MEMORIES:]
    return merged


def select_memories_for_prompt(
    memories: list[MemoryFact],
    *,
    user_text: str = "",
    summary: str = "",
    agenda_goal: str = "",
    location_id: str = "",
    trust: int = 70,
    flags: dict[str, bool] | None = None,
) -> list[MemoryFact]:
    if not memories:
        return []
    flags = flags or {}
    can_secret = int(trust or 0) >= 70 or bool(flags.get("secret_disclosed"))

    def _allowed(m: MemoryFact) -> bool:
        tags = m.tags or []
        if any(t in {"secret", "lie"} for t in tags):
            return can_secret
        return True

    visible = [m for m in memories if _allowed(m)]
    if not visible:
        return []
    blob = f"{user_text} {summary} {agenda_goal} {location_id}".strip()
    if blob:
        scored: list[tuple[int, int, MemoryFact]] = []
        for idx, m in enumerate(visible):
            score = 0
            tags = m.tags or []
            for tag in tags:
                if tag and tag in blob:
                    score += 3
            if agenda_goal and any(t in tags for t in ("promise", "agenda", "event", "jealousy")):
                score += 2
            if location_id and location_id in (m.text or ""):
                score += 2
            text = m.text or ""
            for kw in ("约", "见面", "喜欢", "生日"):
                if kw in blob and kw in text:
                    score += 1
            scored.append((score, idx, m))
        scored.sort(key=lambda x: (x[0], x[1]))
        top = [m for s, _i, m in scored if s > 0][-_MAX_IN_PROMPT:]
        if top:
            return top
    return visible[-_MAX_IN_PROMPT:]


def memory_prompt_block(
    memories: list[MemoryFact],
    *,
    user_text: str = "",
    summary: str = "",
    agenda_goal: str = "",
    location_id: str = "",
    trust: int = 70,
    flags: dict[str, bool] | None = None,
) -> str:
    picked = select_memories_for_prompt(
        memories,
        user_text=user_text,
        summary=summary,
        agenda_goal=agenda_goal,
        location_id=location_id,
        trust=trust,
        flags=flags,
    )
    parts: list[str] = []
    if summary.strip():
        parts.append(f"【此前对话摘要】\n{summary.strip()}")
    if picked:
        lines = [f"- {m.text}" for m in picked]
        parts.append("【共同记忆（务必在合适时机自然引用，不要生硬复读）】\n" + "\n".join(lines))
    return "\n\n".join(parts)


def public_memories(memories: list[MemoryFact]) -> list[dict[str, Any]]:
    return [m.model_dump() for m in memories[-_MAX_IN_PROMPT:]]
