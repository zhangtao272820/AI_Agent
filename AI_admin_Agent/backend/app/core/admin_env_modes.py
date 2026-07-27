"""Admin 语义 MODE：ADMIN_NLU_MODE / ADMIN_MEMORY_MODE / ADMIN_EVOLUTION_MODE。"""
from __future__ import annotations

import os

_OFF = frozenset({"0", "false", "off", "no", "disabled"})


def _token(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or "").strip().lower()


def resolve_admin_nlu_mode() -> str:
    mode = _token("ADMIN_NLU_MODE")
    if mode in ("full", "default", "on", "1"):
        return "full"
    if mode in ("legacy", "classic"):
        return "legacy"
    if mode in ("fast", "lite", "minimal"):
        return "fast"
    if _token("ADMIN_NLU") in _OFF:
        return "legacy"
    return "full"


def is_admin_nlu_enabled() -> bool:
    return resolve_admin_nlu_mode() != "legacy"


def is_admin_nlu_decoupled() -> bool:
    if _token("ADMIN_NLU_DECOUPLED") in _OFF:
        return False
    return resolve_admin_nlu_mode() == "full"


def is_admin_chitchat_fastpath_enabled() -> bool:
    if _token("ADMIN_CHITCHAT_FASTPATH") in _OFF:
        return False
    return resolve_admin_nlu_mode() in ("full", "fast")


def is_admin_intent_rag_enabled() -> bool:
    if _token("ADMIN_INTENT_RAG") in _OFF:
        return False
    return resolve_admin_nlu_mode() == "full"


def is_admin_scenario_llm_enabled() -> bool:
    if _token("ADMIN_SCENARIO_LLM") in _OFF:
        return False
    return resolve_admin_nlu_mode() == "full"


def resolve_admin_memory_mode() -> str:
    mode = _token("ADMIN_MEMORY_MODE")
    if mode in ("standard", "default", "full", "on", "1"):
        return "standard"
    if mode in ("minimal", "lite"):
        return "minimal"
    if mode in ("off", "0", "false", "no"):
        return "off"
    return "standard"


def is_admin_load_playbook_enabled() -> bool:
    if _token("ADMIN_LOAD_PLAYBOOK") in _OFF:
        return False
    return resolve_admin_memory_mode() != "off"


def is_admin_auto_learn_prefs_enabled() -> bool:
    if _token("ADMIN_AUTO_LEARN_PREFS") in _OFF:
        return False
    return resolve_admin_memory_mode() == "standard"


def is_admin_dialogue_summary_enabled() -> bool:
    if _token("ADMIN_DIALOGUE_SUMMARY") in _OFF:
        return False
    return resolve_admin_memory_mode() != "off"


def resolve_admin_evolution_mode() -> str:
    mode = _token("ADMIN_EVOLUTION_MODE") or _token("EVO_MODE")
    if mode in ("off", "0", "false", "no"):
        return "off"
    if mode in ("learning", "experiment", "full"):
        return "learning"
    return "convergence"


def is_admin_prompt_evolution_enabled() -> bool:
    if _token("ADMIN_PROMPT_EVOLUTION") in _OFF:
        return False
    return resolve_admin_evolution_mode() != "off"


def is_admin_auto_curate_enabled() -> bool:
    if _token("ADMIN_AUTO_CURATE") in _OFF:
        return False
    return resolve_admin_evolution_mode() == "convergence"
