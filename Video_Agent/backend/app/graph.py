import logging
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, TypedDict
from urllib.parse import urlparse

import httpx
from langgraph.graph import END, StateGraph

from .bgm_client import derive_music_brief
from .config import Settings, resolve_proj_path
from .llm_video import run_camera, run_director, run_orchestrator_llm, run_qa
from .video_duration import infer_duration_seconds
from .wan_video import ensure_output_dir, synthesize_video_url

logger = logging.getLogger(__name__)


class VideoAgentState(TypedDict, total=False):
    user_prompt: str
    orchestrator: dict[str, Any]
    shot_script: dict[str, Any]
    video_prompt: str
    negative_prompt: str
    video_url: str
    video_meta: dict[str, Any]
    bgm_url: str
    bgm_meta: dict[str, Any]
    final_video_url: str
    final_video_meta: dict[str, Any]
    quality_result: dict[str, Any]
    qa_failures: int
    last_qa_wants_retry: bool
    qa_feedback: str
    error: str


def _resolve_remote_url(url: str, base: str | None = None) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if urlparse(u).scheme in ("http", "https"):
        return u
    if u.startswith("/") and base:
        return f"{base.rstrip('/')}{u}"
    return u


def _fetch_to_path(url: str, dest: Path, *, timeout: float = 300) -> Path | None:
    if not url:
        return None
    if dest.is_file() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            with client.stream("GET", url) as rsp:
                rsp.raise_for_status()
                with dest.open("wb") as f:
                    for chunk in rsp.iter_bytes():
                        f.write(chunk)
        return dest if dest.is_file() and dest.stat().st_size > 0 else None
    except Exception as ex:
        logger.warning("download failed %s -> %s: %s", url, dest, ex)
        return None


def _ensure_local_video_url(settings: Settings, video_url: str, out_dir: Path) -> str:
    """将万相/CDN 外链下载到 output_dir，返回 /api/video/out/{name} 供总管代理播放。"""
    u = (video_url or "").strip()
    if not u:
        return ""
    if u.startswith("/api/video/out/"):
        return u
    remote = _resolve_remote_url(u)
    if not remote or remote.startswith("/api/"):
        return u
    dest = out_dir / f"wan_{uuid.uuid4().hex[:10]}.mp4"
    if _fetch_to_path(remote, dest):
        return f"/api/video/out/{dest.name}"
    logger.warning("materialize video failed, keep remote url: %s", u[:160])
    return u


def _local_video_out_url(path: Path) -> str:
    return f"/api/video/out/{path.name}"


def _orch_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    prompt = (state.get("user_prompt") or "").strip()
    if not prompt:
        return {"error": "用户指令为空", "orchestrator": {}}
    orch = run_orchestrator_llm(settings, prompt)
    return {"orchestrator": orch, "error": ""}


def _director_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    if state.get("error"):
        return {}
    prompt = state["user_prompt"]
    orch = state.get("orchestrator") or {}
    out = run_director(settings, orch, prompt)
    return {"shot_script": out.get("shot_script") or {}}


def _camera_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    if state.get("error"):
        return {}
    shot = state.get("shot_script") or {}
    feedback = (state.get("qa_feedback") or "").strip()
    prior = None
    if feedback:
        prior = {"video_prompt": state.get("video_prompt"), "negative_prompt": state.get("negative_prompt")}
    vp = run_camera(settings, shot, qa_feedback=feedback, prior=prior)
    return {"video_prompt": vp.get("video_prompt") or "", "negative_prompt": vp.get("negative_prompt") or ""}


def _video_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    if state.get("error"):
        return {}
    out_dir = ensure_output_dir(settings)
    prompt = state.get("video_prompt") or ""
    if not prompt.strip():
        return {"error": "视频提示词为空", "video_meta": {"mode": "none"}}
    neg = state.get("negative_prompt") or ""
    orch = state.get("orchestrator") or {}
    shot = state.get("shot_script") or {}
    try:
        d = int(orch.get("target_duration_sec") or shot.get("duration") or settings.wan_video_duration)
    except (TypeError, ValueError):
        d = infer_duration_seconds(state.get("user_prompt") or "", default=settings.wan_video_duration)
    d = max(5, min(15, d))
    res = synthesize_video_url(settings, prompt=prompt, negative_prompt=neg, out_dir=out_dir, duration_seconds=d)
    raw_url = res.get("video_url") or ""
    local_url = _ensure_local_video_url(settings, raw_url, out_dir) if raw_url else ""
    meta = {k: v for k, v in res.items() if k != "video_url"}
    if raw_url and local_url != raw_url:
        meta["remote_video_url"] = raw_url
    return {"video_url": local_url or raw_url, "video_meta": meta}


def _bgm_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    if state.get("error") or not settings.bgm_enabled:
        return {"bgm_meta": {"mode": "disabled"}}
    prompt = state.get("user_prompt") or state.get("video_prompt") or ""
    music_brief = derive_music_brief(prompt, settings)
    orch = state.get("orchestrator") or {}
    shot = state.get("shot_script") or {}
    try:
        dur = int(orch.get("target_duration_sec") or shot.get("duration") or settings.bgm_duration_seconds)
    except (TypeError, ValueError):
        dur = settings.bgm_duration_seconds
    http_url = (settings.music_agent_http_url or "").strip().rstrip("/")
    if not http_url:
        return {"bgm_meta": {"ok": False, "error": "music agent url not configured"}}
    try:
        out = httpx.post(
            f"{http_url}/api/music/generate-bgm",
            json={
                "prompt": prompt,
                "duration_seconds": dur,
                "key": settings.bgm_music_key,
                "tempo_bpm": settings.bgm_tempo_bpm,
                "emotion": music_brief["mood"],
                "style": music_brief["style_hint"],
                "music_brief": music_brief,
            },
            timeout=180,
        )
        out.raise_for_status()
        data = out.json()
    except httpx.HTTPStatusError as ex:
        detail = ex.response.text
        try:
            detail = ex.response.json().get("detail", detail)
        except Exception:
            pass
        return {"bgm_meta": {"ok": False, "error": str(detail or ex), "music_brief": music_brief}}
    except Exception as ex:
        return {"bgm_meta": {"ok": False, "error": str(ex), "music_brief": music_brief}}
    audio_url = data.get("audio_url") or data.get("wav_url") or data.get("mp3_url") or ""
    if not audio_url or not data.get("ok", True):
        return {
            "bgm_meta": {
                "ok": False,
                "error": data.get("detail") or data.get("error") or "music agent returned no audio_url",
                "music_brief": music_brief,
                **data,
            }
        }
    return {"bgm_url": audio_url, "bgm_meta": {"ok": True, "music_brief": music_brief, **data}}


def _mux_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    if state.get("error"):
        return {}
    video_url = state.get("video_url") or ""
    bgm_url = state.get("bgm_url") or ""
    if not video_url:
        return {"error": "视频缺失", "final_video_meta": {"mode": "none"}}
    if not bgm_url:
        return {"final_video_url": video_url, "final_video_meta": {"mode": "video_only"}}
    out_dir = ensure_output_dir(settings)
    merged = _merge_bgm_with_video(settings, video_url, bgm_url, out_dir)
    return merged


def _merge_bgm_with_video(settings: Settings, video_url: str, bgm_url: str, out_dir: Path) -> dict[str, Any]:
    music_base = (settings.music_agent_http_url or "").strip().rstrip("/")
    video_fetch = _resolve_remote_url(video_url)
    bgm_fetch = _resolve_remote_url(bgm_url, music_base)

    video_dest = out_dir / f"wan_{uuid.uuid4().hex[:10]}.mp4"
    bgm_name = Path(urlparse(bgm_url).path).name or f"bgm_{uuid.uuid4().hex[:10]}.wav"
    bgm_dest = out_dir / bgm_name

    if not _fetch_to_path(video_fetch, video_dest):
        return {
            "final_video_url": video_url,
            "final_video_meta": {"mode": "passthrough", "reason": "video_download_failed", "video_fetch": video_fetch},
        }
    local_only = _local_video_out_url(video_dest)
    if not _fetch_to_path(bgm_fetch, bgm_dest):
        return {
            "final_video_url": local_only,
            "final_video_meta": {"mode": "video_only_local", "reason": "bgm_download_failed", "bgm_fetch": bgm_fetch},
        }

    ffmpeg_bin = (shutil.which("ffmpeg") or "").strip()
    if not ffmpeg_bin:
        return {
            "final_video_url": local_only,
            "final_video_meta": {"mode": "video_only_local", "reason": "ffmpeg not found (install ffmpeg in image)"},
        }

    final_path = out_dir / f"final_with_bgm_{video_dest.stem}.mp4"
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(video_dest),
        "-i",
        str(bgm_dest),
        "-shortest",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(final_path),
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as ex:
        err = (ex.stderr or ex.stdout or str(ex))[:500]
        logger.warning("ffmpeg mux failed: %s", err)
        return {
            "final_video_url": local_only,
            "final_video_meta": {"mode": "video_only_local", "reason": f"ffmpeg_failed: {err}"},
        }

    return {
        "final_video_url": f"/api/video/out/{final_path.name}",
        "final_video_meta": {
            "mode": "merged",
            "video_path": str(video_dest),
            "bgm_path": str(bgm_dest),
            "local_path": str(final_path),
        },
    }


def _qa_node(settings: Settings, state: VideoAgentState) -> dict[str, Any]:
    if state.get("error"):
        return {"last_qa_wants_retry": False, "qa_feedback": ""}
    prompt = state["user_prompt"]
    shot = state.get("shot_script") or {}
    vp = state.get("video_prompt") or ""
    neg = state.get("negative_prompt") or ""
    qr = run_qa(settings, prompt, shot, vp, neg)
    failures_prev = int(state.get("qa_failures") or 0)
    not_pass = not bool(qr.get("pass"))
    will_retry = not_pass and failures_prev < settings.qa_max_fail_retries
    failures_next = failures_prev + (1 if not_pass else 0)
    return {"quality_result": qr, "qa_failures": failures_next, "last_qa_wants_retry": will_retry, "qa_feedback": (qr.get("suggestion") or "") if will_retry else ""}


def _route_after_qa(state: VideoAgentState):
    if state.get("error"):
        return END
    if state.get("last_qa_wants_retry"):
        return "camera"
    return END


def _route_after_orch(state: VideoAgentState):
    if state.get("error"):
        return END
    return "director"


def build_video_graph(settings: Settings):
    g = StateGraph(VideoAgentState)
    g.add_node("orchestrator", lambda s: _orch_node(settings, s))
    g.add_node("director", lambda s: _director_node(settings, s))
    g.add_node("camera", lambda s: _camera_node(settings, s))
    g.add_node("video_gen", lambda s: _video_node(settings, s))
    g.add_node("bgm", lambda s: _bgm_node(settings, s))
    g.add_node("mux", lambda s: _mux_node(settings, s))
    g.add_node("qa", lambda s: _qa_node(settings, s))
    g.set_entry_point("orchestrator")
    g.add_conditional_edges("orchestrator", _route_after_orch, {"director": "director", END: END})
    g.add_edge("director", "camera")
    g.add_edge("camera", "video_gen")
    g.add_edge("video_gen", "bgm")
    g.add_edge("bgm", "mux")
    g.add_edge("mux", "qa")
    g.add_conditional_edges("qa", _route_after_qa, {"camera": "camera", END: END})
    return g.compile()


def initial_state(user_prompt: str) -> VideoAgentState:
    return {"user_prompt": user_prompt.strip(), "qa_failures": 0, "qa_feedback": "", "last_qa_wants_retry": False}
