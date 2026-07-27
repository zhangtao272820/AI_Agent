from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = _BACKEND_DIR.parent


def resolve_proj_path(p: str | Path) -> Path:
    path = Path(p)
    return path.resolve() if path.is_absolute() else (PROJECT_ROOT / path).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", _BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 对话 / 意图解析：OpenAI 兼容（阿里云百炼 DashScope）
    openai_api_key: str = ""
    openai_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    # 免费档位常用：qwen3.5-flash、qwen3-8b 等（以控制台可用模型为准）
    openai_model: str = "qwen3.5-flash"

    # 架构：意图解析 / 文本质检 使用 Qwen3-VL（百炼模型名以控制台为准）
    qwen3_vl_model: str = "qwen3-vl-plus"
    use_qwen3_vl_for_intent: bool = True
    use_qwen3_vl_for_judge: bool = True

    # 带音频的听感评判：VL 兼容接口以图文为主，音频+文本 使用 Qwen-Omni（与官方多模态一致）
    qwen_omni_model: str = "qwen3.5-omni-plus"
    judge_audio_with_omni: bool = True

    dashscope_api_key: str = ""

    output_dir: str = ".data/music/out"
    music_frontend_dist: str = ""
    cors_origins: str = "http://localhost:5174,http://127.0.0.1:5174"
    api_host: str = "0.0.0.0"
    api_port: int = 28472

    # MIDI 试听：浏览器经 /api/soundfont/sgm_plus 拉取采样，避免直连 Google 被墙。
    # 留空则使用 soundfont_upstream.py 内置顺序（ghproxy 镜像优先，再回退官方）。
    midi_soundfont_upstream: str = ""
    midi_soundfont_upstream_fallbacks: str = ""

    # MIDI → 成品音频：FluidSynth + GM SoundFont（.sf2），更接近「整首混音」听感。
    midi_render_wav: bool = False
    midi_render_mp3: bool = False
    fluidsynth_path: str = "fluidsynth"
    ffmpeg_path: str = "ffmpeg"
    soundfont_sf2_path: str = ""
    midi_render_sample_rate: int = 44100
    midi_render_gain: float = 0.65

    # 闭环：质量评判与重试（架构 5.2 / 步骤7）
    compose_max_attempts: int = 3
    quality_score_threshold: int = 7
    enable_llm_judge: bool = True
    # 评判低于阈值时，用 LLM 将 suggestions 映射为下一轮完整意图（而非盲目重 roll）
    enable_judge_intent_patch: bool = True
    intent_patch_max_tokens: int = 384

    # 多轮改稿：内存会话（TTL 与条数防止泄漏）
    compose_session_ttl_seconds: int = 86400
    compose_session_max_entries: int = 500

    # 统一播放器试听时：上传文件用 LLM 根据摘要推断可视化意图（生成曲目可走缓存意图）
    enable_playback_visual_llm: bool = True
    playback_visual_max_tokens: int = 384

    # 试听时四边「听感文案」：依赖同一套 analysis / intent（听不见真实波形），与可视化意图独立请求
    enable_listening_caption_llm: bool = True
    listening_caption_max_tokens: int = 720

    # 音频转写：用于展示歌词/人声文本，若 API 不可用则自动降级为空
    audio_transcription_model: str = "whisper-1"
    audio_transcription_max_bytes: int = 25 * 1024 * 1024

    intent_user_max_chars: int = 1200
    intent_max_tokens: int = 512
    judge_user_max_chars: int = 900
    judge_max_tokens: int = 320
    judge_omni_max_tokens: int = 384
    technical_summary_chord_bars: int = 12
    technical_summary_issues_max_chars: int = 160
    # 听感评判：Omni 按音频计费，默认仅在整次创作结束后调用 1 次，重试循环内只用 VL 文本评判
    judge_omni_once_after_compose: bool = True
    judge_omni_audio_max_bytes: int = 2 * 1024 * 1024

    # 统一试听：对上传音频截取短 WAV 调 Qwen-Omni 生成带时间轴的意象短句（与 Whisper 歌词时间轴互补）
    enable_playback_omni_insight: bool = False
    playback_omni_insight_max_bytes: int = 1_800_000

    # 流式输出思考链（百炼 enable_thinking + SSE 的 reasoning_content / content）
    stream_model_thinking: bool = True

    # ---------- 模型音乐助手（POST /api/music/assistant；预留配置）----------
    enable_music_assistant: bool = True
    music_assistant_max_tokens: int = 768

    # 上传音频 + 曲名/歌手：背景检索式概括 + 诗意原创词（POST /api/music/poetic-lyrics）
    enable_poetic_lyrics_llm: bool = True
    poetic_lyrics_max_tokens: int = 1600

    # ---------- 重演绎 / MIDI 换音色（WebSocket type: remix | midi_swap）----------
    # Phase 1 瘦身：默认关闭音频重演绎（Spleeter + Basic Pitch 链路）
    enable_audio_remix: bool = False
    enable_midi_swap: bool = True
    enable_remix_llm_intent: bool = True
    remix_intent_max_tokens: int = 512
    remix_max_attempts: int = 2
    remix_quality_score_threshold: int = 7
    enable_remix_judge_patch: bool = True
    remix_patch_max_tokens: int = 384
    remix_judge_omni_after_render: bool = True
    enable_music_orchestrator: bool = True
    enable_style_router_llm: bool = True
    enable_arranger_llm: bool = True
    enable_melody_guard_llm: bool = True
    enable_remix_judge_llm: bool = True
    music_orchestrator_max_tokens: int = 700
    melody_guard_max_tokens: int = 420
    remix_audio_max_seconds: float = 300.0
    remix_timbral_only: bool = True
    remix_orchestrate_mode: str = "light"
    remix_orchestrate_bpm: float = 0.0
    remix_orchestrate_divisions: int = 2
    remix_orchestrate_max_harmony: int = 2
    remix_orchestrate_melody_priority: float = 0.92
    remix_orchestrate_style_hint: str = "auto"
    remix_vocal_pop_enabled: bool = True
    remix_vocal_pop_pitch_from_vocals: bool = True
    remix_vocal_pop_keep_vocal: bool = False
    remix_vocal_pop_vocal_gain_db: float = -1.5
    remix_vocal_pop_instrumental_gain_db: float = -6.0
    remix_vocal_pop_melody_priority: float = 0.96
    remix_vocal_pop_arrangement_mode: str = "vocal_band"
    remix_vocal_pop_wav_dyn_preset: str = "light"
    remix_loudnorm_i: float = -16.0
    remix_midi_apply_role_mix: bool = True
    remix_midi_render_dyn_preset: str = "light"
    remix_midi_render_gain: float = 0.58
    remix_midi_render_reverb: bool = True
    remix_midi_loudnorm: bool = True
    remix_instrumental_enabled: bool = True
    remix_instrumental_separate_mode: str = "4stems"
    remix_instrumental_melody_priority: float = 0.96
    remix_instrumental_drums_gain_db: float = -1.0
    remix_instrumental_bass_gain_db: float = -2.5
    remix_instrumental_lead_gain_db: float = 3.0
    remix_instrumental_render_gain: float = 0.62
    remix_instrumental_render_dyn_preset: str = "off"
    remix_instrumental_bgm_clean: bool = False
    remix_instrumental_bgm_pitch_tuned: bool = True
    remix_instrumental_bed_mix: bool = False
    remix_instrumental_bed_mix_piano_source: bool = False
    remix_instrumental_bed_gain_db: float = -16.0
    remix_instrumental_stabilize_grid: int = 16
    remix_instrumental_min_note_ms: float = 70.0
    remix_instrumental_legato_gap_ms: float = 120.0
    remix_instrumental_legato_overlap_ms: float = 45.0
    remix_instrumental_bgm_loudnorm: bool = False
    # 纯音乐 BGM 重演绎策略：anchor=保留原曲分轨旋律（推荐）；band=MIDI乐队；midi=单旋律MIDI
    remix_instrumental_strategy: str = "anchor"
    remix_instrumental_anchor_gain_db: float = 0.0

    # Phase 2：乐理工具（music21 分析 / 配和声 / ABC 导出）
    enable_music_theory: bool = True

    # Phase 3：Demucs 分轨（仅导出，不重编配）
    enable_demucs_stems: bool = True
    demucs_model: str = "htdemucs"
    demucs_stems_max_seconds: float = 300.0

    # auto：rule | neural；neural 引擎见 neural_engine
    compose_backend: str = "rule"  # auto | neural | rule
    neural_music_enabled: bool = False
    neural_engine: str = "musicgen"  # musicgen | stable_audio
    neural_model_id: str = "facebook/musicgen-small"
    stable_audio_model_id: str = "stabilityai/stable-audio-open-1.0"
    stable_audio_max_duration_gpu: int = 30
    stable_audio_max_duration_cpu: int = 12
    stable_audio_inference_steps: int = 100
    neural_device: str = "auto"  # auto | cuda | cpu（GTX 1050 2GB 建议 auto + FP16）
    neural_fp16: bool = True
    neural_max_duration_gpu: int = 12  # 2GB 显存建议 ≤12s
    neural_max_duration_cpu: int = 15
    neural_max_new_tokens: int = 768  # ~15s 音频上限，缩短生成时间
    neural_guidance_scale: float = 3.0
    neural_resample_44100: bool = True
    neural_cpu_fallback: bool = False  # CUDA 不可用时禁止 CPU 跑 MusicGen（极慢）
    neural_preload: bool = True  # 启动时预加载模型
    # 神经生成成功时优先作为试听 WAV（仍保留 MIDI 导出）
    neural_compose_preferred: bool = False


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    try:
        from .platform_config import apply_platform_models

        apply_platform_models(s)
    except Exception:
        pass
    return s
