"""
Playbook Skill 加载器：skills/<id>/skill.md（对齐 RAG playbook_skills.ts）
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

_CACHE: dict[str, str] = {}


def _agent_roots() -> list[Path]:
    roots: list[Path] = []
    cwd = Path.cwd()
    roots.append(cwd)
    # backend/app/core -> AI_admin_Agent
    here = Path(__file__).resolve()
    roots.append(here.parents[2])  # backend
    roots.append(here.parents[3])  # AI_admin_Agent
    seen: set[str] = set()
    out: list[Path] = []
    for r in roots:
        key = str(r)
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def _skill_file_candidates(skill_id: str) -> list[Path]:
    paths: list[Path] = []
    for root in _agent_roots():
        paths.append(root / "skills" / skill_id / "skill.md")
        paths.append(root.parent / "AI_admin_Agent" / "skills" / skill_id / "skill.md")
    return paths


def strip_playbook_frontmatter(raw: str) -> str:
    text = str(raw or "")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return text.strip()
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[i + 1 :]).strip()
    return text.strip()


def _read_skill_raw(skill_id: str) -> str:
    for p in _skill_file_candidates(skill_id):
        try:
            if p.is_file():
                return p.read_text(encoding="utf-8")
        except OSError:
            continue
    return ""


def load_playbook_body(skill_id: str) -> str:
    key = f"body:{skill_id}"
    if key in _CACHE:
        return _CACHE[key]
    raw = _read_skill_raw(skill_id)
    body = strip_playbook_frontmatter(raw) if raw else ""
    _CACHE[key] = body
    return body


def load_playbook_section(skill_id: str, heading: str) -> str:
    key = f"section:{skill_id}:{heading}"
    if key in _CACHE:
        return _CACHE[key]
    body = load_playbook_body(skill_id)
    if not body:
        _CACHE[key] = ""
        return ""
    h = str(heading or "").strip().lstrip("#").strip()
    blocks = re.split(r"\r?\n(?=## )", body)
    for block in blocks:
        m = re.match(r"^##\s+(.+?)\s*\r?\n([\s\S]*)$", block)
        if m and m.group(1).strip() == h:
            section = (m.group(2) or "").strip()
            _CACHE[key] = section
            return section
    _CACHE[key] = ""
    return ""


def resolve_playbook_or_fallback(skill_id: str, fallback: str) -> str:
    if os.getenv("ADMIN_LOAD_PLAYBOOK", "1").strip().lower() in ("0", "false", "no"):
        return fallback
    from_skill = load_playbook_body(skill_id).strip()
    return from_skill if from_skill else fallback


def resolve_playbook_section_or_fallback(skill_id: str, heading: str, fallback: str) -> str:
    if os.getenv("ADMIN_LOAD_PLAYBOOK", "1").strip().lower() in ("0", "false", "no"):
        return fallback
    from_skill = load_playbook_section(skill_id, heading).strip()
    return from_skill if from_skill else fallback


def clear_playbook_cache() -> None:
    _CACHE.clear()
