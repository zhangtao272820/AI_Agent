"""租户实体 + Token 用量台账（P1b-3：TenantRecord 为配额 SSOT）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from .config import get_settings
from .db_models import TaskRecord, TenantRecord, TenantUsageRecord

settings = get_settings()


class QuotaExceededError(Exception):
    """租户月度 Token 配额已用尽。"""


def _current_period() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def ensure_default_tenant(db: Session) -> TenantRecord:
    row = db.query(TenantRecord).filter(TenantRecord.tenant_id == "default").first()
    if row:
        return row
    default_quota = int(getattr(settings, "default_tenant_quota_tokens", 0) or 0)
    row = TenantRecord(
        tenant_id="default",
        name="Default",
        status="active",
        quota_tokens=default_quota if default_quota > 0 else None,
        updated_by="system",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def ensure_tenant(db: Session, tenant_id: str, *, name: str = "", operator: str = "system") -> TenantRecord:
    tid = str(tenant_id or "default").strip() or "default"
    row = db.query(TenantRecord).filter(TenantRecord.tenant_id == tid).first()
    if row:
        return row
    row = TenantRecord(
        tenant_id=tid,
        name=(name or tid).strip() or tid,
        status="active",
        quota_tokens=None,
        updated_by=operator,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_tenants(db: Session) -> list[dict]:
    ensure_default_tenant(db)
    month = _current_period()
    usage_by = {
        str(r.tenant_id): r
        for r in db.query(TenantUsageRecord).filter(TenantUsageRecord.period == month).all()
    }
    out = []
    for t in db.query(TenantRecord).order_by(TenantRecord.tenant_id.asc()).all():
        u = usage_by.get(t.tenant_id)
        quota = _effective_quota(t, u)
        used = int(u.tokens_used or 0) if u else 0
        out.append(
            {
                "tenant_id": t.tenant_id,
                "name": t.name or t.tenant_id,
                "status": t.status or "active",
                "quota_tokens": quota,
                "tokens_used": used,
                "task_count": int(u.task_count or 0) if u else 0,
                "quota_utilization": round(used / quota, 4) if quota and quota > 0 else None,
                "quota_remaining": max(0, quota - used) if quota and quota > 0 else None,
                "period": month,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
                "updated_by": t.updated_by or "",
            }
        )
    return out


def upsert_tenant(
    db: Session,
    *,
    tenant_id: str,
    name: str | None = None,
    status: str | None = None,
    quota_tokens: int | None = None,
    clear_quota: bool = False,
    operator: str,
) -> dict:
    tid = str(tenant_id or "").strip()
    if not tid:
        raise ValueError("tenant_id required")
    row = ensure_tenant(db, tid, name=name or tid, operator=operator)
    if name is not None and str(name).strip():
        row.name = str(name).strip()
    if status is not None:
        st = str(status).strip().lower()
        if st not in ("active", "disabled"):
            raise ValueError("status must be active|disabled")
        row.status = st
    if clear_quota:
        row.quota_tokens = None
    elif quota_tokens is not None:
        row.quota_tokens = int(quota_tokens) if int(quota_tokens) > 0 else None
    row.updated_by = operator
    db.add(row)
    db.commit()
    refresh_tenant_quota_metrics(db)
    for item in list_tenants(db):
        if item["tenant_id"] == tid:
            return item
    return {"tenant_id": tid}


def _effective_quota(tenant: TenantRecord | None, usage_row: TenantUsageRecord | None) -> int | None:
    if tenant is not None and tenant.quota_tokens is not None and int(tenant.quota_tokens) > 0:
        return int(tenant.quota_tokens)
    if usage_row is not None and usage_row.quota_tokens is not None and int(usage_row.quota_tokens) > 0:
        return int(usage_row.quota_tokens)
    default = int(getattr(settings, "default_tenant_quota_tokens", 0) or 0)
    return default if default > 0 else None


def record_task_usage(db: Session, *, tenant_id: str, task_id: str, tokens: int, username: str = "") -> None:
    tid = str(tenant_id or "default").strip() or "default"
    ensure_tenant(db, tid, operator=username or "system")
    tok = max(0, int(tokens or 0))
    if tok <= 0:
        return
    month = _current_period()
    row = (
        db.query(TenantUsageRecord)
        .filter(TenantUsageRecord.tenant_id == tid, TenantUsageRecord.period == month)
        .first()
    )
    if not row:
        row = TenantUsageRecord(tenant_id=tid, period=month, tokens_used=0, task_count=0)
    row.tokens_used = int(row.tokens_used or 0) + tok
    row.task_count = int(row.task_count or 0) + 1
    row.updated_by = username or row.updated_by
    db.add(row)
    db.commit()
    refresh_tenant_quota_metrics(db)


def get_tenant_usage_summary(db: Session, tenant_id: str | None = None) -> dict:
    ensure_default_tenant(db)
    month = _current_period()
    if tenant_id:
        tid = str(tenant_id).strip() or "default"
        tenant = db.query(TenantRecord).filter(TenantRecord.tenant_id == tid).first()
        rows = (
            db.query(TenantUsageRecord)
            .filter(TenantUsageRecord.period == month, TenantUsageRecord.tenant_id == tid)
            .all()
        )
        r = rows[0] if rows else None
        quota = _effective_quota(tenant, r)
        used = int(r.tokens_used) if r else 0
        return {
            "tenant_id": tid,
            "name": (tenant.name if tenant else tid) or tid,
            "status": (tenant.status if tenant else "active") or "active",
            "period": month,
            "tokens_used": used,
            "task_count": int(r.task_count) if r else 0,
            "quota_tokens": quota,
            "quota_utilization": round(used / quota, 4) if quota and quota > 0 else None,
            "quota_remaining": max(0, quota - used) if quota and quota > 0 else None,
        }

    tenants = list_tenants(db)
    return {
        "period": month,
        "tenants": tenants,
        "total_tokens": sum(int(t.get("tokens_used") or 0) for t in tenants),
        "default_quota_tokens": int(getattr(settings, "default_tenant_quota_tokens", 0) or 0) or None,
    }


def set_tenant_quota(
    db: Session,
    *,
    tenant_id: str,
    quota_tokens: int | None,
    operator: str,
) -> dict:
    """Write quota to TenantRecord (SSOT); keep period usage row in sync for legacy readers."""
    tid = str(tenant_id or "default").strip() or "default"
    clear = quota_tokens is None or int(quota_tokens) <= 0
    item = upsert_tenant(
        db,
        tenant_id=tid,
        quota_tokens=None if clear else int(quota_tokens),
        clear_quota=clear,
        operator=operator,
    )
    month = _current_period()
    row = (
        db.query(TenantUsageRecord)
        .filter(TenantUsageRecord.tenant_id == tid, TenantUsageRecord.period == month)
        .first()
    )
    if not row:
        row = TenantUsageRecord(tenant_id=tid, period=month, tokens_used=0, task_count=0)
    row.quota_tokens = None if clear else int(quota_tokens)
    row.updated_by = operator
    db.add(row)
    db.commit()
    refresh_tenant_quota_metrics(db)
    return get_tenant_usage_summary(db, tid)


def assert_tenant_quota_available(db: Session, tenant_id: str) -> None:
    if not getattr(settings, "quota_hard_limit_enabled", True):
        return
    tid = str(tenant_id or "default").strip() or "default"
    tenant = db.query(TenantRecord).filter(TenantRecord.tenant_id == tid).first()
    if tenant and str(tenant.status or "active").lower() == "disabled":
        raise QuotaExceededError(f"租户 {tid} 已停用")
    summary = get_tenant_usage_summary(db, tid)
    quota = summary.get("quota_tokens")
    if not quota or int(quota) <= 0:
        return
    used = int(summary.get("tokens_used") or 0)
    if used >= int(quota):
        raise QuotaExceededError(
            f"租户 {summary.get('tenant_id')} 月度 Token 配额已用尽 ({used}/{quota})，请联系管理员扩容"
        )


def resolve_request_tenant_id(user, payload_tenant_id: str | None = None) -> str:
    """Non-admin cannot forge tenant_id from request body (P1b-3)."""
    user_tid = str(getattr(user, "tenant_id", None) or "default").strip() or "default"
    role = str(getattr(user, "role", "") or "")
    if role == "admin":
        override = str(payload_tenant_id or "").strip()
        return override or user_tid
    return user_tid


def aggregate_task_tokens_by_tenant(db: Session) -> dict[str, int]:
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = (
        db.query(TaskRecord.tenant_id, func.sum(TaskRecord.cost_estimate_tokens))
        .filter(TaskRecord.updated_at >= month_start, TaskRecord.status == "success")
        .group_by(TaskRecord.tenant_id)
        .all()
    )
    return {str(tid or "default"): int(total or 0) for tid, total in rows}


def refresh_tenant_quota_metrics(db: Session) -> None:
    """将 tenant_usage 台账同步到 Prometheus Gauge。"""
    from .metrics import (
        tenant_quota_exceeded,
        tenant_quota_utilization,
        tenant_tokens_used_month,
    )

    summary = get_tenant_usage_summary(db)
    seen: set[str] = set()
    for row in summary.get("tenants") or []:
        tid = str(row.get("tenant_id") or "default")
        seen.add(tid)
        used = int(row.get("tokens_used") or 0)
        util = row.get("quota_utilization")
        tenant_tokens_used_month.labels(tenant_id=tid).set(used)
        if util is not None:
            tenant_quota_utilization.labels(tenant_id=tid).set(float(util))
            tenant_quota_exceeded.labels(tenant_id=tid).set(1.0 if float(util) >= 1.0 else 0.0)
        else:
            tenant_quota_utilization.labels(tenant_id=tid).set(0.0)
            tenant_quota_exceeded.labels(tenant_id=tid).set(0.0)
    if "default" not in seen:
        tenant_tokens_used_month.labels(tenant_id="default").set(0.0)
        tenant_quota_utilization.labels(tenant_id="default").set(0.0)
        tenant_quota_exceeded.labels(tenant_id="default").set(0.0)
