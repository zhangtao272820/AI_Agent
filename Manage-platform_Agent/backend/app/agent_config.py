"""Agent 集群统一配置中心（P1′ + P0 签章配置包）。"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel
from sqlalchemy.orm import Session

from .config import get_settings
from .db_models import AgentConfigRecord, AgentRecord
from .managed_agents import managed_agent_specs
from .model_profiles import (
    DEFAULT_AGENT_PROFILE,
    effective_models,
    list_model_profiles,
    profile_for_agent,
    resolve_profile_models,
)
from .secret_vault import build_internal_secrets

settings = get_settings()


def _canonical_config_body(payload: dict[str, Any]) -> str:
    """稳定字段 canonical JSON（不含 secrets 明文）。"""
    body = {
        "agents": payload.get("agents"),
        "capability_configured": payload.get("capability_configured"),
        "capability_layers": payload.get("capability_layers"),
        "capability_models": payload.get("capability_models"),
        "manager_models": payload.get("manager_models"),
        "profiles": payload.get("profiles"),
        "qwen_base_url": payload.get("qwen_base_url"),
        "secret_refs": payload.get("secret_refs"),
    }
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sign_config_package(payload: dict[str, Any], *, token: str | None = None) -> dict[str, Any]:
    """写入 config_version + HMAC-SHA256 signature。"""
    secret = (token if token is not None else settings.clawhive_internal_token) or ""
    body_json = _canonical_config_body(payload)
    config_version = hashlib.sha256(body_json.encode("utf-8")).hexdigest()[:32]
    signature = ""
    if secret:
        signature = hmac.new(
            secret.encode("utf-8"),
            (config_version + body_json).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
    out = dict(payload)
    out["config_version"] = config_version
    out["signature"] = signature
    out["signed_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    out["version"] = int(time.time())
    return out


def peek_config_package_meta(db: Session) -> dict[str, str | bool]:
    """轻量读取当前配置包版本与是否已签章。"""
    try:
        pkg = build_internal_agent_config(db)
        version = str(pkg.get("config_version") or "")
        signature = str(pkg.get("signature") or "").strip()
        return {
            "config_version": version,
            "signed": bool(version and signature),
        }
    except Exception:  # noqa: BLE001
        return {"config_version": "", "signed": False}


def peek_config_version(db: Session) -> str:
    """轻量读取当前配置包版本（供 runtime 状态附带）。"""
    return str(peek_config_package_meta(db).get("config_version") or "")

_PLATFORM_UNCONFIGURED_UPDATERS = frozenset({"seed", "system", ""})


def is_platform_model_configured(updated_by: str | None) -> bool:
    """控制台未保存过模型时（seed/system）不应覆盖各 Agent 本地 .env。"""
    return str(updated_by or "").strip() not in _PLATFORM_UNCONFIGURED_UPDATERS


class AgentConfigUpdate(BaseModel):
    port: str | None = None
    endpoint: str | None = None
    model_profile: str | None = None
    model_planner: str | None = None
    model_executor: str | None = None
    model_embedding: str | None = None
    feature_flags: dict[str, Any] | None = None


class ApplyModelProfileRequest(BaseModel):
    profile_id: str
    agent_names: list[str] | None = None
    categories: list[str] | None = None
    sync_env_files: bool = False


class AgentConfigBulkItem(BaseModel):
    agent_name: str
    model_planner: str | None = None
    model_executor: str | None = None
    model_embedding: str | None = None


class AgentConfigBulkUpdate(BaseModel):
    agents: list[AgentConfigBulkItem] | None = None
    apply_to_all: bool = False
    model_planner: str | None = None
    model_executor: str | None = None
    model_embedding: str | None = None
    sync_env_files: bool = False


class GlobalModelPreset(BaseModel):
    model_planner: str
    model_executor: str
    model_embedding: str = ""
    categories: list[str] | None = None
    sync_env_files: bool = False


def _default_models_for(name: str, category: str) -> dict[str, str]:
    base = settings.qwen_model or "qwen-plus"
    planner = settings.qwen_planner_model or base
    executor = settings.qwen_executor_model or base
    if name == "Manager_Agent":
        return {
            "model_planner": planner,
            "model_executor": executor or "qwen3.5-flash",
            "model_embedding": "",
        }
    if category == "rag":
        return {
            "model_planner": planner,
            "model_executor": executor,
            "model_embedding": "text-embedding-v3",
        }
    if category in ("data", "code", "crawler", "admin"):
        return {
            "model_planner": planner,
            "model_executor": executor,
            "model_embedding": "text-embedding-v1",
        }
    return {
        "model_planner": planner,
        "model_executor": executor,
        "model_embedding": "",
    }


def _row_to_dict(row: AgentConfigRecord, spec: dict[str, str] | None = None) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    try:
        parsed = json.loads(row.feature_flags_json or "{}")
        if isinstance(parsed, dict):
            flags = parsed
    except json.JSONDecodeError:
        flags = {}
    docker_service = spec.get("docker_service", "") if spec else ""
    profile = str(getattr(row, "model_profile", None) or "standard").strip() or "standard"
    eff = effective_models(
        model_profile=profile,
        model_planner=row.model_planner,
        model_executor=row.model_executor,
        model_embedding=row.model_embedding,
    )
    configured = is_platform_model_configured(row.updated_by)
    return {
        "agent_name": row.agent_name,
        "name": row.agent_name,
        "category": row.category,
        "port": row.port,
        "endpoint": row.endpoint,
        "model_profile": profile,
        "model_planner": eff["model_planner"],
        "model_executor": eff["model_executor"],
        "model_embedding": eff["model_embedding"],
        "stored_model_planner": row.model_planner,
        "stored_model_executor": row.model_executor,
        "stored_model_embedding": row.model_embedding,
        "platform_configured": configured,
        "feature_flags": flags,
        "docker_service": docker_service,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by": row.updated_by,
    }


def _seed_models_for_agent(name: str, category: str) -> dict[str, str]:
    """优先读 Agent 本地 .env，再回退 profile / 平台全局默认。"""
    from .agent_env_registry import read_agent_env_models

    defaults = _default_models_for(name, category)
    profile = profile_for_agent(name, category)
    prof_models = resolve_profile_models(profile)
    env_models = read_agent_env_models(name).get("models") or {}
    return {
        "model_planner": str(env_models.get("planner") or prof_models["model_planner"] or defaults["model_planner"]),
        "model_executor": str(env_models.get("executor") or prof_models["model_executor"] or defaults["model_executor"]),
        "model_embedding": str(
            env_models.get("embedding") or prof_models["model_embedding"] or defaults["model_embedding"]
        ),
    }


def seed_agent_configs(db: Session) -> None:
    spec_by_name = {s["name"]: s for s in managed_agent_specs()}
    for spec in managed_agent_specs():
        name = spec["name"]
        exists = db.query(AgentConfigRecord).filter(AgentConfigRecord.agent_name == name).first()
        category = str(spec.get("category") or "general")
        profile = profile_for_agent(name, category)
        seed_models = _seed_models_for_agent(name, category)
        if exists:
            if not str(getattr(exists, "model_profile", "") or "").strip():
                exists.model_profile = profile
            if not exists.port:
                exists.port = str(spec.get("port") or "")
            if not exists.endpoint:
                exists.endpoint = str(spec.get("endpoint") or "")
            if not exists.model_planner:
                exists.model_planner = seed_models["model_planner"]
            if not exists.model_executor:
                exists.model_executor = seed_models["model_executor"]
            if not exists.model_embedding and seed_models["model_embedding"]:
                exists.model_embedding = seed_models["model_embedding"]
            exists.category = category or exists.category
            db.add(exists)
            continue
        db.add(
            AgentConfigRecord(
                agent_name=name,
                category=category,
                port=str(spec.get("port") or ""),
                endpoint=str(spec.get("endpoint") or ""),
                model_profile=profile,
                model_planner=seed_models["model_planner"],
                model_executor=seed_models["model_executor"],
                model_embedding=seed_models["model_embedding"],
                feature_flags_json="{}",
                updated_by="seed",
            )
        )
    db.commit()


def list_agent_configs(db: Session) -> list[dict[str, Any]]:
    spec_by_name = {s["name"]: s for s in managed_agent_specs()}
    rows = db.query(AgentConfigRecord).order_by(AgentConfigRecord.agent_name.asc()).all()
    if not rows:
        seed_agent_configs(db)
        rows = db.query(AgentConfigRecord).order_by(AgentConfigRecord.agent_name.asc()).all()
    return [_row_to_dict(r, spec_by_name.get(r.agent_name)) for r in rows]


def _runtime_agent_config_row(agent: dict[str, Any]) -> dict[str, Any]:
    """internal 下发：未在控制台配置过的 Agent 不携带模型字段，避免覆盖本地 .env。"""
    row = dict(agent)
    if agent.get("platform_configured"):
        return row
    row["model_planner"] = ""
    row["model_executor"] = ""
    row["model_embedding"] = ""
    return row


def build_internal_agent_config(db: Session) -> dict[str, Any]:
    from .capability_models import (
        build_manager_models_from_capabilities,
        enrich_agent_row_with_capabilities,
        get_capability_models,
        is_capability_configured,
    )

    cap_payload = get_capability_models(db)
    cap_models = cap_payload.get("models") or {}
    cap_configured = bool(cap_payload.get("capability_configured"))

    agents = list_agent_configs(db)
    runtime_agents = []
    for a in agents:
        row = _runtime_agent_config_row(a)
        if cap_configured:
            row = enrich_agent_row_with_capabilities(row, cap_models, capability_configured=True)
        else:
            row = enrich_agent_row_with_capabilities(row, cap_models, capability_configured=False)
        runtime_agents.append(row)

    manager_row = next((a for a in agents if a["agent_name"] == "Manager_Agent"), None)
    manager_models = None
    if cap_configured and cap_models:
        manager_models = build_manager_models_from_capabilities(cap_models)
    elif manager_row and manager_row.get("platform_configured"):
        manager_models = {
            "model_route": manager_row.get("model_planner") or manager_row.get("model_executor"),
            "model_plan": manager_row.get("model_planner"),
            "model_synth": manager_row.get("model_executor"),
            "model_critic": manager_row.get("model_executor"),
            "model_low_cost": manager_row.get("model_planner"),
        }
    secrets_payload = build_internal_secrets(db)
    secret_refs = secrets_payload.get("secrets") or {}
    effective_base = secret_refs.get("openai_base_url") or settings.qwen_base_url
    if settings.litellm_enabled:
        effective_base = settings.litellm_base_url
    payload = {
        "ok": True,
        "profiles": list_model_profiles(),
        "capability_models": cap_models,
        "capability_configured": cap_configured,
        "capability_layers": cap_payload.get("layers") or [],
        "agents": runtime_agents,
        "manager_models": manager_models,
        "qwen_base_url": effective_base,
        "litellm_enabled": bool(settings.litellm_enabled),
        "secret_refs": {
            "openai_api_key_ref": secrets_payload.get("openai_api_key_ref"),
            "internal_token_ref": secrets_payload.get("internal_token_ref"),
        },
        # 明文仅 internal 通道下发，供 Manager / 子 Agent 启动时注入
        "secrets": secret_refs,
    }
    return sign_config_package(payload)


def update_agent_config(
    db: Session,
    agent_name: str,
    payload: AgentConfigUpdate,
    *,
    operator: str,
) -> dict[str, Any]:
    row = db.query(AgentConfigRecord).filter(AgentConfigRecord.agent_name == agent_name).first()
    if not row:
        raise ValueError(f"未知 Agent: {agent_name}")

    changes: list[str] = []
    if payload.model_profile is not None:
        prof = str(payload.model_profile).strip() or "standard"
        if prof != str(getattr(row, "model_profile", "") or ""):
            changes.append(f"model_profile:{row.model_profile}->{prof}")
            row.model_profile = prof
        if prof != "custom":
            resolved = resolve_profile_models(prof)
            payload = AgentConfigUpdate(
                port=payload.port,
                endpoint=payload.endpoint,
                model_profile=prof,
                model_planner=resolved["model_planner"],
                model_executor=resolved["model_executor"],
                model_embedding=resolved["model_embedding"] or None,
                feature_flags=payload.feature_flags,
            )
        elif payload.model_planner is not None or payload.model_executor is not None or payload.model_embedding is not None:
            row.model_profile = "custom"
    if payload.port is not None and payload.port != row.port:
        changes.append(f"port:{row.port}->{payload.port}")
        row.port = payload.port.strip()
    if payload.endpoint is not None and payload.endpoint != row.endpoint:
        changes.append(f"endpoint:{row.endpoint}->{payload.endpoint}")
        row.endpoint = payload.endpoint.strip()
    if payload.model_planner is not None and payload.model_planner != row.model_planner:
        changes.append(f"model_planner:{row.model_planner}->{payload.model_planner}")
        row.model_planner = payload.model_planner.strip()
    if payload.model_executor is not None and payload.model_executor != row.model_executor:
        changes.append(f"model_executor:{row.model_executor}->{payload.model_executor}")
        row.model_executor = payload.model_executor.strip()
    if payload.model_embedding is not None and payload.model_embedding != row.model_embedding:
        changes.append(f"model_embedding:{row.model_embedding}->{payload.model_embedding}")
        row.model_embedding = payload.model_embedding.strip()
    if any(c.startswith("model_planner:") or c.startswith("model_executor:") or c.startswith("model_embedding:") for c in changes):
        if not any(c.startswith("model_profile:") for c in changes):
            row.model_profile = "custom"
    if payload.feature_flags is not None:
        row.feature_flags_json = json.dumps(payload.feature_flags, ensure_ascii=False)
        changes.append("feature_flags:updated")

    row.updated_by = operator
    db.add(row)

    agent = db.query(AgentRecord).filter(AgentRecord.name == agent_name).first()
    if agent and payload.endpoint is not None:
        agent.endpoint = row.endpoint
        db.add(agent)

    db.commit()
    spec_by_name = {s["name"]: s for s in managed_agent_specs()}
    out = _row_to_dict(row, spec_by_name.get(agent_name))
    out["requires_restart"] = any(c.startswith("port:") or c.startswith("endpoint:") for c in changes)
    out["changes"] = changes
    return out


def apply_model_profile(
    db: Session,
    payload: ApplyModelProfileRequest,
    *,
    operator: str,
) -> dict[str, Any]:
    from .agent_env_registry import write_model_keys_to_env

    prof = str(payload.profile_id or "").strip()
    if prof not in {p["id"] for p in list_model_profiles()} and prof != "custom":
        raise ValueError(f"未知 profile: {prof}")
    resolved = resolve_profile_models(prof)
    rows = db.query(AgentConfigRecord).all()
    targets: list[AgentConfigRecord] = []
    name_set = set(payload.agent_names or [])
    cat_set = set(payload.categories or [])
    for row in rows:
        if name_set and row.agent_name not in name_set:
            continue
        if cat_set and row.category not in cat_set:
            continue
        if not name_set and not cat_set:
            targets.append(row)
        else:
            targets.append(row)

    updated: list[str] = []
    for row in targets:
        row.model_profile = prof
        row.model_planner = resolved["model_planner"]
        row.model_executor = resolved["model_executor"]
        row.model_embedding = resolved["model_embedding"]
        row.updated_by = operator
        db.add(row)
        updated.append(row.agent_name)
        if payload.sync_env_files:
            write_model_keys_to_env(
                row.agent_name,
                {
                    "planner": resolved["model_planner"],
                    "executor": resolved["model_executor"],
                    "embedding": resolved["model_embedding"],
                },
            )
    db.commit()
    return {
        "ok": True,
        "profile_id": prof,
        "updated_agents": updated,
        "models": resolved,
        "env_synced": updated if payload.sync_env_files else [],
    }


def bulk_update_agent_configs(
    db: Session,
    payload: AgentConfigBulkUpdate,
    *,
    operator: str,
) -> dict[str, Any]:
    from .agent_env_registry import write_model_keys_to_env

    rows = list_agent_configs(db)
    name_set = {r["agent_name"] for r in rows}
    targets: list[dict[str, str | None]] = []

    if payload.apply_to_all:
        for r in rows:
            targets.append(
                {
                    "agent_name": r["agent_name"],
                    "model_planner": payload.model_planner,
                    "model_executor": payload.model_executor,
                    "model_embedding": payload.model_embedding,
                }
            )
    elif payload.agents:
        for item in payload.agents:
            if item.agent_name not in name_set:
                continue
            targets.append(
                {
                    "agent_name": item.agent_name,
                    "model_planner": item.model_planner if item.model_planner is not None else payload.model_planner,
                    "model_executor": item.model_executor if item.model_executor is not None else payload.model_executor,
                    "model_embedding": item.model_embedding if item.model_embedding is not None else payload.model_embedding,
                }
            )

    updated: list[dict[str, Any]] = []
    env_synced: list[str] = []
    for t in targets:
        name = str(t["agent_name"])
        patch = AgentConfigUpdate(
            model_planner=t.get("model_planner"),
            model_executor=t.get("model_executor"),
            model_embedding=t.get("model_embedding"),
        )
        if not any([patch.model_planner, patch.model_executor, patch.model_embedding]):
            continue
        try:
            result = update_agent_config(db, name, patch, operator=operator)
            updated.append(result)
            if payload.sync_env_files:
                write_model_keys_to_env(
                    name,
                    {
                        "planner": patch.model_planner or "",
                        "executor": patch.model_executor or "",
                        "embedding": patch.model_embedding or "",
                    },
                )
                env_synced.append(name)
        except ValueError:
            continue

    return {"ok": True, "updated_count": len(updated), "updated": updated, "env_synced": env_synced}


def apply_global_model_preset(
    db: Session,
    preset: GlobalModelPreset,
    *,
    operator: str,
) -> dict[str, Any]:
    rows = list_agent_configs(db)
    cats = set(preset.categories or [])
    targets = [
        r["agent_name"]
        for r in rows
        if not cats or str(r.get("category") or "") in cats
    ]
    bulk = AgentConfigBulkUpdate(
        agents=[AgentConfigBulkItem(agent_name=n) for n in targets],
        model_planner=preset.model_planner,
        model_executor=preset.model_executor,
        model_embedding=preset.model_embedding or None,
        sync_env_files=preset.sync_env_files,
    )
    out = bulk_update_agent_configs(db, bulk, operator=operator)
    out["preset"] = {
        "model_planner": preset.model_planner,
        "model_executor": preset.model_executor,
        "model_embedding": preset.model_embedding,
        "categories": preset.categories,
    }
    return out
