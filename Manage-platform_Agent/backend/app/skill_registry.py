"""公共技能 Registry：内置 catalog + 远程 index 代理 + 包下载。"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from uuid import uuid4

from .config import get_settings

settings = get_settings()

_CACHE: dict[str, tuple[datetime, dict]] = {}


def _read_registry_cache_db(registry_id: str) -> dict[str, Any] | None:
    if not getattr(settings, "skill_registry_db_cache", True):
        return None
    try:
        from .db import SessionLocal
        from .db_models import SkillRegistryCacheRecord

        db = SessionLocal()
        try:
            row = (
                db.query(SkillRegistryCacheRecord)
                .filter(SkillRegistryCacheRecord.registry_id == registry_id)
                .first()
            )
            if not row or row.expires_at <= datetime.utcnow():
                return None
            payload = json.loads(row.payload_json or "{}")
            return payload if isinstance(payload, dict) else None
        finally:
            db.close()
    except Exception:
        return None


def _write_registry_cache_db(registry_id: str, data: dict[str, Any], ttl: int) -> None:
    if not getattr(settings, "skill_registry_db_cache", True):
        return
    try:
        from .db import SessionLocal
        from .db_models import SkillRegistryCacheRecord

        db = SessionLocal()
        try:
            now = datetime.utcnow()
            row = (
                db.query(SkillRegistryCacheRecord)
                .filter(SkillRegistryCacheRecord.registry_id == registry_id)
                .first()
            )
            if row:
                row.payload_json = json.dumps(data, ensure_ascii=False)
                row.fetched_at = now
                row.expires_at = now + timedelta(seconds=ttl)
            else:
                db.add(
                    SkillRegistryCacheRecord(
                        registry_id=registry_id,
                        payload_json=json.dumps(data, ensure_ascii=False),
                        fetched_at=now,
                        expires_at=now + timedelta(seconds=ttl),
                    )
                )
            db.commit()
        finally:
            db.close()
    except Exception:
        return


def _platform_dir() -> Path:
    """Docker 内代码在 /app，catalog 在 workspace 挂载的 Manage-platform_Agent/ 下。"""
    code_root = Path(__file__).resolve().parents[2]
    ws_root = Path(settings.workspace_root or ".").resolve()
    candidates = [
        code_root,
        ws_root / "Manage-platform_Agent",
        ws_root,
    ]
    for candidate in candidates:
        if (candidate / "skills-catalog").is_dir():
            return candidate.resolve()
    return code_root


def _builtin_index_path() -> Path:
    return _platform_dir() / "skills-catalog" / "builtin" / "index.json"


def _workspace() -> Path:
    return Path(settings.workspace_root or ".").resolve()


def _registry_urls() -> list[tuple[str, str]]:
    raw = str(getattr(settings, "skill_registry_urls", "") or "").strip()
    urls = [u.strip() for u in raw.split(",") if u.strip()]
    out: list[tuple[str, str]] = [("builtin", str(_builtin_index_path()))]
    internal = _platform_dir() / "skills-catalog" / "internal-market" / "index.json"
    if internal.is_file():
        out.append(("internal_market", str(internal)))
    remote_demo = _platform_dir() / "skills-catalog" / "remote-demo" / "index.json"
    if remote_demo.is_file():
        out.append(("remote_demo", str(remote_demo)))
    for idx, url in enumerate(urls):
        out.append((f"remote_{idx}", url))
    return out


def get_registry_ref(registry_id: str) -> str:
    for rid, ref in _registry_urls():
        if rid == registry_id:
            return ref
    return str(_builtin_index_path())


def registry_download_dir() -> Path:
    base = Path(__file__).resolve().parent.parent / ".local" / "registry-downloads"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_package_url(package_url: str, *, registry_ref: str) -> str:
    url = str(package_url or "").strip()
    if not url:
        raise ValueError("package_url 为空")
    if url.startswith("http://") or url.startswith("https://"):
        return url
    ref_path = Path(registry_ref)
    if ref_path.is_file():
        base = ref_path.parent
        candidate = (base / url).resolve()
        if candidate.is_file():
            return str(candidate)
    platform_candidate = (_platform_dir() / url).resolve()
    if platform_candidate.is_file():
        return str(platform_candidate)
    workspace_candidate = (_workspace() / url).resolve()
    if workspace_candidate.is_file():
        return str(workspace_candidate)
    raise FileNotFoundError(f"无法解析 package_url: {url}")


def download_package(
    package_ref: str,
    *,
    expected_sha256: str = "",
    registry_ref: str = "",
) -> tuple[Path, str]:
    """下载或定位技能 zip，返回 (本地路径, 实际 sha256)。"""
    resolved = resolve_package_url(package_ref, registry_ref=registry_ref) if registry_ref else package_ref
    target: Path

    if resolved.startswith("http://") or resolved.startswith("https://"):
        req = Request(resolved, headers={"Accept": "application/octet-stream,*/*"})
        token = str(getattr(settings, "skill_registry_token", "") or "").strip()
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urlopen(req, timeout=60) as resp:
            content = resp.read()
        target = registry_download_dir() / f"{uuid4()}.zip"
        target.write_bytes(content)
    else:
        target = Path(resolved)
        if not target.is_file():
            raise FileNotFoundError(f"技能包不存在: {target}")

    digest = _sha256_file(target)
    expected = str(expected_sha256 or "").strip().lower()
    if expected and digest.lower() != expected:
        if resolved.startswith("http"):
            target.unlink(missing_ok=True)
        raise ValueError(f"sha256 校验失败: expected={expected}, got={digest}")
    return target, digest


def load_registry_index(registry_id: str = "builtin") -> dict[str, Any]:
    from .metrics import skill_registry_fetch_total

    ttl = max(30, int(getattr(settings, "skill_registry_cache_ttl_sec", 300) or 300))
    hit = _CACHE.get(registry_id)
    if hit and hit[0] > datetime.utcnow():
        return hit[1]

    cached = _read_registry_cache_db(registry_id)
    if cached:
        _CACHE[registry_id] = (datetime.utcnow() + timedelta(seconds=ttl), cached)
        skill_registry_fetch_total.labels(registry_id=registry_id, result="db_cache").inc()
        return cached

    data: dict[str, Any] = {"apiVersion": "clawhive/registry/v1", "skills": []}
    fetched = False
    for rid, ref in _registry_urls():
        if registry_id and registry_id != "all" and rid != registry_id:
            continue
        try:
            if ref.startswith("http://") or ref.startswith("https://"):
                req = Request(ref, headers={"Accept": "application/json"})
                token = str(getattr(settings, "skill_registry_token", "") or "").strip()
                if token:
                    req.add_header("Authorization", f"Bearer {token}")
                with urlopen(req, timeout=15) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
            else:
                path = Path(ref)
                if not path.is_file():
                    continue
                payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                continue
            payload = dict(payload)
            payload.setdefault("registry_id", rid)
            fetched = True
            if registry_id == "all":
                data.setdefault("registries", []).append(payload)
                data["skills"].extend(payload.get("skills") or [])
            else:
                data = payload
                break
        except Exception:
            continue

    if fetched and data.get("skills") is not None:
        skill_registry_fetch_total.labels(registry_id=registry_id, result="ok").inc()
        _write_registry_cache_db(registry_id, data, ttl)
    elif not cached:
        skill_registry_fetch_total.labels(registry_id=registry_id, result="miss").inc()

    _CACHE[registry_id] = (datetime.utcnow() + timedelta(seconds=ttl), data)
    return data


def list_registry_sources() -> list[dict[str, str]]:
    out = []
    labels = {
        "builtin": "内置市场",
        "internal_market": "内部免费市场（全集群）",
        "remote_demo": "远程演示市场（本地包）",
    }
    for rid, ref in _registry_urls():
        label = labels.get(rid, ref if ref.startswith("http") else Path(ref).name)
        out.append({"registry_id": rid, "label": label, "ref": ref})
    return out


def _normalize_skill_entry(entry: dict[str, Any], registry_id: str) -> dict[str, Any]:
    versions = entry.get("versions")
    if not isinstance(versions, list) or not versions:
        latest = str(entry.get("latest") or "1.0.0")
        versions = [latest]
    compatible = entry.get("compatible_agents") or ["*"]
    if not isinstance(compatible, list):
        compatible = ["*"]
    tags = entry.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    return {
        "registry_id": registry_id,
        "skill_id": str(entry.get("skill_id") or "").strip(),
        "name": str(entry.get("name") or "").strip(),
        "kind": str(entry.get("kind") or "executable").strip(),
        "latest": str(entry.get("latest") or versions[0]).strip(),
        "versions": [str(v) for v in versions],
        "tags": [str(t) for t in tags],
        "compatible_agents": [str(a) for a in compatible],
        "description": str(entry.get("description") or "").strip(),
        "workspace_path": str(entry.get("workspace_path") or "").strip(),
        "package_url": str(entry.get("package_url") or "").strip(),
        "sha256": str(entry.get("sha256") or "").strip(),
        "publisher": str(entry.get("publisher") or "platform").strip(),
        "status": str(entry.get("status") or "published").strip(),
        "local_installed": False,
        "local_status": "",
    }


def search_registry_skills(
    *,
    registry_id: str = "builtin",
    q: str = "",
    tag: str = "",
    kind: str = "",
    agent: str = "",
    local_index: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    index = load_registry_index(registry_id)
    rid = str(index.get("registry_id") or registry_id)
    skills_raw = index.get("skills") or []
    if not isinstance(skills_raw, list):
        return []

    q_norm = q.strip().lower()
    tag_norm = tag.strip().lower()
    kind_norm = kind.strip().lower()
    agent_norm = agent.strip()

    results: list[dict[str, Any]] = []
    for raw in skills_raw:
        if not isinstance(raw, dict):
            continue
        item = _normalize_skill_entry(raw, rid)
        if not item["skill_id"]:
            continue
        if kind_norm and item["kind"].lower() != kind_norm:
            continue
        if tag_norm and tag_norm not in [t.lower() for t in item["tags"]]:
            continue
        if agent_norm:
            compat = item["compatible_agents"]
            if "*" not in compat and agent_norm not in compat:
                continue
        if q_norm:
            blob = " ".join(
                [
                    item["skill_id"],
                    item["name"],
                    item["description"],
                    " ".join(item["tags"]),
                ]
            ).lower()
            if q_norm not in blob and not all(tok in blob for tok in q_norm.split()):
                continue
        key = f"{item['skill_id']}@{item['latest']}"
        if local_index and key in local_index:
            item["local_installed"] = True
            item["local_status"] = local_index[key]
        results.append(item)
    return results


def get_registry_skill(
    *,
    registry_id: str,
    skill_id: str,
    version: str | None = None,
) -> dict[str, Any] | None:
    index = load_registry_index(registry_id)
    rid = str(index.get("registry_id") or registry_id)
    for raw in index.get("skills") or []:
        if not isinstance(raw, dict):
            continue
        item = _normalize_skill_entry(raw, rid)
        if item["skill_id"] != skill_id:
            continue
        ver = (version or item["latest"]).strip()
        if ver not in item["versions"] and ver != item["latest"]:
            continue
        item["version"] = ver
        return item
    return None


def resolve_catalog_workspace_path(entry: dict[str, Any]) -> Path:
    rel = str(entry.get("workspace_path") or "").strip()
    if not rel:
        raise ValueError("catalog 条目缺少 workspace_path")
    path = (_workspace() / rel).resolve()
    if not path.exists():
        raise FileNotFoundError(f"工作区技能路径不存在: {path}")
    return path


def parse_playbook_frontmatter(skill_md_path: Path) -> dict[str, Any]:
    text = skill_md_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError(f"playbook 缺少 frontmatter: {skill_md_path}")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        raise ValueError(f"playbook frontmatter 未闭合: {skill_md_path}")
    import yaml

    meta = yaml.safe_load("\n".join(lines[1:end])) or {}
    if not isinstance(meta, dict):
        raise ValueError(f"playbook frontmatter 必须是对象: {skill_md_path}")
    skill_id = str(meta.get("name") or skill_md_path.parent.name).strip()
    return {
        "skill_id": skill_id,
        "name": str(meta.get("name") or skill_id).strip(),
        "version": str(meta.get("version") or "1.0.0").strip(),
        "description": str(meta.get("description") or "").strip(),
        "runtime": "markdown",
        "entrypoint": "skill.md",
        "tags": [str(meta.get("stage") or "playbook")],
        "owner": str(meta.get("owner") or "platform").strip(),
        "kind": "playbook",
        "manifest_text": text,
    }


def infer_kind_from_path(base: Path) -> str:
    if (base / "skill.md").is_file():
        return "playbook"
    if (base / "skill.yaml").is_file() or (base / "skill.yml").is_file():
        return "executable"
    raise ValueError(f"无法识别技能类型: {base}")


def normalize_env_skill_key(skill_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "_", skill_id).upper()
