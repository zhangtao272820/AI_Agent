from openai import OpenAI

from .config import get_settings
from .metrics import llm_calls_total


class QwenClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = OpenAI(
            api_key=self.settings.qwen_api_key,
            base_url=self.settings.qwen_base_url,
        )

    def chat(self, system_prompt: str, user_prompt: str, model: str | None = None) -> str:
        llm_calls_total.inc()
        if not self.settings.qwen_api_key:
            return "未配置 QWEN_API_KEY，当前返回平台模拟响应。"

        response = self.client.chat.completions.create(
            model=model or self.settings.qwen_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=self.settings.qwen_temperature,
        )
        content = response.choices[0].message.content
        return content if content else "模型返回了空结果。"
