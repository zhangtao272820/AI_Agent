from __future__ import annotations

from app.db.database import Memory, SessionLocal

def add_memory(content: str, pref_type: str = "general") -> str:
    db = SessionLocal()
    mem = Memory(content=content, preference_type=pref_type)
    db.add(mem)
    db.commit()
    db.close()
    return f"已记住您的偏好: {content}"

def get_memories() -> str:
    db = SessionLocal()
    mems = db.query(Memory).all()
    db.close()
    if not mems:
        return ""
    return "系统记忆的偏好:\n" + "\n".join([f"- {m.content}" for m in mems])

