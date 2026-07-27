"""技能市场运营统计（平台侧）。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .db_models import SkillInstallRecord, SkillRecord
from .skill_registry import list_registry_sources, search_registry_skills


def build_skill_market_stats(db: Session, *, tenant_id: str) -> dict:
    installs_q = db.query(SkillInstallRecord).filter(SkillInstallRecord.status == "installed")
    if tenant_id and tenant_id != "*":
        installs_q = installs_q.filter(SkillInstallRecord.tenant_id == tenant_id)
    installs = installs_q.all()

    synced = len([r for r in installs if (r.sync_status or "") == "synced"])
    pending_reload = len([r for r in installs if (r.sync_status or "") == "synced_pending_reload"])
    failed_sync = len([r for r in installs if (r.sync_status or "") == "failed"])
    pending = len([r for r in installs if (r.sync_status or "") in ("", "pending")])

    by_registry: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    for row in installs:
        rid = row.registry_id or "local"
        by_registry[rid] = by_registry.get(rid, 0) + 1
        kind = row.kind or "unknown"
        by_kind[kind] = by_kind.get(kind, 0) + 1

    local_rows = db.query(SkillRecord).all()
    local_index = {f"{r.skill_id}@{r.version}": r.status for r in local_rows}
    catalog_count = len(search_registry_skills(registry_id="all", local_index=local_index))

    return {
        "tenant_id": tenant_id,
        "registry_sources": len(list_registry_sources()),
        "catalog_skills": catalog_count,
        "local_skills": len(local_rows),
        "installed_count": len(installs),
        "synced_count": synced,
        "synced_pending_reload_count": pending_reload,
        "failed_sync_count": failed_sync,
        "pending_sync_count": pending,
        "by_registry": by_registry,
        "by_kind": by_kind,
    }
