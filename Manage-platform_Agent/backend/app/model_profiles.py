"""企业级模型 Profile：控制台旧三槽模板（planner/executor/embedding）。

真源请用能力层 SSOT：``.env.capability-models`` + ``capability_models.py``。
本模块仅作控制台 Profile 下拉的兼容投影，勿在此维护第二套长期模型清单。
"""

from __future__ import annotations

from typing import Any

# 与 .env.capability-models / DEFAULT_CAPABILITY_MODELS 对齐（兼容投影，非独立 SSOT）
_CAP_T0 = "qwen3.5-flash-2026-02-23"
_CAP_T1 = "qwen-plus-2025-09-11"
_CAP_T2 = "qwen3-coder-flash"
_CAP_E0 = "text-embedding-v1"
_CAP_E0_RAG = "text-embedding-v3"

MODEL_PROFILES: dict[str, dict[str, Any]] = {
    "fast": {
        "label": "快速",
        "description": "低延迟、低成本，适合路由/轻量任务（T0/T0/E0）",
        "model_planner": _CAP_T0,
        "model_executor": _CAP_T0,
        "model_embedding": _CAP_E0,
    },
    "standard": {
        "label": "标准",
        "description": "通用对话与 RAG（T0 编排 + T1 作答 + E0-RAG）",
        "model_planner": _CAP_T0,
        "model_executor": _CAP_T1,
        "model_embedding": _CAP_E0_RAG,
    },
    "coder": {
        "label": "代码",
        "description": "DB / Code Agent（T0 编排 + T2 执行 + E0）",
        "model_planner": _CAP_T0,
        "model_executor": _CAP_T2,
        "model_embedding": _CAP_E0,
    },
    "manager": {
        "label": "总管",
        "description": "Manager 路由用 T0、合成用 T1",
        "model_planner": _CAP_T0,
        "model_executor": _CAP_T1,
        "model_embedding": "",
    },
    "custom": {
        "label": "自定义",
        "description": "手动指定 planner / executor / embedding",
        "model_planner": "",
        "model_executor": "",
        "model_embedding": "",
    },
}

# 新 Agent seed 时的默认 profile（非 custom 时保存/下发用 profile 展开值）
DEFAULT_AGENT_PROFILE: dict[str, str] = {
    "Manager_Agent": "manager",
    "DB_Agent": "coder",
    "code_assistent_Agent": "coder",
    "RAG_Agent": "standard",
    "Extractor_Agent": "standard",
    "AI_admin_Agent": "standard",
    "Multimodal_Agent": "fast",
    "Music_Agent": "fast",
    "Video_Agent": "fast",
    "AI_Agent": "standard",
    "Lobster_Agent": "fast",
    "Tavern_Agent": "fast",
}


def list_model_profiles() -> list[dict[str, Any]]:
    return [
        {"id": pid, **{k: v for k, v in meta.items() if k != "description"}, "description": meta.get("description", "")}
        for pid, meta in MODEL_PROFILES.items()
        if pid != "custom"
    ]


def profile_for_agent(agent_name: str, category: str = "") -> str:
    if agent_name in DEFAULT_AGENT_PROFILE:
        return DEFAULT_AGENT_PROFILE[agent_name]
    if category in ("data", "code"):
        return "coder"
    if category == "manager":
        return "manager"
    return "standard"


def resolve_profile_models(profile_id: str) -> dict[str, str]:
    pid = str(profile_id or "standard").strip() or "standard"
    if pid == "custom":
        return {"model_planner": "", "model_executor": "", "model_embedding": ""}
    meta = MODEL_PROFILES.get(pid) or MODEL_PROFILES["standard"]
    return {
        "model_planner": str(meta.get("model_planner") or ""),
        "model_executor": str(meta.get("model_executor") or ""),
        "model_embedding": str(meta.get("model_embedding") or ""),
    }


def effective_models(
    *,
    model_profile: str,
    model_planner: str,
    model_executor: str,
    model_embedding: str,
) -> dict[str, str]:
    """返回 runtime 生效模型；custom 用手动字段，否则 profile 展开。"""
    pid = str(model_profile or "standard").strip() or "standard"
    if pid == "custom":
        return {
            "model_planner": str(model_planner or "").strip(),
            "model_executor": str(model_executor or "").strip(),
            "model_embedding": str(model_embedding or "").strip(),
        }
    base = resolve_profile_models(pid)
    return {
        "model_planner": str(model_planner or base["model_planner"]).strip() or base["model_planner"],
        "model_executor": str(model_executor or base["model_executor"]).strip() or base["model_executor"],
        "model_embedding": str(model_embedding or base["model_embedding"]).strip() or base["model_embedding"],
    }
