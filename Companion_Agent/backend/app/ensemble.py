"""双人同场（ensemble）会话：最多 2 人全身立绘 + speaker 轮换。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EnsembleState(BaseModel):
    enabled: bool = False
    cast_ids: list[str] = Field(default_factory=list)
    focus_id: str = ""
    speaking_id: str = ""
    guest_affinity_ok: bool = True
    cast: list[dict[str, Any]] = Field(default_factory=list)
    guest_reaction: str = ""


def empty_ensemble() -> EnsembleState:
    return EnsembleState()


def build_ensemble(
    *,
    focus_id: str,
    guest_id: str,
    cast: list[dict[str, Any]],
    guest_affinity_ok: bool = True,
) -> EnsembleState:
    focus = (focus_id or "").strip()
    guest = (guest_id or "").strip()
    ids = [c for c in [focus, guest] if c]
    # de-dupe preserve order
    seen: set[str] = set()
    ordered: list[str] = []
    for cid in ids:
        if cid not in seen:
            seen.add(cid)
            ordered.append(cid)
    if len(ordered) < 2:
        return empty_ensemble()
    members = [m for m in cast if (m.get("character_id") or "") in ordered]
    # keep focus first then guest
    members.sort(key=lambda m: 0 if m.get("character_id") == focus else 1)
    return EnsembleState(
        enabled=True,
        cast_ids=ordered[:2],
        focus_id=focus,
        speaking_id=focus,
        guest_affinity_ok=guest_affinity_ok,
        cast=members[:2],
        guest_reaction="",
    )


def public_ensemble(raw: EnsembleState | dict[str, Any] | None) -> dict[str, Any] | None:
    if not raw:
        return None
    if isinstance(raw, EnsembleState):
        data = raw.model_dump()
    else:
        data = dict(raw)
    if not data.get("enabled"):
        return None
    return data


def ensemble_prompt_block(ens: EnsembleState | dict[str, Any] | None) -> str:
    """注入双人演绎契约（单次主模型产出 speaker + 可选旁观短句）。"""
    if not ens:
        return ""
    data = ens.model_dump() if isinstance(ens, EnsembleState) else dict(ens)
    if not data.get("enabled"):
        return ""
    cast_ids = list(data.get("cast_ids") or [])
    if len(cast_ids) < 2:
        return ""
    names: list[str] = []
    for m in data.get("cast") or []:
        cid = str(m.get("character_id") or "")
        nm = str(m.get("name") or cid)
        if cid:
            names.append(f"{nm}({cid})")
    focus = str(data.get("focus_id") or cast_ids[0])
    ids_csv = ",".join(cast_ids)
    return (
        f"\n【双人同场】本场最多两人：{'、'.join(names) or ids_csv}。"
        f"焦点是 {focus}。"
        "每轮回复开头必须带一行标记：【speaker:角色id】（角色id 必须是 "
        f"{ids_csv} 之一）。"
        "主台词只写当前说话者；另一人不要抢长段。"
        "可选追加一行【guest:一句旁观反应】（可省略）。"
        "禁止念系统字段或旁白说明书。"
    )


def apply_speaker_to_parsed(
    parsed: dict[str, Any],
    *,
    ens: EnsembleState | dict[str, Any] | None,
) -> tuple[dict[str, Any], EnsembleState | None]:
    """把 parse 出的 speaker_id / guest_reaction 写回 ensemble。"""
    if not ens:
        return parsed, None
    state = EnsembleState.model_validate(ens) if not isinstance(ens, EnsembleState) else ens.model_copy(deep=True)
    if not state.enabled:
        return parsed, state
    allowed = set(state.cast_ids)
    speaker = str(parsed.get("speaker_id") or "").strip()
    if speaker and speaker in allowed:
        state.speaking_id = speaker
    elif not state.speaking_id:
        state.speaking_id = state.focus_id or (state.cast_ids[0] if state.cast_ids else "")
    reaction = str(parsed.get("guest_reaction") or "").strip()
    state.guest_reaction = reaction[:80] if reaction else ""
    return parsed, state
