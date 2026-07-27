import datetime
from zoneinfo import ZoneInfo
from app.core.config import settings


def user_tz() -> ZoneInfo:
    """
    User-facing timezone for parsing/display/scheduling.
    Falls back to Asia/Shanghai if misconfigured.
    """
    try:
        return ZoneInfo(settings.TIMEZONE)
    except Exception:
        try:
            return ZoneInfo("Asia/Shanghai")
        except Exception:
            # As a last resort (e.g. missing tzdata in slim containers), fall back to UTC.
            return datetime.timezone.utc


def utc_now_naive() -> datetime.datetime:
    """Canonical 'now' used for storage/comparisons (UTC, naive)."""
    return datetime.datetime.utcnow().replace(tzinfo=None)


def local_now_aware() -> datetime.datetime:
    """Local now with timezone info (for parsing relative expressions)."""
    return datetime.datetime.now(tz=user_tz())


def localize_naive(dt: datetime.datetime) -> datetime.datetime:
    """
    Treat a naive datetime as user local time (attach tzinfo without shifting).
    If already aware, return as-is.
    """
    if dt.tzinfo is not None:
        return dt
    return dt.replace(tzinfo=user_tz())


def to_utc_naive(dt: datetime.datetime) -> datetime.datetime:
    """
    Convert datetime to naive UTC for storage.
    - If dt is naive: interpret it as user local time.
    - If dt is aware: convert to UTC.
    """
    aware = localize_naive(dt)
    return aware.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def utc_naive_to_local_naive(dt_utc_naive: datetime.datetime) -> datetime.datetime:
    """
    Convert naive UTC (storage) into naive local time (scheduler/display).
    """
    if dt_utc_naive.tzinfo is not None:
        # Be defensive; treat as UTC aware then convert.
        aware_utc = dt_utc_naive.astimezone(datetime.timezone.utc)
    else:
        aware_utc = dt_utc_naive.replace(tzinfo=datetime.timezone.utc)
    return aware_utc.astimezone(user_tz()).replace(tzinfo=None)


def format_local_display(dt_utc_naive: datetime.datetime) -> str:
    """Format naive-UTC (DB) as local wall-clock string for user-facing messages."""
    if dt_utc_naive is None:
        return ""
    if dt_utc_naive.tzinfo is not None:
        aware_utc = dt_utc_naive.astimezone(datetime.timezone.utc)
    else:
        aware_utc = dt_utc_naive.replace(tzinfo=datetime.timezone.utc)
    aware_local = aware_utc.astimezone(user_tz())
    tz_label = aware_local.tzname() or settings.TIMEZONE
    return f"{aware_local.strftime('%Y-%m-%d %H:%M')} ({tz_label})"


def utc_naive_to_local_iso(dt_utc_naive: datetime.datetime) -> str:
    """
    Convert naive-UTC datetime (DB storage) into an ISO string with local tz offset.
    This avoids frontend ambiguity when parsing naive ISO strings.
    """
    if dt_utc_naive is None:
        return ""
    if dt_utc_naive.tzinfo is not None:
        aware_utc = dt_utc_naive.astimezone(datetime.timezone.utc)
    else:
        aware_utc = dt_utc_naive.replace(tzinfo=datetime.timezone.utc)
    aware_local = aware_utc.astimezone(user_tz())
    return aware_local.isoformat()

