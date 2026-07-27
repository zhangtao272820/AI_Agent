from fastapi import APIRouter

from app.core.integrations_registry import get_integrations_payload

router = APIRouter()


@router.get("/api/integrations")
async def integrations_status():
    """返回全部集成的配置状态、待办 env 与注册地址。"""
    return get_integrations_payload()
