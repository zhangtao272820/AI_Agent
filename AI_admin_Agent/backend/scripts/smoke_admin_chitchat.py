"""Smoke: admin chitchat fastpath (no LLM)."""
from app.core.admin_chitchat_fastpath import (
    chitchat_reply,
    is_admin_chitchat_message,
)


def test_greeting():
    assert is_admin_chitchat_message("你好")
    assert is_admin_chitchat_message("您好！")
    assert not is_admin_chitchat_message("明天10点开会")
    reply = chitchat_reply("你好")
    assert "助理" in reply


if __name__ == "__main__":
    test_greeting()
    print("smoke-admin-chitchat: OK")
