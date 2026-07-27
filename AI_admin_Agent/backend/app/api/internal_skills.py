from fastapi import APIRouter, Depends

from app.core.internal_auth import verify_internal_token
from app.core.playbook_loader import clear_playbook_cache, _agent_roots

router = APIRouter()


def _list_playbook_skills() -> list[dict]:
    skills: list[dict] = []
    seen: set[str] = set()
    for root in _agent_roots():
        skills_dir = root / "skills"
        if not skills_dir.is_dir():
            continue
        for child in sorted(skills_dir.iterdir()):
            if not child.is_dir():
                continue
            skill_md = child / "skill.md"
            if not skill_md.is_file():
                continue
            sid = child.name
            if sid in seen:
                continue
            seen.add(sid)
            skills.append({"skill_id": sid, "path": str(skill_md), "kind": "playbook"})
    return skills


@router.get("/api/internal/skills")
async def list_skills(_: None = Depends(verify_internal_token)):
    return {"ok": True, "agent": "AI_admin_Agent", "skills": _list_playbook_skills()}


@router.post("/api/internal/skills/reload")
async def reload_skills(_: None = Depends(verify_internal_token)):
    clear_playbook_cache()
    return {"ok": True, "message": "playbook cache cleared"}
