/**
 * 将后端意图 JSON（parse_music_intent / refine / patch）映射为画布参数，
 * 供 RhythmBackground 与实时频谱融合，实现「模型参与」的可视化。
 */

export type MusicVisualProfile = {
  /** 主色相 0–360 */
  hueBase: number;
  /** 柱 / 极光色相展开 */
  hueSpread: number;
  /** 饱和度加成（情绪） */
  saturationBoost: number;
  /** 波浪线速度系数（随 tempo） */
  waveSpeedMul: number;
  /** 波浪振幅系数 */
  waveAmpMul: number;
  /** 整体能量偏置 0–1，调制 idle 与发光 */
  energyBias: number;
  /** 示波/颗粒「活跃度」 */
  shimmer: number;
  /** 小调 / 暗色倾向 */
  minorLean: number;
  /** 人声/歌曲倾向 0–1 */
  vocalBias: number;
  /** 可视化密度 0–1 */
  visualDensity: number;
  /** 图层数量/丰富度 0–1 */
  layerDensity: number;
  /** 运动复杂度 0–1 */
  motionComplexity: number;
  /** 脉冲强度 0–1 */
  pulseStrength: number;
  /** 氛围感 0–1 */
  atmosphere: number;
  /** 亮度 0–1 */
  brightness: number;
  /** 对比度 0–1 */
  contrast: number;
  /** 立体展开 0–1 */
  stereoWideness: number;
  /** 低频权重 0–1 */
  bassWeight: number;
  /** 高能量感 0–1 */
  highEnergy: number;
  /** 原声倾向 0–1 */
  acousticness: number;
  /** 主要乐器 */
  primaryInstruments: string[];
  /** 次要乐器 */
  secondaryInstruments: string[];
  /** 可视化标签 */
  visualTags: string[];
  /** 简短标签（调试用） */
  label: string;
};

const DEFAULT_PROFILE: MusicVisualProfile = {
  hueBase: 258,
  hueSpread: 48,
  saturationBoost: 0,
  waveSpeedMul: 1,
  waveAmpMul: 1,
  energyBias: 0.5,
  shimmer: 0.45,
  minorLean: 0,
  vocalBias: 0,
  visualDensity: 0.72,
  layerDensity: 0.72,
  motionComplexity: 0.55,
  pulseStrength: 0.55,
  atmosphere: 0.52,
  brightness: 0.48,
  contrast: 0.54,
  stereoWideness: 0.52,
  bassWeight: 0.45,
  highEnergy: 0.5,
  acousticness: 0.35,
  primaryInstruments: ["piano"],
  secondaryInstruments: [],
  visualTags: ["minimal"],
  label: "默认",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
}

/** 中英关键词 → 色相与能量（启发式，无需再请求模型） */
function emotionStyle(emotion: string): { hue: number; energy: number; shimmer: number } {
  const e = emotion.toLowerCase();
  if (/忧郁|忧伤|悲/.test(emotion) || /melanchol|sad|blue|somber|lonely/i.test(e)) {
    return { hue: 268, energy: 0.4, shimmer: 0.38 };
  }
  if (/宁静|轻柔|柔和|平静/.test(emotion) || /calm|peace|gentle|soft/i.test(e)) {
    return { hue: 218, energy: 0.38, shimmer: 0.35 };
  }
  if (/欢快|活泼|兴奋|快乐/.test(emotion) || /joy|happy|bright|energetic|upbeat/i.test(e)) {
    return { hue: 32, energy: 0.72, shimmer: 0.62 };
  }
  if (/浪漫|温暖|恋/.test(emotion) || /romantic|warm|tender/i.test(e)) {
    return { hue: 328, energy: 0.58, shimmer: 0.55 };
  }
  if (/黑暗|紧张|激烈/.test(emotion) || /dark|tense|intense|aggressive/i.test(e)) {
    return { hue: 292, energy: 0.68, shimmer: 0.58 };
  }
  if (/神秘/.test(emotion) || /myster|ethereal|ambient/i.test(e)) {
    return { hue: 242, energy: 0.48, shimmer: 0.5 };
  }
  if (/思念|渴望|惆怅/.test(emotion) || /yearning|nostalgic|reflective|bittersweet|wistful/i.test(e)) {
    return { hue: 312, energy: 0.56, shimmer: 0.54 };
  }
  if (/倾诉|张力|释放/.test(emotion) || /expressive|passionate|dramatic/i.test(e)) {
    return { hue: 8, energy: 0.7, shimmer: 0.58 };
  }
  return { hue: 258, energy: 0.52, shimmer: 0.45 };
}

function harmonyHueShift(style: string): number {
  const s = style.toLowerCase();
  if (s.includes("jazz")) return 18;
  if (s.includes("classical")) return -6;
  if (s.includes("folk")) return 24;
  return 0;
}

/** 从 key 字段猜测大调/小调（如 G minor、C大调） */
function minorFromKey(keyRaw: string): number {
  const k = keyRaw.toLowerCase();
  if (/小调|minor|min\b/.test(k)) return 0.85;
  if (/大调|major/.test(k)) return 0.15;
  return 0.45;
}

/**
 * 由意图对象生成可视化剖面；intent 为空则返回默认。
 */
export function profileFromIntent(intent: Record<string, unknown> | null): MusicVisualProfile {
  if (!intent || typeof intent !== "object") {
    return { ...DEFAULT_PROFILE };
  }

  const emotion = str(intent.emotion) || "calm";
  const em = emotionStyle(emotion);
  const tempo = num(intent.tempo, 100);
  const tempoNorm = Math.max(0, Math.min(1, (tempo - 40) / 160));
  const harmony_style = str(intent.harmony_style) || "pop";
  const key = str(intent.key) || "C大调";
  const style = str(intent.style).toLowerCase();
  const duration = num(intent.duration_seconds, 45);
  const hasVocal = Boolean((intent.has_vocal ?? (intent.vocal_label === "song" || intent.vocal_label === "vocal")));
  const primaryInstruments = arr(intent.primary_instruments);
  const secondaryInstruments = arr(intent.secondary_instruments);
  const visualTags = arr(intent.visual_tags);
  const instrumentCount = num(intent.instrument_count, primaryInstruments.length || 1);
  const visualDensity = clamp01(num(intent.visual_density, 0.72));
  const layerDensity = clamp01(num(intent.layer_density, 0.72));
  const motionComplexity = clamp01(num(intent.motion_complexity, 0.55));
  const pulseStrength = clamp01(num(intent.pulse_strength, 0.55));
  const atmosphere = clamp01(num(intent.atmosphere, 0.52));
  const brightness = clamp01(num(intent.brightness, 0.48));
  const contrast = clamp01(num(intent.contrast, 0.54));
  const stereoWideness = clamp01(num(intent.stereo_wideness, 0.52));
  const bassWeight = clamp01(num(intent.bass_weight, 0.45));
  const highEnergy = clamp01(num(intent.high_energy, 0.5));
  const acousticness = clamp01(num(intent.acousticness, 0.35));

  const waveSpeedMul =
    0.78 + tempoNorm * 0.72 + (harmony_style.includes("jazz") ? 0.14 : 0) + motionComplexity * 0.14;
  const waveAmpMul =
    0.92 +
    (1 - tempoNorm) * 0.2 +
    (harmony_style.includes("classical") ? 0.14 : 0) +
    em.energy * 0.16 +
    bassWeight * 0.1 +
    pulseStrength * 0.08;

  const minorLean = minorFromKey(key);
  const hueBase =
    em.hue +
    harmonyHueShift(harmony_style) +
    minorLean * 12 +
    (style.includes("electronic") ? 40 : 0) +
    (style.includes("j-pop") || style.includes("jpop") ? 18 : 0);
  const hueSpread =
    42 +
    (harmony_style.includes("jazz") ? 26 : 0) +
    tempoNorm * 14 +
    stereoWideness * 14 +
    em.energy * 8;

  const energyBias =
    em.energy * (0.75 + Math.min(1, duration / 120) * 0.25) + minorLean * 0.08 + (hasVocal ? 0.08 : 0) + highEnergy * 0.08;

  const vocalBias = hasVocal ? Math.max(0.72, num(intent.vocal_presence, 0.12)) : num(intent.vocal_presence, 0.12);
  const label = `${emotion} · ${tempo}bpm · ${harmony_style}${hasVocal ? " · vocal" : ""}`;

  return {
    hueBase: ((hueBase % 360) + 360) % 360,
    hueSpread,
    saturationBoost:
      (harmony_style.includes("folk") ? 10 : 6) +
      Math.round(em.energy * 20) +
      (style.includes("j-pop") || style.includes("jpop") ? 12 : 0),
    waveSpeedMul,
    waveAmpMul,
    energyBias: Math.max(0.15, Math.min(1, energyBias)),
    shimmer: em.shimmer,
    minorLean,
    vocalBias,
    visualDensity,
    layerDensity,
    motionComplexity,
    pulseStrength,
    atmosphere,
    brightness,
    contrast,
    stereoWideness,
    bassWeight,
    highEnergy,
    acousticness,
    primaryInstruments: primaryInstruments.length ? primaryInstruments : ["piano"],
    secondaryInstruments,
    visualTags: visualTags.length ? visualTags : ["minimal"],
    label: `${label} · ${instrumentCount} instruments`,
  };
}

function lerpHueShort(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (a + d * t + 360) % 360;
}

/** 每帧线性插值，避免意图突变闪屏 */
export function lerpProfile(
  a: MusicVisualProfile,
  b: MusicVisualProfile,
  t: number,
): MusicVisualProfile {
  const u = Math.max(0, Math.min(1, t));
  const l = (x: number, y: number) => x + (y - x) * u;
  return {
    hueBase: lerpHueShort(a.hueBase, b.hueBase, u),
    hueSpread: l(a.hueSpread, b.hueSpread),
    saturationBoost: l(a.saturationBoost, b.saturationBoost),
    waveSpeedMul: l(a.waveSpeedMul, b.waveSpeedMul),
    waveAmpMul: l(a.waveAmpMul, b.waveAmpMul),
    energyBias: l(a.energyBias, b.energyBias),
    shimmer: l(a.shimmer, b.shimmer),
    minorLean: l(a.minorLean, b.minorLean),
    vocalBias: l(a.vocalBias, b.vocalBias),
    visualDensity: l(a.visualDensity, b.visualDensity),
    layerDensity: l(a.layerDensity, b.layerDensity),
    motionComplexity: l(a.motionComplexity, b.motionComplexity),
    pulseStrength: l(a.pulseStrength, b.pulseStrength),
    atmosphere: l(a.atmosphere, b.atmosphere),
    brightness: l(a.brightness, b.brightness),
    contrast: l(a.contrast, b.contrast),
    stereoWideness: l(a.stereoWideness, b.stereoWideness),
    bassWeight: l(a.bassWeight, b.bassWeight),
    highEnergy: l(a.highEnergy, b.highEnergy),
    acousticness: l(a.acousticness, b.acousticness),
    primaryInstruments: u > 0.5 ? b.primaryInstruments : a.primaryInstruments,
    secondaryInstruments: u > 0.5 ? b.secondaryInstruments : a.secondaryInstruments,
    visualTags: u > 0.5 ? b.visualTags : a.visualTags,
    label: u > 0.5 ? b.label : a.label,
  };
}

/**
 * 随播放进度 0..1 做慢变调制（与实时 FFT 叠加），模拟乐段推移带来的色相/波动/能量变化。
 */
export function songProgressVisualOffsets(progress01: number): {
  hueShift: number;
  energyMul: number;
  waveAmpMul: number;
  pulseMul: number;
  highEnergyMul: number;
} {
  const p = Math.max(0, Math.min(1, progress01));
  const a = Math.sin(p * Math.PI * 2 * 2.5);
  const b = Math.sin(p * Math.PI * 2 * 6.2 + 0.9);
  const c = Math.sin(p * Math.PI * 2 * 1.1 + 0.3);
  return {
    hueShift: a * 26 + b * 11 + c * 6,
    energyMul: 0.86 + Math.abs(a) * 0.2 + (0.5 + 0.5 * b) * 0.1,
    waveAmpMul: 0.82 + Math.abs(b) * 0.32 + (0.5 + 0.5 * Math.sin(p * Math.PI * 4)) * 0.14,
    pulseMul: 0.88 + (0.5 + 0.5 * a) * 0.22 + Math.abs(c) * 0.08,
    highEnergyMul: 0.9 + Math.abs(Math.sin(p * Math.PI * 2 * 4.3)) * 0.18,
  };
}

/** 上传侧车 JSON → 伪意图（LLM 未返回前也能驱动配色） */
function pseudoIntentFromUploadAnalysis(
  analysis: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!analysis || typeof analysis !== "object") return {};
  const lang = String(analysis.lyrics_language ?? "").toLowerCase();
  const wl = String(analysis.transcription_whisper_language ?? "").toLowerCase();
  const lyrics = String(analysis.lyrics_text ?? "").trim();
  const lyricsLen = lyrics.length;
  const hasVocal = Boolean(analysis.has_vocal);
  const vocalLabel = String(analysis.vocal_label ?? "").toLowerCase();
  let dur = num(analysis.duration_seconds, 0);
  if (!dur || dur < 1) dur = 45;
  dur = Math.max(15, Math.min(180, dur));

  const likelySong = lyricsLen > 6 || hasVocal || vocalLabel === "song";
  if (!likelySong) {
    if (wl === "ja" || wl === "japanese") {
      return {
        emotion: "yearning",
        style: "j-pop",
        tempo: 88,
        harmony_style: "pop",
        duration_seconds: dur,
        vocal_presence: 0.48,
        visual_tags: ["vocal", "song"],
        motion_complexity: 0.65,
        layer_density: 0.75,
        visual_density: 0.8,
        high_energy: 0.55,
        key: "A小调",
      };
    }
    return {};
  }

  if (lang === "ja" || wl === "ja" || wl === "japanese") {
    return {
      emotion: "yearning",
      style: "j-pop",
      tempo: 86,
      harmony_style: "pop",
      duration_seconds: dur,
      has_vocal: true,
      vocal_presence: Math.min(0.95, 0.5 + lyricsLen / 900),
      visual_tags: ["lyric", "vocal", "song", "japanese"],
      motion_complexity: 0.74,
      layer_density: 0.82,
      visual_density: 0.85,
      high_energy: 0.6,
      key: "A小调",
    };
  }
  if (lang === "zh") {
    return {
      emotion: "reflective",
      style: "mandopop",
      tempo: 90,
      harmony_style: "pop",
      duration_seconds: dur,
      has_vocal: true,
      vocal_presence: Math.min(0.95, 0.48 + lyricsLen / 900),
      visual_tags: ["lyric", "vocal", "song"],
      motion_complexity: 0.7,
      layer_density: 0.8,
      visual_density: 0.82,
      high_energy: 0.56,
      key: "C大调",
    };
  }
  if (lang === "en") {
    return {
      emotion: "expressive",
      style: "western_pop",
      tempo: 102,
      harmony_style: "pop",
      duration_seconds: dur,
      has_vocal: true,
      vocal_presence: Math.min(0.95, 0.46 + lyricsLen / 900),
      visual_tags: ["lyric", "vocal", "song"],
      motion_complexity: 0.72,
      layer_density: 0.78,
      visual_density: 0.82,
      high_energy: 0.58,
      key: "C大调",
    };
  }
  return {
    emotion: "expressive",
    style: "pop",
    tempo: 96,
    harmony_style: "pop",
    duration_seconds: dur,
    has_vocal: true,
    vocal_presence: Math.min(0.95, 0.42 + lyricsLen / 900),
    visual_tags: ["lyric", "vocal", "song"],
    motion_complexity: 0.68,
    layer_density: 0.76,
    visual_density: 0.8,
    high_energy: 0.55,
    key: "C大调",
  };
}

/**
 * 统一试听背景：合并「上传 analysis 启发式」与「playback-visual LLM 意图」，
 * LLM 字段优先覆盖。
 */
export function mergePlaybackVisualIntent(opts: {
  llmIntent: Record<string, unknown> | null | undefined;
  uploadAnalysis: Record<string, unknown> | null | undefined;
}): Record<string, unknown> | null {
  const fromFile = pseudoIntentFromUploadAnalysis(opts.uploadAnalysis);
  const llm = opts.llmIntent;
  if (llm && typeof llm === "object" && Object.keys(llm).length > 0) {
    return { ...fromFile, ...llm };
  }
  if (Object.keys(fromFile).length > 0) return fromFile;
  return null;
}
