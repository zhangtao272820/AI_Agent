from __future__ import annotations

import datetime

import httpx

from app.core.config import settings
from app.core.user_preferences import learn_weather_city
from app.core.time_utils import utc_naive_to_local_naive, utc_now_naive
from app.tools.common import _HTTP_TIMEOUT, _WEATHER_CACHE, _WEATHER_LAST_CALL_AT

_LEGACY_QWEATHER_HOSTS = frozenset(
    {
        "devapi.qweather.com",
        "api.qweather.com",
        "geoapi.qweather.com",
    }
)


def _pick_forecast_index(day: str) -> int:
    d = (day or "today").strip().lower()
    if d in ("tomorrow", "明天"):
        return 1
    if d in ("day_after_tomorrow", "后天"):
        return 2
    return 0


def _normalize_api_host(host: str) -> str:
    h = (host or "").strip().rstrip("/")
    if not h:
        return ""
    if not h.startswith("http://") and not h.startswith("https://"):
        return f"https://{h}"
    return h


def _host_domain(host: str) -> str:
    h = _normalize_api_host(host)
    if not h:
        return ""
    return h.split("://", 1)[-1].split("/", 1)[0].lower()


def _is_legacy_shared_host(host: str) -> bool:
    return _host_domain(host) in _LEGACY_QWEATHER_HOSTS


def _weather_auth_headers() -> dict[str, str]:
    key = (settings.WEATHER_API_KEY or "").strip()
    if not key:
        return {}
    return {"X-QW-Api-Key": key}


def _weather_config_error() -> str | None:
    if not (settings.WEATHER_API_KEY or "").strip():
        return "查询天气失败：未配置 WEATHER_API_KEY。请在 backend/.env 中填写和风天气 API KEY。"
    host = _normalize_api_host(settings.WEATHER_API_HOST)
    if not host:
        return (
            "查询天气失败：未配置 WEATHER_API_HOST。"
            "请登录和风天气控制台 → 设置，复制你的专属 API Host（形如 xxx.def.qweatherapi.com）填入 backend/.env。"
        )
    if _is_legacy_shared_host(host):
        return (
            "查询天气失败：WEATHER_API_HOST 仍为已停用的公共域名。"
            "请在和风天气控制台复制你的专属 API Host 替换 devapi/api/geoapi.qweather.com。"
        )
    return None


def _weather_http_hint(status_code: int | None, host: str) -> str:
    if status_code == 403:
        return (
            f"查询天气失败：和风天气接口返回 403（{host}）。"
            "请确认 WEATHER_API_HOST 为控制台专属域名，且 WEATHER_API_KEY 与该项目匹配。"
        )
    if status_code == 401:
        return "查询天气失败：WEATHER_API_KEY 无效或未授权，请在 backend/.env 更新 Key。"
    return ""


def _build_weather_suggestion(temp_c: float | None, precip_percent: float | None) -> str:
    suggestions = []
    if temp_c is not None:
        if temp_c <= 5:
            suggestions.append("天气较冷，建议穿厚外套并注意保暖")
        elif temp_c <= 15:
            suggestions.append("温度偏凉，建议带一件外套")
        elif temp_c >= 30:
            suggestions.append("天气炎热，建议轻薄着装并注意补水")
        else:
            suggestions.append("体感较舒适，日常着装即可")
    if precip_percent is not None and precip_percent >= 40:
        suggestions.append("降水概率较高，建议随身带伞")
    if temp_c is not None and temp_c >= 28 and (precip_percent is None or precip_percent < 40):
        suggestions.append("紫外线可能较强，外出可注意防晒")
    return "；".join(suggestions) if suggestions else "请根据实时体感灵活调整穿着。"


def get_weather(city: str, day: str = "today", session_id: str = "default") -> str:
    """查询城市天气（第三方：和风天气）"""
    city = (city or "").strip()
    if not city:
        return "查询天气失败：city 不能为空。"

    cfg_err = _weather_config_error()
    if cfg_err:
        return cfg_err

    now = utc_naive_to_local_naive(utc_now_naive())
    sid = (session_id or "default").strip() or "default"
    last_call_at = _WEATHER_LAST_CALL_AT.get(sid)
    if last_call_at is not None:
        elapsed = (now - last_call_at).total_seconds()
        if elapsed < settings.WEATHER_RATE_LIMIT_SECONDS:
            wait_s = int(settings.WEATHER_RATE_LIMIT_SECONDS - elapsed)
            return f"查询过于频繁，请约 {wait_s} 秒后再试。"
    _WEATHER_LAST_CALL_AT[sid] = now

    cache_key = f"{city.lower()}::{(day or 'today').strip().lower()}"
    cache_entry = _WEATHER_CACHE.get(cache_key)
    if cache_entry:
        cached_at = cache_entry.get("cached_at")
        if isinstance(cached_at, datetime.datetime):
            if (now - cached_at).total_seconds() <= settings.WEATHER_CACHE_TTL_SECONDS:
                return f"{cache_entry.get('result', '')}\n（来自缓存）"

    api_host = _normalize_api_host(settings.WEATHER_API_HOST)
    headers = _weather_auth_headers()

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            geo_resp = client.get(
                f"{api_host}/geo/v2/city/lookup",
                params={"location": city},
                headers=headers,
            )
            if geo_resp.status_code in (401, 403):
                hint = _weather_http_hint(geo_resp.status_code, api_host)
                if hint:
                    return hint
            geo_resp.raise_for_status()
            geo_data = geo_resp.json()
            if str(geo_data.get("code")) != "200" or not geo_data.get("location"):
                return f"查询天气失败：未找到城市「{city}」。"

            location = geo_data["location"][0]
            location_id = location.get("id")
            city_name = location.get("name", city)
            adm = location.get("adm1", "")

            idx = _pick_forecast_index(day)
            if idx == 0:
                weather_resp = client.get(
                    f"{api_host}/v7/weather/now",
                    params={"location": location_id},
                    headers=headers,
                )
                if weather_resp.status_code in (401, 403):
                    hint = _weather_http_hint(weather_resp.status_code, api_host)
                    if hint:
                        return hint
                weather_resp.raise_for_status()
                weather_data = weather_resp.json()
                if str(weather_data.get("code")) != "200":
                    return f"查询天气失败：天气接口返回 {weather_data.get('code')}。"
                now_row = weather_data.get("now", {})
                temp_val = None
                try:
                    temp_val = float(now_row.get("temp")) if now_row.get("temp") is not None else None
                except Exception:
                    temp_val = None
                result = (
                    f"{city_name}{('·' + adm) if adm else ''} 当前天气：{now_row.get('text', '未知')}，"
                    f"温度 {now_row.get('temp', '--')}°C，体感 {now_row.get('feelsLike', '--')}°C，"
                    f"湿度 {now_row.get('humidity', '--')}%，风向 {now_row.get('windDir', '--')} "
                    f"{now_row.get('windScale', '--')} 级。"
                    f"\n建议：{_build_weather_suggestion(temp_val, None)}"
                )
                _WEATHER_CACHE[cache_key] = {"result": result, "cached_at": utc_naive_to_local_naive(utc_now_naive())}
                learn_weather_city(sid, city_name or city)
                return result

            daily_resp = client.get(
                f"{api_host}/v7/weather/3d",
                params={"location": location_id},
                headers=headers,
            )
            if daily_resp.status_code in (401, 403):
                hint = _weather_http_hint(daily_resp.status_code, api_host)
                if hint:
                    return hint
            daily_resp.raise_for_status()
            daily_data = daily_resp.json()
            if str(daily_data.get("code")) != "200":
                return f"查询天气失败：天气接口返回 {daily_data.get('code')}。"
            days = daily_data.get("daily", [])
            if len(days) <= idx:
                return f"查询天气失败：{city_name} 暂无对应日期预报。"
            d = days[idx]
            label = "明天" if idx == 1 else "后天"
            temp_avg = None
            precip_val = None
            try:
                tmin = float(d.get("tempMin")) if d.get("tempMin") is not None else None
                tmax = float(d.get("tempMax")) if d.get("tempMax") is not None else None
                if tmin is not None and tmax is not None:
                    temp_avg = (tmin + tmax) / 2
            except Exception:
                temp_avg = None
            try:
                precip_val = float(d.get("precip")) if d.get("precip") is not None else None
            except Exception:
                precip_val = None
            result = (
                f"{city_name}{('·' + adm) if adm else ''} {label}天气：{d.get('textDay', '未知')}，"
                f"{d.get('tempMin', '--')}~{d.get('tempMax', '--')}°C，"
                f"降水概率 {d.get('precip', '--')}%，风向 {d.get('windDirDay', '--')} "
                f"{d.get('windScaleDay', '--')} 级。"
                f"\n建议：{_build_weather_suggestion(temp_avg, precip_val)}"
            )
            _WEATHER_CACHE[cache_key] = {"result": result, "cached_at": utc_naive_to_local_naive(utc_now_naive())}
            learn_weather_city(sid, city_name or city)
            return result
    except Exception as e:
        return f"查询天气失败：{str(e)}"
