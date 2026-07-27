import json
import logging
import re
from typing import Any

from openai import OpenAI

from .config import Settings
from .video_duration import infer_duration_seconds, user_specified_seconds

logger = logging.getLogger(__name__)

ORCHESTRATOR_SYSTEM = (
    "你是短视频多智能体流水线的总管。根据用户一句话需求，输出仅一个 JSON，无 markdown。"
    "字段：user_intent(str 精炼中文意图), mood(str 情绪关键词), key_elements(str[] 3-8个画面核心元素), "
    "target_duration_sec(int)：若用户明确写了「X秒」必须与 X 一致；若未写秒数则填 10。"
)

QA_SYSTEM_BASE = (
    "你是质检 Agent（轻量）。根据用户需求、分镜摘要、视频提示词，评估「若按该提示生成」是否可能达标。"
    "无法看真实像素，侧重：核心元素是否覆盖、情绪是否对齐、提示词是否自洽、时长是否与用户目标一致。"
    "仅输出一个 JSON：pass(bool)、score(0-100 int)、issues(str[])、suggestion(str 改进建议)。"
)


def _director_system(total_sec: int) -> str:
    return (
        f"你是导演 Agent，负责一条短视频的「多镜头分镜」脚本，总时长必须严格为 {total_sec} 秒。仅输出一个 JSON，无 markdown。\n"
        "根对象含 shot_script，shot_script 必须包含：\n"
        f'  "duration": {total_sec}（int，与总秒数一致）\n'
        '  "shots": 数组，至少 2 个镜头；按时间顺序排列；每个元素为对象，字段：\n'
        '     "shot_id"(int 从1递增), "duration_sec"(int 该镜秒数), "画面描述"(str),\n'
        '     "动作与表演"(str), "景别运镜"(str)\n'
        f"     所有 shots[].duration_sec 之和必须等于 {total_sec}。\n"
        '  另含整场汇总字段：scene_description、start_frame、end_frame、camera_movement、\n'
        '  lighting、mood、key_elements(str[])。汇总与 shots 不得矛盾。\n'
        "内容需与用户需求、总管摘要一致。"
    )


def _camera_system(total_sec: int) -> str:
    return (
        "你是镜头 Agent，把分镜（含 shots 数组）合并为「单段」文生视频可用的提示词（万相一次生成一条成片）。"
        "仅输出一个 JSON，无 markdown。\n"
        f"字段：video_prompt(str)：按 shots 顺序写清各镜内容与转场，中文为主并带必要英文画质词；"
        f"文末必须写明「整段视频总时长约{total_sec}秒」；\n"
        "negative_prompt(str)：常见负面词，中文为主。"
    )


CAMERA_REVISE_SYSTEM = (
    "你是镜头 Agent，需根据质检建议优化视频提示词。仅输出一个 JSON，无 markdown。"
    "字段：video_prompt、negative_prompt。保留原分镜与总时长要求，针对性消除 issues。"
)


def _default_shots(total_sec: int, shot: dict[str, Any]) -> list[dict[str, Any]]:
    a = total_sec // 2
    b = total_sec - a
    scene = str(shot.get("scene_description") or shot.get("user_intent") or "画面内容")
    return [
        {
            "shot_id": 1,
            "duration_sec": a,
            "画面描述": f"起幅：{str(shot.get('start_frame') or scene)[:200]}",
            "动作与表演": "建立场景与主体状态",
            "景别运镜": str(shot.get("camera_movement") or "中景，缓慢推进")[:120],
        },
        {
            "shot_id": 2,
            "duration_sec": b,
            "画面描述": f"落幅：{str(shot.get('end_frame') or scene)[:200]}",
            "动作与表演": "情绪收束或动作完成",
            "景别运镜": "特写或近景收尾",
        },
    ]


def _normalize_shots(total_sec: int, shot: dict[str, Any]) -> None:
    shots = shot.get("shots")
    if not isinstance(shots, list) or len(shots) < 2:
        shot["shots"] = _default_shots(total_sec, shot)
        return
    norm: list[dict[str, Any]] = []
    for i, item in enumerate(shots):
        if not isinstance(item, dict):
            continue
        d = item.get("duration_sec")
        try:
            di = int(d) if d is not None else 0
        except (TypeError, ValueError):
            di = 0
        norm.append(
            {
                "shot_id": int(item.get("shot_id") or i + 1),
                "duration_sec": max(1, di),
                "画面描述": str(item.get("画面描述") or item.get("visual") or item.get("description") or "")[:500],
                "动作与表演": str(item.get("动作与表演") or item.get("action") or "")[:400],
                "景别运镜": str(item.get("景别运镜") or item.get("camera") or "")[:200],
            }
        )
    if len(norm) < 2:
        shot["shots"] = _default_shots(total_sec, shot)
        return
    ssum = sum(int(x["duration_sec"]) for x in norm)
    if ssum != total_sec and ssum > 0:
        scale = total_sec / ssum
        acc = 0
        for j, x in enumerate(norm[:-1]):
            x["duration_sec"] = max(1, int(round(x["duration_sec"] * scale)))
            acc += x["duration_sec"]
        norm[-1]["duration_sec"] = max(1, total_sec - acc)
    elif ssum == 0:
        shot["shots"] = _default_shots(total_sec, shot)
        return
    shot["shots"] = norm


def _client(settings: Settings) -> OpenAI:
    key = (settings.openai_api_key or settings.dashscope_api_key or "").strip()
    if not key:
        raise RuntimeError("未配置 OPENAI_API_KEY 或 DASHSCOPE_API_KEY（百炼）")
    return OpenAI(api_key=key, base_url=settings.openai_base_url)


def _extract_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        return {}
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def _chat_json(settings: Settings, system: str, user: str, max_tokens: int) -> dict[str, Any]:
    client = _client(settings)
    resp = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.35,
        max_tokens=max_tokens,
    )
    content = (resp.choices[0].message.content or "").strip()
    return _extract_json(content)


def run_orchestrator_llm(settings: Settings, user_prompt: str) -> dict[str, Any]:
    parsed = infer_duration_seconds(user_prompt, default=10)
    try:
        data = _chat_json(
            settings,
            ORCHESTRATOR_SYSTEM,
            f"用户需求：\n{user_prompt}\n请输出 JSON。",
            max_tokens=512,
        )
        data.setdefault("user_intent", user_prompt[:500])
        if user_specified_seconds(user_prompt):
            data["target_duration_sec"] = parsed
        else:
            try:
                tv = int(data.get("target_duration_sec", parsed))
            except (TypeError, ValueError):
                tv = parsed
            data["target_duration_sec"] = max(5, min(15, tv))
        return data
    except Exception as ex:
        logger.warning("总管 LLM 降级：%s", ex)
        return {
            "user_intent": user_prompt[:500],
            "mood": "",
            "key_elements": [],
            "target_duration_sec": parsed,
        }


def run_director(settings: Settings, orch: dict[str, Any], user_prompt: str) -> dict[str, Any]:
    try:
        n = int(orch.get("target_duration_sec"))
    except (TypeError, ValueError):
        n = infer_duration_seconds(user_prompt, default=10)
    n = max(5, min(15, n))
    user = (
        f"用户原话：{user_prompt}\n"
        f"总管摘要：{json.dumps(orch, ensure_ascii=False)}\n"
        f"总时长必须为 {n} 秒。请输出含 shot_script 的 JSON，且 shots 秒数之和等于 {n}。"
    )
    data = _chat_json(settings, _director_system(n), user, settings.llm_max_tokens_director)
    shot = data.get("shot_script")
    if not isinstance(shot, dict):
        shot = data if isinstance(data, dict) else {}
    shot["duration"] = n
    _normalize_shots(n, shot)
    return {"shot_script": shot}


def run_camera(
    settings: Settings,
    shot_script: dict[str, Any],
    *,
    qa_feedback: str = "",
    prior: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        total_sec = int(shot_script.get("duration") or 10)
    except (TypeError, ValueError):
        total_sec = 10
    total_sec = max(5, min(15, total_sec))
    cam_sys = _camera_system(total_sec)
    base = f"分镜脚本：\n{json.dumps(shot_script, ensure_ascii=False)}\n"
    if qa_feedback.strip():
        user = (
            base
            + f"上一轮提示词：{json.dumps(prior or {}, ensure_ascii=False)}\n"
            + f"质检建议：{qa_feedback}\n"
            + f"请输出优化后的 JSON，video_prompt 末尾仍须注明整段总时长约{total_sec}秒。"
        )
        data = _chat_json(settings, CAMERA_REVISE_SYSTEM, user, settings.llm_max_tokens_camera)
    else:
        user = base + "请输出 video_prompt 与 negative_prompt 的 JSON。"
        data = _chat_json(settings, cam_sys, user, settings.llm_max_tokens_camera)
    return {
        "video_prompt": str(data.get("video_prompt", "")).strip(),
        "negative_prompt": str(data.get("negative_prompt", "")).strip(),
    }


def run_qa(
    settings: Settings,
    user_prompt: str,
    shot_script: dict[str, Any],
    video_prompt: str,
    negative_prompt: str,
) -> dict[str, Any]:
    try:
        td = int(shot_script.get("duration") or infer_duration_seconds(user_prompt))
    except (TypeError, ValueError):
        td = infer_duration_seconds(user_prompt)
    td = max(5, min(15, td))
    user = (
        f"用户原话：{user_prompt}\n"
        f"用户目标总时长约 {td} 秒（以用户话术中的「X秒」为准）。\n"
        f"分镜：{json.dumps(shot_script, ensure_ascii=False)}\n"
        f"video_prompt：{video_prompt}\n"
        f"negative_prompt：{negative_prompt}\n"
        "请输出质检 JSON。"
    )
    data = _chat_json(settings, QA_SYSTEM_BASE, user, settings.llm_max_tokens_qa)
    return {
        "pass": bool(data.get("pass")),
        "score": int(data.get("score", 0)),
        "issues": data.get("issues") if isinstance(data.get("issues"), list) else [],
        "suggestion": str(data.get("suggestion", "")).strip(),
    }
