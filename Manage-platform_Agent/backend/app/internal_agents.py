from fastapi import Header, HTTPException

from .config import get_settings
from .db import SessionLocal
from .db_models import AgentRecord
from .managed_agents import managed_agent_specs

settings = get_settings()


def verify_internal_token(x_clawhive_internal_token: str | None) -> None:
    expected = str(getattr(settings, "clawhive_internal_token", "") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="CLAWHIVE_INTERNAL_TOKEN 未配置")
    got = str(x_clawhive_internal_token or "").strip()
    if not got or got != expected:
        raise HTTPException(status_code=401, detail="无效的内部服务令牌")


def build_internal_agent_endpoints() -> dict:
    db = SessionLocal()
    try:
        rows = db.query(AgentRecord).order_by(AgentRecord.name.asc()).all()
        agents = [
            {
                "name": r.name,
                "category": r.category,
                "endpoint": r.endpoint,
                "status": r.status,
                "agent_id": r.agent_id,
            }
            for r in rows
        ]
    finally:
        db.close()

    if not agents:
        agents = [
            {
                "name": spec["name"],
                "category": spec["category"],
                "endpoint": spec["endpoint"],
                "status": "unknown",
            }
            for spec in managed_agent_specs()
        ]

    return {
        "ok": True,
        "agents": agents,
        "specs": managed_agent_specs(),
        "manager_endpoint": f"http://{settings.manager_agent_host}:{settings.manager_agent_port}",
    }
