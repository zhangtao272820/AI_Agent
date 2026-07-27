"""百炼 / OpenAI 兼容 API 错误转用户可读文案。"""

from __future__ import annotations


def format_dashscope_error(ex: BaseException) -> str:
    msg = str(ex)
    low = msg.lower()
    if "allocationquota.freetieronly" in low or "free tier" in low:
        return (
            "百炼模型免费额度已用尽，且账号开启了「仅使用免费额度」。"
            "请到 DashScope 控制台关闭该选项以使用付费额度，"
            "或将 AI_Agent/.env 中 LLM_MODEL 改为仍有免费额度的模型（如 qwen-flash-2025-07-28）。"
        )
    if "403" in msg and "forbidden" in low:
        return f"百炼 API 拒绝访问 (403)：{msg}"
    return msg
