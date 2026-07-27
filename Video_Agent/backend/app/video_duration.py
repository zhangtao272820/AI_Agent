import re

# 匹配「5秒」「10 秒钟」等（1～2 位数字）
_SEC_PATTERN = re.compile(r"(\d{1,2})\s*秒")


def infer_duration_seconds(
    user_text: str,
    *,
    default: int = 10,
    min_sec: int = 5,
    max_sec: int = 15,
) -> int:
    """从用户话术中解析目标时长；无明确「X秒」时用 default。"""
    t = (user_text or "").strip()
    m = _SEC_PATTERN.search(t)
    if m:
        v = int(m.group(1))
        return max(min_sec, min(max_sec, v))
    return max(min_sec, min(max_sec, default))


def user_specified_seconds(user_text: str) -> bool:
    return bool(_SEC_PATTERN.search(user_text or ""))
