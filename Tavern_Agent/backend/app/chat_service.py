import logging
from typing import Any

from openai import OpenAI

from .catalog import CharacterDef, WineDef
from .config import Settings
from .matrix import BehaviorParams, compute_params, find_character, find_wine, params_to_dict
from .prompts import build_system_prompt

logger = logging.getLogger(__name__)


def chat_once(
    settings: Settings,
    *,
    wine_id: str,
    character_id: str,
    user_message: str,
    history: list[dict[str, str]] | None = None,
) -> tuple[str, dict[str, Any]]:
    wine = find_wine(wine_id)
    character = find_character(character_id)
    if not wine or not character:
        raise ValueError("unknown wine_id or character_id")

    params = compute_params(wine_id, character_id)
    system = build_system_prompt(wine, character, params)

    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)

    messages: list[dict[str, str]] = [{"role": "system", "content": system}]
    if history:
        for m in history[-16:]:
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and isinstance(content, str):
                messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})

    completion = client.chat.completions.create(
        model=settings.openai_model,
        messages=messages,
        temperature=0.95,
        max_tokens=900,
    )
    text = completion.choices[0].message.content or ""

    meta = {
        "wine": {"id": wine["id"], "name": wine["name"]},
        "character": {"id": character["id"], "name": character["name"]},
        "behavior": params_to_dict(params),
    }
    return text.strip(), meta
