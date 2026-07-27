from typing import Any

from .config import get_settings
from .managed_agents import managed_agent_specs

settings = get_settings()


def build_platform_env_snapshot() -> dict[str, Any]:
    agents = [
        {
            "name": spec["name"],
            "category": spec.get("category", ""),
            "endpoint": spec.get("endpoint", ""),
            "docker_service": spec.get("docker_service", ""),
            "port": spec.get("port", ""),
            "runner": spec.get("runner", ""),
            "run": spec.get("run", ""),
        }
        for spec in managed_agent_specs()
    ]
    core = {
        "deploy_mode": settings.deploy_mode,
        "workspace_root": settings.workspace_root,
        "agent_control_mode": settings.agent_control_mode,
        "manager_endpoint": f"http://{settings.manager_agent_host}:{settings.manager_agent_port}",
        "internal_sync_configured": bool(str(getattr(settings, "clawhive_internal_token", "") or "").strip()),
    }
    return {
        "ok": True,
        "core": core,
        "agents": agents,
        "compose_file": "Manage-platform_Agent/docker-compose.agents-lan.yml",
        "env_template": "Manage-platform_Agent/.env.agents-lan",
    }
