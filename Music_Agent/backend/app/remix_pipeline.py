"""重演绎流水线：MIDI 直改 / 音频分轨→转 MIDI→改音色→渲染→混音。"""
from __future__ import annotations

import logging
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .audio_separate import merge_stem_wavs, separate_stems, spleeter_available
from .audio_to_midi import audio_to_midi, audio_to_midi_bgm, basic_pitch_available, ensure_wav_for_pitch
from .midi_analyze import analyze_midi_structure, build_track_mappings_from_roles
from .instrumental_band import conduct_instrumental_band_midi, is_instrumental_band_plan, merge_instrumental_band_midi
from .midi_remap import apply_remix_plan
from .midi_render import render_midi_to_wav, resolve_soundfont_sf2
from .music_orchestrator import build_remix_plan, melody_guard_plan
from .midi_bgm_clean import clean_bgm_pitch_midi
from .midi_orchestrate import orchestrate_midi
from .midi_stabilize import stabilize_midi
from .remix_instrumental import (
    apply_instrumental_remix_plan,
    is_bgm_instrumental,
    is_instrumental_anchor_plan,
    is_instrumental_audio,
    is_instrumental_hybrid_plan,
    resolve_bed_stem,
    resolve_pitch_source_stem,
)
from .remix_mix import mix_anchor_remix, mix_instrumental_hybrid, mix_vocal_and_instrumental
from .remix_stem_process import process_anchor_stem
from .remix_timbral import apply_timbral_remix_defaults
from .remix_vocal_pop import (
    apply_vocal_pop_plan,
    is_vocal_pop_analysis,
    merge_vocal_melody_with_acc_bass,
)

logger = logging.getLogger(__name__)


def _apply_midi_arrangement(
    working_mid: Path,
    work_dir: Path,
    *,
    settings: Any,
    source_kind: str,
    plan: dict[str, Any],
    analysis: dict[str, Any] | None = None,
) -> tuple[Path, dict[str, Any]]:
    """转写/上传 MIDI → 统一节拍与织体（LLM 不参与此步）。"""
    plan = apply_timbral_remix_defaults(
        dict(plan),
        analysis=analysis,
        settings=settings,
    )
    if not plan.get("style_hint"):
        plan["style_hint"] = str(plan.get("remix_style") or "mandopop")
    if not plan.get("melody_priority"):
        plan["melody_priority"] = 0.92 if source_kind == "audio" else 0.88

    # 上传 MIDI 已有完整织体：仅改音色，避免重编配导致时长翻倍
    if source_kind == "midi":
        return working_mid, {"skipped": True, "reason": "preserve_upload_midi"}

    mode = str(
        plan.get("arrangement_mode")
        or getattr(settings, "remix_orchestrate_mode", "band")
        or "band"
    ).strip().lower()
    if mode in ("off", "none", "false", "0"):
        return working_mid, {}

    if mode in ("conducted", "band"):
        mode = "band"
    vocal_pop = is_vocal_pop_analysis(analysis)
    if vocal_pop and source_kind == "audio":
        mode = str(
            plan.get("arrangement_mode")
            or getattr(settings, "remix_vocal_pop_arrangement_mode", "vocal_band")
            or "vocal_band"
        ).lower()
        if mode not in ("vocal_band", "melody_only", "melody", "light", "band", "off"):
            mode = "vocal_band"
    elif source_kind == "audio" and mode == "band":
        mode = "light"

    bpm_ov = plan.get("tempo_bpm") or getattr(settings, "remix_orchestrate_bpm", 0)
    try:
        bpm_f = float(bpm_ov) if bpm_ov else None
        if bpm_f is not None and bpm_f <= 0:
            bpm_f = None
    except (TypeError, ValueError):
        bpm_f = None

    stabilized = work_dir / f"{working_mid.stem}_stable.mid"
    try:
        stab = stabilize_midi(working_mid, stabilized)
    except Exception as ex:
        logger.info("midi_stabilize skipped: %s", ex)
        stabilized = working_mid
        stab = {}
    else:
        working_mid = stabilized

    arranged = work_dir / f"{working_mid.stem}_conducted.mid"
    style_id = str(plan.get("remix_style") or plan.get("style_hint") or "mandopop")
    target_dur: float | None = None
    if analysis:
        try:
            target_dur = float(analysis.get("duration_seconds") or 0)
            if target_dur <= 0:
                target_dur = None
        except (TypeError, ValueError):
            target_dur = None
    stats = orchestrate_midi(
        working_mid,
        arranged,
        mode=mode,
        style_id=style_id,
        bpm_override=bpm_f,
        divisions_per_beat=int(getattr(settings, "remix_orchestrate_divisions", 2)),
        max_harmony=int(getattr(settings, "remix_orchestrate_max_harmony", 2)),
        melody_priority=float(
            plan.get("melody_priority") or getattr(settings, "remix_orchestrate_melody_priority", 0.92)
        ),
        style_hint=str(plan.get("style_hint") or getattr(settings, "remix_orchestrate_style_hint", "auto")),
        target_duration_sec=target_dur,
    )
    if stab:
        stats = {**stab, **stats}
    return arranged, stats

_AUDIO_SUFFIXES = frozenset({".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac"})
_MIDI_SUFFIXES = frozenset({".mid", ".midi"})


def _write_placeholder_midi(dest: Path) -> None:
    """音频锚定模式占位 MIDI（pipeline 兼容，不参与渲染）。"""
    from mido import Message, MetaMessage, MidiFile, MidiTrack, bpm2tempo

    dest.parent.mkdir(parents=True, exist_ok=True)
    mid = MidiFile(ticks_per_beat=480)
    tr = MidiTrack()
    tr.append(MetaMessage("set_tempo", tempo=int(bpm2tempo(120.0)), time=0))
    tr.append(Message("note_on", note=60, velocity=1, channel=0, time=0))
    tr.append(Message("note_off", note=60, velocity=0, channel=0, time=480))
    mid.tracks = [tr]
    mid.save(dest)


@dataclass
class RemixArtifacts:
    work_id: str
    source_path: Path
    source_kind: str  # midi | audio
    working_midi: Path | None = None
    remixed_midi: Path | None = None
    instrumental_wav: Path | None = None
    final_wav: Path | None = None
    vocal_stem: Path | None = None
    accompaniment_stem: Path | None = None
    stems: dict[str, str] = field(default_factory=dict)
    remap_report: dict[str, Any] = field(default_factory=dict)
    midi_stabilize: dict[str, Any] = field(default_factory=dict)
    midi_orchestrate: dict[str, Any] = field(default_factory=dict)
    midi_structure: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _resolve_separate_mode(plan: dict[str, Any], analysis: dict[str, Any] | None) -> str:
    sm = str(plan.get("separate_mode") or "auto").lower()
    if sm in ("2stems", "4stems", "none"):
        return sm
    if is_instrumental_audio(analysis) or is_instrumental_hybrid_plan(plan):
        return "4stems"
    return "2stems"


def prepare_working_midi_from_audio(
    src: Path,
    work_dir: Path,
    plan: dict[str, Any],
    *,
    settings: Any,
    ffmpeg_bin: str,
    max_pitch_seconds: float | None,
    analysis: dict[str, Any] | None = None,
) -> tuple[Path, RemixArtifacts]:
    """音频 →（可选分轨）→ Basic Pitch → working.mid"""
    work_dir.mkdir(parents=True, exist_ok=True)
    wid = uuid.uuid4().hex[:10]
    art = RemixArtifacts(work_id=wid, source_path=src, source_kind="audio")
    vocal_pop = is_vocal_pop_analysis(analysis)
    instrumental = is_instrumental_audio(analysis) or is_instrumental_hybrid_plan(plan)
    mode = _resolve_separate_mode(plan, analysis=analysis)

    pitch_src = src
    vocal_path: Path | None = None
    acc_path: Path | None = None
    stem_map: dict[str, Path] = {}

    if mode != "none" and spleeter_available():
        sep_dir = work_dir / "stems"
        try:
            stems = separate_stems(src, sep_dir, mode=mode)
            stem_map = {k: p for k, p in stems.items() if p and p.is_file()}
            for k, p in stem_map.items():
                art.stems[k] = str(p)
            vocal_path = stems.get("vocals")
            art.vocal_stem = vocal_path
            pitch_candidate = resolve_pitch_source_stem(stem_map, plan, analysis=analysis)
            if pitch_candidate and pitch_candidate.is_file():
                pitch_src = pitch_candidate
                art.stems["pitch_source"] = str(pitch_candidate)
            elif "accompaniment" in stems:
                acc_path = stems["accompaniment"]
                art.accompaniment_stem = acc_path
                if not (
                    vocal_pop
                    and getattr(settings, "remix_vocal_pop_pitch_from_vocals", True)
                    and vocal_path
                    and vocal_path.is_file()
                ):
                    pitch_src = acc_path
            elif mode == "4stems" and not instrumental:
                acc_parts = [stems.get("drums"), stems.get("bass"), stems.get("other")]
                acc_parts = [p for p in acc_parts if p and p.is_file()]
                if acc_parts:
                    merged = work_dir / "accompaniment_merged.wav"
                    if merge_stem_wavs(acc_parts, merged, ffmpeg_bin=ffmpeg_bin):
                        pitch_src = merged
                        art.accompaniment_stem = merged
                        art.stems["accompaniment"] = str(merged)
        except Exception as ex:
            art.warnings.append(f"人声分离跳过：{ex}")
    else:
        if mode != "none":
            art.warnings.append(
                "未检测到 spleeter，将对整曲做 audio→MIDI（建议 pip install spleeter 以分轨）"
            )

    if not basic_pitch_available():
        plan_probe = dict(plan)
        if instrumental:
            plan_probe = apply_instrumental_remix_plan(
                plan_probe,
                analysis=analysis if isinstance(analysis, dict) else None,
                settings=settings,
            )
        if not is_instrumental_anchor_plan(plan_probe):
            raise RuntimeError(
                "未安装 basic-pitch（pip install basic-pitch）。音频重演绎需要该依赖。"
            )

    use_vocal_melody = (
        vocal_pop
        and getattr(settings, "remix_vocal_pop_pitch_from_vocals", True)
        and vocal_path
        and vocal_path.is_file()
    )

    if use_vocal_melody:
        wav_vocal = work_dir / "for_pitch_vocal.wav"
        ensure_wav_for_pitch(
            vocal_path,
            wav_vocal,
            ffmpeg_bin=ffmpeg_bin,
            max_seconds=max_pitch_seconds,
        )
        vocal_mid = work_dir / "from_vocal.mid"
        audio_to_midi(wav_vocal, vocal_mid)
        working_mid = work_dir / "from_audio.mid"
        if acc_path and acc_path.is_file():
            wav_acc = work_dir / "for_pitch_acc.wav"
            ensure_wav_for_pitch(
                acc_path,
                wav_acc,
                ffmpeg_bin=ffmpeg_bin,
                max_seconds=max_pitch_seconds,
            )
            acc_mid = work_dir / "from_acc.mid"
            audio_to_midi(wav_acc, acc_mid)
            merge_vocal_melody_with_acc_bass(vocal_mid, acc_mid, working_mid)
            art.stems["melody_source"] = "vocals+acc_bass"
        else:
            import shutil

            shutil.copy2(vocal_mid, working_mid)
            art.stems["melody_source"] = "vocals"
        art.stems["melody_hint"] = "人声轨转写主旋律（未混原唱）"
    else:
        plan_pitch = dict(plan)
        if instrumental:
            plan_pitch = apply_instrumental_remix_plan(
                plan_pitch,
                analysis=analysis if isinstance(analysis, dict) else None,
                settings=settings,
            )
        anchor_mode = instrumental and is_instrumental_anchor_plan(plan_pitch)
        band_mode = instrumental and is_instrumental_band_plan(plan_pitch)
        other_stem = Path(art.stems["other"]) if art.stems.get("other") else None
        bass_stem = Path(art.stems["bass"]) if art.stems.get("bass") else None

        if anchor_mode and other_stem and other_stem.is_file():
            working_mid = work_dir / "from_audio.mid"
            _write_placeholder_midi(working_mid)
            art.stems["melody_source"] = "anchor:other"
            art.stems["anchor_mode"] = "1"
            art.midi_orchestrate = {"skipped": True, "reason": "instrumental_anchor"}
        elif band_mode and other_stem and other_stem.is_file():
            wav_other = work_dir / "for_pitch_other.wav"
            ensure_wav_for_pitch(
                other_stem,
                wav_other,
                ffmpeg_bin=ffmpeg_bin,
                max_seconds=max_pitch_seconds,
                sample_rate=44100,
            )
            other_mid = work_dir / "from_other_raw.mid"
            bass_mid_path = work_dir / "from_bass_raw.mid"
            working_mid = work_dir / "from_audio.mid"
            audio_to_midi_bgm(wav_other, other_mid)
            bass_mid: Path | None = None
            if bass_stem and bass_stem.is_file():
                wav_bass = work_dir / "for_pitch_bass.wav"
                ensure_wav_for_pitch(
                    bass_stem,
                    wav_bass,
                    ffmpeg_bin=ffmpeg_bin,
                    max_seconds=max_pitch_seconds,
                    sample_rate=44100,
                )
                audio_to_midi_bgm(wav_bass, bass_mid_path)
                bass_mid = bass_mid_path
            try:
                merge_stats = merge_instrumental_band_midi(other_mid, bass_mid, working_mid)
                art.midi_stabilize = {**art.midi_stabilize, "instrumental_band": merge_stats}
                art.stems["melody_source"] = "other+bass" if bass_mid else "other"
            except Exception as ex:
                art.warnings.append(f"乐队多轨合并失败，回退单轨：{ex}")
                shutil.copy2(other_mid, working_mid)
        else:
            wav_for_pitch = work_dir / "for_pitch.wav"
            ensure_wav_for_pitch(
                pitch_src,
                wav_for_pitch,
                ffmpeg_bin=ffmpeg_bin,
                max_seconds=max_pitch_seconds,
                sample_rate=44100,
            )
            raw_mid = work_dir / "from_audio_raw.mid"
            working_mid = work_dir / "from_audio.mid"
            if instrumental and getattr(settings, "remix_instrumental_bgm_pitch_tuned", True):
                audio_to_midi_bgm(wav_for_pitch, raw_mid)
            else:
                audio_to_midi(wav_for_pitch, raw_mid)
            use_clean = (
                instrumental
                and getattr(settings, "remix_instrumental_bgm_clean", True)
                and not band_mode
            )
            if use_clean:
                lead_inst = str(plan_pitch.get("lead_instrument") or "music_box")
                try:
                    clean_stats = clean_bgm_pitch_midi(
                        raw_mid,
                        working_mid,
                        grid_divisions=int(getattr(settings, "remix_instrumental_stabilize_grid", 16)),
                        min_note_ms=float(getattr(settings, "remix_instrumental_min_note_ms", 70.0)),
                        legato_gap_ms=float(getattr(settings, "remix_instrumental_legato_gap_ms", 120.0)),
                        legato_overlap_ms=float(
                            getattr(settings, "remix_instrumental_legato_overlap_ms", 45.0)
                        ),
                        lead_instrument=lead_inst,
                    )
                    art.midi_stabilize = {**art.midi_stabilize, "bgm_clean": clean_stats}
                except Exception as ex:
                    art.warnings.append(f"BGM 主旋律整理跳过：{ex}")
                    shutil.copy2(raw_mid, working_mid)
            else:
                shutil.copy2(raw_mid, working_mid)

    plan_audio = dict(plan)
    if instrumental:
        plan_audio = apply_instrumental_remix_plan(
            plan_audio,
            analysis=analysis if isinstance(analysis, dict) else None,
            settings=settings,
        )
    else:
        plan_audio = apply_vocal_pop_plan(
            plan_audio,
            analysis=analysis if isinstance(analysis, dict) else None,
            settings=settings,
        )
    skip_orch = str(plan_audio.get("arrangement_mode") or "").lower() in ("off", "none", "anchor")
    band_mode = is_instrumental_band_plan(plan_audio)
    anchor_mode_plan = is_instrumental_anchor_plan(plan_audio)
    if skip_orch or anchor_mode_plan:
        if anchor_mode_plan and not art.midi_orchestrate:
            art.midi_orchestrate = {"skipped": True, "reason": "instrumental_anchor"}
        elif skip_orch and not anchor_mode_plan:
            art.midi_orchestrate = {"skipped": True, "reason": "arrangement_off"}
    elif band_mode:
        try:
            conducted = work_dir / f"{working_mid.stem}_conducted.mid"
            target_dur: float | None = None
            if analysis:
                try:
                    target_dur = float(analysis.get("duration_seconds") or 0)
                    if target_dur <= 0:
                        target_dur = None
                except (TypeError, ValueError):
                    target_dur = None
            style_id = str(plan_audio.get("remix_style") or plan_audio.get("style_hint") or "bgm")
            orch = conduct_instrumental_band_midi(
                working_mid,
                conducted,
                style_id=style_id,
                divisions_per_beat=int(getattr(settings, "remix_orchestrate_divisions", 2)),
                melody_priority=float(
                    plan_audio.get("melody_priority")
                    or getattr(settings, "remix_instrumental_melody_priority", 0.96)
                ),
                target_duration_sec=target_dur,
            )
            working_mid = conducted
            art.midi_orchestrate = orch
        except Exception as ex:
            art.warnings.append(f"乐队指挥整理跳过：{ex}")
            art.midi_orchestrate = {"skipped": True, "reason": str(ex)}
    elif instrumental:
        art.midi_orchestrate = {"skipped": True, "reason": "preserve_melody_no_regrid"}
    else:
        try:
            working_mid, orch = _apply_midi_arrangement(
                working_mid,
                work_dir,
                settings=settings,
                source_kind="audio",
                plan=plan_audio,
                analysis=analysis if isinstance(analysis, dict) else None,
            )
            art.midi_orchestrate = orch
        except Exception as ex:
            art.warnings.append(f"编配整理跳过：{ex}")
    art.working_midi = working_mid
    if vocal_path and vocal_path.is_file():
        art.vocal_stem = vocal_path
    return working_mid, art


def run_remix_stages(
    *,
    settings: Any,
    src_path: Path,
    analysis: dict[str, Any] | None,
    plan: dict[str, Any],
    out_dir: Path,
    stem_prefix: str,
) -> RemixArtifacts:
    """执行 remap + render +（可选）mix，返回产物路径。"""
    suffix = src_path.suffix.lower()
    work_dir = out_dir / f"{stem_prefix}_work"
    work_dir.mkdir(parents=True, exist_ok=True)

    if suffix in _MIDI_SUFFIXES:
        working_mid = src_path
        orch: dict[str, Any] = {"skipped": True, "reason": "preserve_upload_midi"}
        midi_struct: dict[str, Any] = {}
        try:
            midi_struct = analyze_midi_structure(working_mid)
        except Exception as ex:
            logger.info("midi structure analyze skipped: %s", ex)
        art = RemixArtifacts(
            work_id=stem_prefix,
            source_path=src_path,
            source_kind="midi",
            working_midi=working_mid,
            midi_orchestrate=orch,
            midi_structure=midi_struct,
        )
    elif suffix in _AUDIO_SUFFIXES:
        max_sec = float(getattr(settings, "remix_audio_max_seconds", 0) or 0)
        max_pitch = max_sec if max_sec > 0 else None
        working_mid, art = prepare_working_midi_from_audio(
            src_path,
            work_dir,
            plan,
            settings=settings,
            ffmpeg_bin=str(getattr(settings, "ffmpeg_path", "ffmpeg")),
            max_pitch_seconds=max_pitch,
            analysis=analysis,
        )
        art.work_id = stem_prefix
    else:
        raise ValueError(f"不支持的文件类型: {suffix}")

    remixed_mid = out_dir / f"{stem_prefix}_remix.mid"
    effective_plan = apply_timbral_remix_defaults(
        dict(plan),
        analysis=analysis,
        settings=settings,
    )
    plan_ready = bool(effective_plan.get("band_parts")) and bool(effective_plan.get("track_mappings"))
    if getattr(settings, "enable_music_orchestrator", True) and not plan_ready:
        generated_plan = build_remix_plan(
            settings,
            analysis=analysis,
            filename=src_path.name,
            user_prompt=str(plan.get("notes") or ""),
        )
        effective_plan = {**plan, **generated_plan}
    if getattr(settings, "enable_melody_guard_llm", True):
        effective_plan = melody_guard_plan(
            settings,
            plan=effective_plan,
            analysis=analysis,
            filename=src_path.name,
            technical_summary="pipeline-start",
        )
    vocal_pop = is_vocal_pop_analysis(analysis)
    instrumental = is_instrumental_audio(analysis)
    if instrumental:
        effective_plan = apply_instrumental_remix_plan(
            effective_plan, analysis=analysis, settings=settings
        )
    elif vocal_pop:
        effective_plan = apply_vocal_pop_plan(
            effective_plan, analysis=analysis, settings=settings
        )
    effective_plan = apply_timbral_remix_defaults(
        effective_plan,
        analysis=analysis,
        settings=settings,
    )

    anchor_mode = is_instrumental_anchor_plan(effective_plan)
    if anchor_mode and art.source_kind == "audio":
        other_p = Path(art.stems.get("other", ""))
        if not other_p.is_file():
            art.warnings.append("音频锚定：无 other 分轨，使用整曲")
            other_p = src_path
        anchor_proc = work_dir / "anchor_proc.wav"
        proc_stats = process_anchor_stem(
            other_p,
            anchor_proc,
            lead_instrument=str(effective_plan.get("lead_instrument") or "flute"),
            source_instrument=str(effective_plan.get("source_instrument") or "piano"),
            gain_db=float(effective_plan.get("anchor_gain_db", 0.0)),
            ffmpeg_bin=str(getattr(settings, "ffmpeg_path", "ffmpeg")),
        )
        final_wav = out_dir / f"{stem_prefix}_anchor.wav"
        drums_p = Path(art.stems["drums"]) if art.stems.get("drums") else None
        bass_p = Path(art.stems["bass"]) if art.stems.get("bass") else None
        dg = float(effective_plan.get("drums_gain_db", -3.0))
        bg = float(effective_plan.get("bass_gain_db", -6.0))
        ag = float(effective_plan.get("anchor_gain_db", 0.0))
        if proc_stats.get("ok") and mix_anchor_remix(
            anchor_wav=anchor_proc,
            output_wav=final_wav,
            drums_wav=drums_p,
            bass_wav=bass_p,
            anchor_gain_db=ag,
            drums_gain_db=dg,
            bass_gain_db=bg,
            ffmpeg_bin=str(getattr(settings, "ffmpeg_path", "ffmpeg")),
        ):
            art.final_wav = final_wav
            art.instrumental_wav = anchor_proc
            art.remixed_midi = working_mid
            art.remap_report = {
                "strategy": "instrumental_anchor",
                "remix_mode": "instrumental_anchor",
                "anchor_process": proc_stats,
                "hybrid_mix": {
                    "anchor_gain_db": ag,
                    "drums_gain_db": dg,
                    "bass_gain_db": bg,
                    "output": str(final_wav),
                },
            }
            if art.midi_orchestrate:
                art.remap_report["midi_orchestrate"] = art.midi_orchestrate
            return art
        art.warnings.append("音频锚定混合失败，回退 MIDI 渲染")

    if art.source_kind == "midi":
        effective_plan["remix_mode"] = "midi_swap"
        effective_plan["apply_role_mix"] = bool(
            getattr(settings, "remix_midi_apply_role_mix", True)
        )
        struct = art.midi_structure or {}
        if struct.get("midi_tracks"):
            effective_plan["midi_tracks"] = struct["midi_tracks"]
        elif analysis and analysis.get("midi_tracks"):
            effective_plan["midi_tracks"] = analysis["midi_tracks"]
        band = effective_plan.get("band_parts")
        maps = effective_plan.get("track_mappings") or []
        midi_tracks = effective_plan.get("midi_tracks") or []
        if (
            isinstance(band, list)
            and band
            and isinstance(midi_tracks, list)
            and midi_tracks
            and len(maps) <= 1
        ):
            role_maps = build_track_mappings_from_roles(midi_tracks, band)
            if role_maps:
                effective_plan["track_mappings"] = role_maps
    art.remap_report = apply_remix_plan(working_mid, remixed_mid, effective_plan)
    if art.midi_orchestrate:
        art.remap_report["midi_orchestrate"] = art.midi_orchestrate
    if art.midi_stabilize:
        art.remap_report["midi_stabilize"] = art.midi_stabilize
    art.remixed_midi = remixed_mid

    sf2 = resolve_soundfont_sf2(str(getattr(settings, "soundfont_sf2_path", "")))
    if not sf2 or not sf2.is_file():
        raise RuntimeError("未配置 SoundFont（SOUNDFONT_SF2_PATH）")

    inst_wav = out_dir / f"{stem_prefix}_instrumental.wav"
    style = str(effective_plan.get("harmony_style") or plan.get("harmony_style") or "pop")
    dyn_preset = str(getattr(settings, "remix_wav_dyn_preset", "light"))
    render_gain = float(getattr(settings, "midi_render_gain", 0.62))
    use_loudnorm = bool(getattr(settings, "remix_wav_loudnorm", True))
    render_reverb: bool | None = None
    if art.source_kind == "midi":
        dyn_preset = str(getattr(settings, "remix_midi_render_dyn_preset", "light"))
        render_gain = float(getattr(settings, "remix_midi_render_gain", 0.58))
        style_id = str(effective_plan.get("remix_style") or effective_plan.get("style_hint") or "")
        if style_id in ("classical", "folk") or style in ("classical", "folk"):
            render_reverb = bool(getattr(settings, "remix_midi_render_reverb", True))
        use_loudnorm = bool(getattr(settings, "remix_midi_loudnorm", True))
    if instrumental:
        dyn_preset = str(getattr(settings, "remix_instrumental_render_dyn_preset", "off"))
        render_gain = float(getattr(settings, "remix_instrumental_render_gain", 0.62))
        style_id = str(effective_plan.get("remix_style") or effective_plan.get("style_hint") or "")
        if is_bgm_instrumental(analysis, effective_plan):
            if is_instrumental_band_plan(effective_plan):
                style = "classical"
                render_reverb = bool(getattr(settings, "remix_midi_render_reverb", True))
                dyn_preset = str(getattr(settings, "remix_instrumental_render_dyn_preset", "light"))
            else:
                style = "solo_piano"
                render_reverb = False
            use_loudnorm = bool(getattr(settings, "remix_instrumental_bgm_loudnorm", False))
        elif style_id in ("classical", "folk"):
            render_reverb = bool(getattr(settings, "remix_midi_render_reverb", True))
        else:
            render_reverb = False
    elif vocal_pop:
        dyn_preset = str(
            effective_plan.get("wav_dyn_preset")
            or getattr(settings, "remix_vocal_pop_wav_dyn_preset", "light")
        )
        render_gain = min(render_gain, 0.58)
        style = str(effective_plan.get("harmony_style") or "pop")
    ok = render_midi_to_wav(
        remixed_mid,
        inst_wav,
        soundfont_path=sf2,
        fluidsynth_bin=str(getattr(settings, "fluidsynth_path", "fluidsynth")),
        sample_rate=int(getattr(settings, "midi_render_sample_rate", 44100)),
        gain=render_gain,
        style_hint=style,
        ffmpeg_bin=str(getattr(settings, "ffmpeg_path", "ffmpeg")),
        wav_dyn_flat_preset=dyn_preset,
        wav_loudnorm=use_loudnorm,
        loudnorm_i=float(getattr(settings, "remix_loudnorm_i", -16.0)),
        use_reverb=render_reverb,
    )
    if not ok:
        raise RuntimeError("FluidSynth 渲染失败")
    art.instrumental_wav = inst_wav

    keep_vocal = bool(effective_plan.get("keep_vocal"))
    if (
        vocal_pop
        and keep_vocal
        and art.vocal_stem
        and art.vocal_stem.is_file()
    ):
        mixed_wav = out_dir / f"{stem_prefix}_with_vocal.wav"
        vg = float(effective_plan.get("vocal_gain_db", -1.5))
        ig = float(effective_plan.get("instrumental_gain_db", -10.0))
        if mix_vocal_and_instrumental(
            art.vocal_stem,
            inst_wav,
            mixed_wav,
            vocal_gain_db=vg,
            instrumental_gain_db=ig,
            ffmpeg_bin=str(getattr(settings, "ffmpeg_path", "ffmpeg")),
        ):
            art.final_wav = mixed_wav
            art.remap_report["vocal_mix"] = {
                "vocal_gain_db": vg,
                "instrumental_gain_db": ig,
                "output": str(mixed_wav),
            }
        else:
            art.warnings.append("原唱混回失败，仅输出器乐渲染")
            art.final_wav = inst_wav
    elif is_instrumental_hybrid_plan(effective_plan) and bool(effective_plan.get("hybrid_mix")):
        drums_p = Path(art.stems.get("drums", "")) if art.stems.get("drums") else None
        bass_p = None
        if not bool(effective_plan.get("hybrid_drums_only")):
            bass_p = Path(art.stems.get("bass", "")) if art.stems.get("bass") else None
        stem_paths = {k: Path(v) for k, v in art.stems.items() if v}
        bed_p = resolve_bed_stem(stem_paths, effective_plan, analysis=analysis)
        has_rhythm = (drums_p and drums_p.is_file()) or (bass_p and bass_p.is_file())
        has_bed = bed_p and bed_p.is_file()
        if has_rhythm or has_bed:
            hybrid_wav = out_dir / f"{stem_prefix}_hybrid.wav"
            dg = float(effective_plan.get("drums_gain_db", -1.0))
            bg = float(effective_plan.get("bass_gain_db", -2.5))
            lg = float(effective_plan.get("lead_gain_db", 0.0))
            bed_g = float(effective_plan.get("bed_gain_db", -10.0))
            bed_filter = str(effective_plan.get("bed_filter") or "light")
            if mix_instrumental_hybrid(
                lead_wav=inst_wav,
                output_wav=hybrid_wav,
                drums_wav=drums_p,
                bass_wav=bass_p,
                bed_wav=bed_p,
                lead_gain_db=lg,
                drums_gain_db=dg,
                bass_gain_db=bg,
                bed_gain_db=bed_g,
                bed_filter=bed_filter,
                ffmpeg_bin=str(getattr(settings, "ffmpeg_path", "ffmpeg")),
            ):
                art.final_wav = hybrid_wav
                art.remap_report["hybrid_mix"] = {
                    "drums_gain_db": dg,
                    "bass_gain_db": bg,
                    "lead_gain_db": lg,
                    "bed_gain_db": bed_g,
                    "bed_stem": str(bed_p) if bed_p else None,
                    "output": str(hybrid_wav),
                }
            else:
                art.warnings.append("纯音乐混合失败，仅输出主旋律渲染")
                art.final_wav = inst_wav
        else:
            art.warnings.append("未分出鼓/贝斯/铺底，仅输出主旋律渲染")
            art.final_wav = inst_wav
    else:
        art.final_wav = inst_wav

    return art


def technical_summary_for_remix(art: RemixArtifacts, plan: dict[str, Any]) -> str:
    parts = [
        f"source={art.source_kind}",
        f"mappings={len(plan.get('track_mappings') or [])}",
        f"remap_changes={len(art.remap_report.get('changes') or [])}",
    ]
    if art.source_kind == "midi" and art.midi_structure:
        ms = art.midi_structure
        parts.append(f"perf_tracks={ms.get('performance_tracks')}")
        if ms.get("roles"):
            parts.append(f"roles={ms.get('roles')}")
    if art.stems:
        parts.append(f"stems={list(art.stems.keys())}")
    if art.warnings:
        parts.append(f"warn={'; '.join(art.warnings[:3])}")
    return "; ".join(parts)
