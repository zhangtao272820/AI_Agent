"""全量集成清单：配置项、注册地址、当前是否就绪。"""
from __future__ import annotations

import json
import os
from typing import Any

from app.core.config import settings
from app.core.amap_client import amap_configured
from app.core.db_client import db_agent_configured
from app.core.lobster_client import lobster_agent_configured
from app.core.rag_client import rag_agent_configured
from app.core.webhook_notify import webhook_configured
from app.core.web_search import resolve_search_provider, search_mock_enabled
from app.core.playground_catalog import mineru_configured, mcp_enabled
from app.core.mcp_playground import check_mcp_gateway, mcp_gateway_base_url


def _env(name: str) -> str:
    return str(os.getenv(name) or "").strip()


def _configured(*names: str) -> bool:
    return all(_env(n) for n in names)


def _optional_configured(*names: str) -> bool:
    return any(_env(n) for n in names)


def integration_catalog() -> list[dict[str, Any]]:
    """返回所有集成的 SSOT（供 /api/integrations 与文档生成）。"""
    return [
        {
            "id": "dashscope",
            "name": "阿里云百炼 / 通义模型",
            "tier": "required",
            "billing": "usage",
            "configured": bool(settings.DASHSCOPE_API_KEY),
            "env": ["DASHSCOPE_API_KEY", "MODEL_NAME"],
            "registerUrl": "https://bailian.console.aliyun.com/",
            "docHint": "唯一必填外部 API；新账号通常有免费额度，按量计费",
        },
        {
            "id": "rag",
            "name": "RAG 知识库",
            "tier": "recommended",
            "configured": rag_agent_configured(),
            "env": ["RAG_AGENT_URL"],
            "registerUrl": None,
            "docHint": "LAN 部署填 http://rag_agent:13102；需先启动 RAG_Agent 并入库文档",
        },
        {
            "id": "db_ask",
            "name": "DB 自然语言问数",
            "tier": "recommended",
            "configured": db_agent_configured(),
            "env": ["DB_AGENT_HTTP_URL", "DB_AGENT_DB_ID"],
            "registerUrl": None,
            "docHint": "填 http://db_agent:13101；DB_Agent 需配置 MySQL 等数据源",
        },
        {
            "id": "weather",
            "name": "和风天气",
            "tier": "optional",
            "billing": "free_tier",
            "configured": bool(settings.WEATHER_API_KEY and settings.WEATHER_API_HOST),
            "env": ["WEATHER_API_KEY", "WEATHER_API_HOST"],
            "docHint": "控制台设置中复制专属 API Host；公共 devapi/geoapi 域名已停用",
            "registerUrl": "https://dev.qweather.com/",
            "docHint": "开发者免费版每日有配额；不配置则简报跳过天气",
        },
        {
            "id": "mail_qq",
            "name": "QQ 邮箱（SMTP/IMAP）",
            "tier": "optional",
            "configured": _configured("SMTP_USER", "SMTP_PASS"),
            "env": ["SMTP_SERVER=smtp.qq.com", "SMTP_PORT=465", "SMTP_USER", "SMTP_PASS", "IMAP_SERVER=imap.qq.com"],
            "registerUrl": "https://mail.qq.com/",
            "docHint": "QQ 邮箱 → 设置 → 账户 → 开启 SMTP/IMAP → 生成授权码填 SMTP_PASS/IMAP_PASS",
        },
        {
            "id": "mail_163",
            "name": "网易 163 邮箱",
            "tier": "optional",
            "configured": _configured("SMTP_USER", "SMTP_PASS") and "163.com" in _env("SMTP_USER"),
            "env": ["SMTP_SERVER=smtp.163.com", "IMAP_SERVER=imap.163.com", "SMTP_USER", "SMTP_PASS"],
            "registerUrl": "https://mail.163.com/",
            "docHint": "设置 → POP3/SMTP/IMAP → 开启并获取授权码",
        },
        {
            "id": "mail_exmail",
            "name": "腾讯企业邮",
            "tier": "optional",
            "configured": _configured("SMTP_USER", "SMTP_PASS") and "exmail.qq.com" in (_env("SMTP_SERVER") + _env("IMAP_SERVER")),
            "env": ["SMTP_SERVER=smtp.exmail.qq.com", "IMAP_SERVER=imap.exmail.qq.com", "SMTP_USER", "SMTP_PASS"],
            "registerUrl": "https://exmail.qq.com/",
            "docHint": "企业邮管理后台开启客户端授权",
        },
        {
            "id": "wecom",
            "name": "企业微信群机器人",
            "tier": "optional",
            "configured": _optional_configured("ADMIN_WEBHOOK_URL", "ADMIN_WECOM_WEBHOOK_URL"),
            "env": ["ADMIN_WEBHOOK_URL 或 ADMIN_WECOM_WEBHOOK_URL", "ADMIN_WEBHOOK_FORMAT=wecom"],
            "registerUrl": "https://work.weixin.qq.com/",
            "docHint": "群聊 → 群机器人 → 添加 → 复制 Webhook 地址",
        },
        {
            "id": "dingtalk",
            "name": "钉钉群机器人",
            "tier": "optional",
            "configured": bool(settings.ADMIN_DINGTALK_WEBHOOK_URL),
            "env": ["ADMIN_DINGTALK_WEBHOOK_URL"],
            "registerUrl": "https://open.dingtalk.com/",
            "docHint": "群设置 → 智能群助手 → 添加机器人 → 自定义 Webhook",
        },
        {
            "id": "feishu_bot",
            "name": "飞书群机器人",
            "tier": "optional",
            "configured": bool(settings.ADMIN_FEISHU_WEBHOOK_URL),
            "env": ["ADMIN_FEISHU_WEBHOOK_URL"],
            "registerUrl": "https://open.feishu.cn/",
            "docHint": "群设置 → 群机器人 → 添加自定义机器人 → Webhook",
        },
        {
            "id": "feishu_calendar",
            "name": "飞书日历 ICS 订阅",
            "tier": "optional",
            "configured": bool(settings.ADMIN_FEISHU_ICS_URL or settings.ADMIN_CALENDAR_ICS_URL),
            "env": ["ADMIN_FEISHU_ICS_URL"],
            "registerUrl": "https://www.feishu.cn/",
            "docHint": "飞书日历 → 设置 → 日历订阅 → 复制 ICS/http 链接",
        },
        {
            "id": "calendar_multi",
            "name": "多日历 ICS 订阅",
            "tier": "optional",
            "configured": bool(settings.ADMIN_CALENDAR_SUBSCRIPTIONS),
            "env": ["ADMIN_CALENDAR_SUBSCRIPTIONS"],
            "docHint": 'JSON：{"feishu":"http://...","dingtalk":"webcal://..."}，工具 sync_all_calendars',
        },
        {
            "id": "amap",
            "name": "高德地图路线",
            "tier": "optional",
            "billing": "free_tier",
            "configured": amap_configured(),
            "env": ["ADMIN_AMAP_KEY", "ADMIN_AMAP_CITY"],
            "registerUrl": "https://lbs.amap.com/",
            "docHint": "个人 Web 服务 Key；工具：路线 get_travel_route、POI search_places_amap/search_nearby_amap、地址 resolve/suggest_address_amap",
        },
        {
            "id": "lobster",
            "name": "Lobster 浏览器自动化",
            "tier": "optional",
            "configured": lobster_agent_configured(),
            "env": ["LOBSTER_AGENT_HTTP_URL", "LOBSTER_ADMIN_TOKEN 或 CLAWHIVE_INTERNAL_TOKEN"],
            "registerUrl": None,
            "docHint": "启动 lobster_agent 容器（extended profile）；填 http://lobster_agent:13108",
        },
        {
            "id": "web_search",
            "name": "联网搜索（SearXNG / DuckDuckGo）",
            "tier": "optional",
            "billing": "free",
            "configured": resolve_search_provider() not in ("none", "mock") and not search_mock_enabled(),
            "env": [
                "SEARXNG_BASE_URL=http://searxng:8080",
                "ADMIN_SEARCH_PROVIDER=auto",
                "WEB_SEARCH_ALLOW_DDG_FALLBACK=1",
            ],
            "registerUrl": None,
            "docHint": "Docker 栈已含 searxng 容器；Admin auto 优先走 SearXNG 获取实时资讯",
        },
        {
            "id": "admin_mcp_gateway",
            "name": "MCP 趣味侧车网关（fun-mcp profile）",
            "tier": "optional",
            "billing": "free",
            "configured": check_mcp_gateway().get("ok") is True and mcp_enabled(),
            "env": [
                "docker compose --profile fun-mcp up admin_mcp_gateway",
                "ADMIN_MCP_ENABLED=1",
                f"ADMIN_MCP_GATEWAY_URL={mcp_gateway_base_url()}",
                "ADMIN_MCP_SERVERS=见 docker/admin-mcp-servers.example.json",
            ],
            "registerUrl": None,
            "docHint": "Phase 2/3：supergateway 暴露 china-hot/bilibili/arxiv 等 MCP",
        },
        {
            "id": "playground_suite",
            "name": "玩法台 · MCP 趣味八件套（内置）",
            "tier": "optional",
            "billing": "free",
            "configured": True,
            "env": [],
            "registerUrl": None,
            "docHint": "热榜/B站/arXiv/记忆墙/链接精读等 8 项已内置；见 doc/MCP趣味八件套-分阶段接入.md",
        },
        {
            "id": "playground_mineru",
            "name": "MinerU 文档解析（可选）",
            "tier": "optional",
            "configured": mineru_configured(),
            "env": ["MINERU_API_URL=http://mineru:8000/parse"],
            "registerUrl": "https://github.com/opendatalab/MinerU",
            "docHint": "PDF/PPT 深度解析；未配置时 parse_document 仅读纯文本",
        },
        {
            "id": "feishu_mcp",
            "name": "飞书 MCP（可选侧车）",
            "tier": "advanced",
            "configured": _env("ADMIN_FEISHU_MCP_URL") and _env("ADMIN_MCP_ENABLED") == "1",
            "env": ["ADMIN_MCP_ENABLED=1", "ADMIN_FEISHU_MCP_URL"],
            "registerUrl": "https://open.feishu.cn/",
            "docHint": "部署飞书 MCP HTTP 服务后填入 URL；或写入 ADMIN_MCP_SERVERS JSON",
        },
        {
            "id": "clawhive_token",
            "name": "内部 API 鉴权",
            "tier": "recommended",
            "configured": bool(_env("CLAWHIVE_INTERNAL_TOKEN")),
            "env": ["CLAWHIVE_INTERNAL_TOKEN"],
            "registerUrl": None,
            "docHint": "与 Manager_Agent / Manage-platform .env 保持一致",
        },
    ]


def get_integrations_payload() -> dict[str, Any]:
    items = integration_catalog()
    ready = [i for i in items if i.get("configured")]
    pending = [i for i in items if not i.get("configured")]
    required_missing = [i for i in pending if i.get("tier") == "required"]
    return {
        "summary": {
            "total": len(items),
            "configured": len(ready),
            "pending": len(pending),
            "requiredMissing": len(required_missing),
        },
        "configured": [{"id": i["id"], "name": i["name"]} for i in ready],
        "pending": [
            {
                "id": i["id"],
                "name": i["name"],
                "tier": i.get("tier"),
                "env": i.get("env"),
                "registerUrl": i.get("registerUrl"),
                "docHint": i.get("docHint"),
            }
            for i in pending
        ],
        "items": items,
    }


def parse_calendar_subscriptions() -> dict[str, str]:
    raw = str(settings.ADMIN_CALENDAR_SUBSCRIPTIONS or "").strip()
    if not raw:
        extra: dict[str, str] = {}
        if settings.ADMIN_FEISHU_ICS_URL:
            extra["feishu"] = settings.ADMIN_FEISHU_ICS_URL
        if settings.ADMIN_CALENDAR_ICS_URL:
            extra["default"] = settings.ADMIN_CALENDAR_ICS_URL
        return extra
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items() if k and v}
    except json.JSONDecodeError:
        pass
    return {}
