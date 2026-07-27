import { useCallback, useEffect, useRef } from "react";
import {
  lerpProfile,
  profileFromIntent,
  songProgressVisualOffsets,
  type MusicVisualProfile,
} from "./musicVisualProfile";

type Props = {
  /** 生成中提高律动强度（无音频回放时的兜底动画） */
  composeActive: boolean;
  /** 当前驱动可视化的 HTMLAudioElement（播放时绑定 Web Audio 分析器） */
  audioElement: HTMLAudioElement | null;
  /**
   * 页面上有任意试听在播放（含 midi-player 内部 audio）。
   * Web Audio 未接入时用于合成频谱律动，避免 MIDI 试听时背景静止。
   */
  playbackSurfaceActive?: boolean;
  /**
   * LLM 解析后的音乐意图（intent / 会话修订 / 质检补丁），驱动色相与波浪参数；
   * 与 FFT 频谱融合，实现「模型参与」的背景可视化。
   */
  aiIntent?: Record<string, unknown> | null;
  /** 全屏看背景时略减粒子/环线/扫描线，降低 GPU 压力 */
  vizUiMinimized?: boolean;
  /** 有四边听感文案时加强左右边缘频谱梯绘制 */
  captionRailsActive?: boolean;
};

type AudioGraph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  gain: GainNode;
  /** 每个 media 只能 createMediaElementSource 一次 */
  sources: Map<HTMLMediaElement, MediaElementAudioSourceNode>;
  activeEl: HTMLMediaElement | null;
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 柱数与粒子在流畅度与表现力间折中（48 柱足够映射 FFT 且减轻 fillRect 压力） */
const BAR_COUNT = 48;
const FFT_SIZE = 512;
const PARTICLE_N = 44;
const SCOPE_POINTS = 128;
const RING_N = 5;
const VISUAL_LERP = 0.32;
const FFT_BIN_LERP = 0.34;
const PARTICLE_SWARM_N = 14;
/** 略低则环线/山峦更跟节拍；过高会像「糊住」 */
const ANALYSER_SMOOTHING = 0.72;

/** 横坐标 → 霓虹渐变色相（随 AI 主色展开，类参考图绿→青→蓝可平移） */
function neonHueAtX(x: number, w: number, hb: number, spread: number): number {
  const t = (x / Math.max(1, w) - 0.5) * 2;
  return (((hb + t * spread) % 360) + 360) % 360;
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  seed: number;
  tw: number;
  life: number;
  phase: number;
};

type SwarmParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  anchorX: number;
  anchorY: number;
  size: number;
  hueOffset: number;
  seed: number;
};

export function RhythmBackground({
  composeActive,
  audioElement,
  playbackSurfaceActive = false,
  aiIntent = null,
  vizUiMinimized = false,
  captionRailsActive = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aiIntentRef = useRef<Record<string, unknown> | null>(null);
  const smoothedProfileRef = useRef<MusicVisualProfile>(
    profileFromIntent(null),
  );
  const rafRef = useRef<number>(0);
  const graphRef = useRef<AudioGraph | null>(null);
  const freqScratchRef = useRef(new Uint8Array(FFT_SIZE / 2));
  const timeScratchRef = useRef(new Uint8Array(FFT_SIZE));
  /** FFT 指数平滑后的能量 */
  const binEnergyRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  /** 空间模糊后的目标值 */
  const spatialTmpRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  /** 最终绘制用（惯性跟随 spatial） */
  const visualBarsRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => 0));
  const scopePtsRef = useRef(new Float32Array(SCOPE_POINTS));
  /** 慢变化整体电平（驱动光晕/粒子，避免随节拍猛跳） */
  const ambientLevelRef = useRef(0);
  /** 上一帧平均音量（用于波浪基幅） */
  const levelRef = useRef(0);
  const particlesRef = useRef<Particle[] | null>(null);
  const swarmRef = useRef<SwarmParticle[] | null>(null);
  /** 低频包络（随旋律/节拍缓变，不用频谱质心避免「跟鼠标乱晃」感） */
  const bassEnvelopeRef = useRef(0);
  /** 低频瞬态（kick 感，调制波浪相位） */
  const bassTransientRef = useRef(0);

  useEffect(() => {
    aiIntentRef.current = aiIntent ?? null;
  }, [aiIntent]);

  const vizUiMinimizedRef = useRef(vizUiMinimized);
  useEffect(() => {
    vizUiMinimizedRef.current = vizUiMinimized;
  }, [vizUiMinimized]);

  const captionRailsActiveRef = useRef(captionRailsActive);
  useEffect(() => {
    captionRailsActiveRef.current = captionRailsActive;
  }, [captionRailsActive]);

  const ensureParticles = (w: number, h: number) => {
    let p = particlesRef.current;
    if (p && p.length === PARTICLE_N) return p;
    p = Array.from({ length: PARTICLE_N }, (_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: 0.6 + Math.random() * 1.9,
      seed: i * 997 + Math.random() * 100,
      tw: Math.random(),
      life: 0.5 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    }));
    particlesRef.current = p;
    return p;
  };

  const ensureSwarm = (w: number, h: number) => {
    let s = swarmRef.current;
    if (s && s.length === PARTICLE_SWARM_N) return s;
    s = Array.from({ length: PARTICLE_SWARM_N }, (_, i) => {
      const x = w * (0.18 + (i / Math.max(1, PARTICLE_SWARM_N - 1)) * 0.64);
      const y = h * (0.34 + Math.sin(i * 0.75) * 0.12);
      return {
        x,
        y,
        vx: 0,
        vy: 0,
        anchorX: x,
        anchorY: y,
        size: 1.6 + Math.random() * 2.5,
        hueOffset: Math.random() * 42 - 21,
        seed: i * 337 + Math.random() * 1000,
      };
    });
    swarmRef.current = s;
    return s;
  };

  /** 切换当前连接到分析器的音源（同一时间只可视化一条链路，避免混音重复） */
  const setActiveMediaEl = useCallback(async (el: HTMLMediaElement | null) => {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;

    if (!graphRef.current) {
      const ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      analyser.connect(gain);
      gain.connect(ctx.destination);
      graphRef.current = {
        ctx,
        analyser,
        gain,
        sources: new Map(),
        activeEl: null,
      };
    }

    const g = graphRef.current;
    if (g.activeEl === el) {
      if (g.ctx.state === "suspended") await g.ctx.resume().catch(() => {});
      return;
    }

    if (g.activeEl) {
      const prev = g.sources.get(g.activeEl);
      if (prev) {
        try {
          prev.disconnect();
        } catch {
          /* ignore */
        }
      }
      g.activeEl = null;
    }

    if (!el) return;

    let src = g.sources.get(el);
    if (!src) {
      try {
        src = g.ctx.createMediaElementSource(el);
        g.sources.set(el, src);
      } catch {
        /* 可能已被其它脚本连接 */
        return;
      }
    }

    try {
      src.connect(g.analyser);
      g.activeEl = el;
      await g.ctx.resume();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!audioElement) {
      void setActiveMediaEl(null);
      return;
    }
    const syncGraph = () => {
      if (!audioElement.paused) void setActiveMediaEl(audioElement);
      else void setActiveMediaEl(null);
    };
    syncGraph();
    audioElement.addEventListener("play", syncGraph);
    audioElement.addEventListener("playing", syncGraph);
    audioElement.addEventListener("pause", syncGraph);
    audioElement.addEventListener("ended", syncGraph);
    return () => {
      audioElement.removeEventListener("play", syncGraph);
      audioElement.removeEventListener("playing", syncGraph);
      audioElement.removeEventListener("pause", syncGraph);
      audioElement.removeEventListener("ended", syncGraph);
      void setActiveMediaEl(null);
    };
  }, [audioElement, setActiveMediaEl]);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const heavy = w * h > 2_000_000;
      const dpr = Math.min(window.devicePixelRatio || 1, heavy ? 1.25 : 1.75);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const ensureBarArrayLen = (arr: { current: number[] }) => {
      if (arr.current.length !== BAR_COUNT) {
        const prev = arr.current;
        arr.current = Array.from({ length: BAR_COUNT }, (_, i) => prev[i] ?? 0);
      }
    };

    /** 长时播放时避免每帧全量绘制 + FFT 拖死主线程（MIDI 播放器与试听会共线程卡顿） */
    const frameBudgetRef = { current: 0 };

    const draw = (now: number) => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      /** 有创作/回放/任意试听面在动 → 全特效；否则视为空闲首页，走 lite 档减轻 GPU */
      const vizMin = vizUiMinimizedRef.current;
      const surfaceActive =
        composeActive ||
        playbackSurfaceActive ||
        Boolean(audioElement && !audioElement.paused);
      const lite = vizMin || !surfaceActive;
      const minGapMs = hidden
        ? 520
        : surfaceActive
          ? 1000 / (lite ? 20 : 28)
          : 1000 / 22;
      if (now - frameBudgetRef.current < minGapMs) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      frameBudgetRef.current = now;

      const t = now * 0.001;
      const targetProf = profileFromIntent(aiIntentRef.current);
      smoothedProfileRef.current = lerpProfile(
        smoothedProfileRef.current,
        targetProf,
        0.12,
      );
      const p = smoothedProfileRef.current;
      const minor = p.minorLean;
      const vocal = p.vocalBias;
      const visualDensity = p.visualDensity;
      const layerDensity = p.layerDensity;
      const motionComplexity = p.motionComplexity;
      const atmosphere = p.atmosphere;
      const brightness = p.brightness;
      const bassWeight = p.bassWeight;
      const stereoWideness = p.stereoWideness;
      const primaryInstrument = (p.primaryInstruments[0] || "").toLowerCase();
      const secondaryCount = p.secondaryInstruments.length;
      const lyricDensity = Math.min(1, (p.visualTags.join(" ").includes("lyric") ? 0.2 : 0) + (vocal > 0.5 ? 0.35 : 0));
      const instrumentBias =
        primaryInstrument.includes("drum") || primaryInstrument.includes("kick")
          ? 0.18
          : primaryInstrument.includes("bass")
            ? 0.12
            : primaryInstrument.includes("synth")
              ? 0.1
              : 0;

      /** `<audio>` 实际在播：用于兜底律动（Web Audio 未接上时仍驱动波纹，避免「中线死水」） */
      const htmlAudioPlaying = Boolean(audioElement && !audioElement.paused);

      const g = graphRef.current;
      const analyser = g?.analyser;
      /** Map 内已有该 media 的 source 时视为可分析（缓解 activeEl 竞态导致全程不走 FFT） */
      const mediaPlaying = htmlAudioPlaying;
      const hasSourceForEl = Boolean(
        audioElement && g?.sources.has(audioElement),
      );
      /** 有 MediaElementSource 且正在播即读 FFT（避免 activeEl 竞态一帧读不到频谱） */
      const playing =
        mediaPlaying &&
        Boolean(analyser) &&
        Boolean(audioElement) &&
        (g?.activeEl === audioElement || hasSourceForEl);

      let spectrumBoost = 0;
      let waveAmpMod = 0.35;

      if (playing && analyser) {
        const n = analyser.frequencyBinCount;
        if (freqScratchRef.current.length !== n) {
          freqScratchRef.current = new Uint8Array(n);
        }
        const data = freqScratchRef.current;
        analyser.getByteFrequencyData(data);

        ensureBarArrayLen(binEnergyRef);
        ensureBarArrayLen(spatialTmpRef);
        ensureBarArrayLen(visualBarsRef);
        const bins = binEnergyRef.current;
        const spatial = spatialTmpRef.current;
        const visual = visualBarsRef.current;
        let sum = 0;
        /* 较缓的 per-bin 映射，减轻高频毛刺 */
        const expMap = 1.12;
        for (let i = 0; i < BAR_COUNT; i++) {
          const i0 = Math.floor((i / BAR_COUNT) ** expMap * n);
          const i1 = Math.min(n - 1, Math.floor(((i + 1) / BAR_COUNT) ** expMap * n));
          let acc = 0;
          let cnt = 0;
          for (let j = i0; j <= i1; j++) {
            acc += data[j];
            cnt++;
          }
          const norm = cnt ? acc / cnt / 255 : 0;
          bins[i] = bins[i] * (1 - FFT_BIN_LERP) + norm * FFT_BIN_LERP;
          sum += norm;
        }
        /* 5 点加权平滑，减少「毛刺柱」导致的乱线感 */
        for (let i = 0; i < BAR_COUNT; i++) {
          const a = bins[Math.max(0, i - 2)] ?? 0;
          const b = bins[Math.max(0, i - 1)] ?? 0;
          const c = bins[i] ?? 0;
          const d = bins[Math.min(BAR_COUNT - 1, i + 1)] ?? 0;
          const e = bins[Math.min(BAR_COUNT - 1, i + 2)] ?? 0;
          spatial[i] = (a + 4 * b + 6 * c + 4 * d + e) / 16;
        }
        for (let i = 0; i < BAR_COUNT; i++) {
          const a = spatial[Math.max(0, i - 1)] ?? 0;
          const b = spatial[i] ?? 0;
          const c = spatial[Math.min(BAR_COUNT - 1, i + 1)] ?? 0;
          bins[i] = (a + 2 * b + c) / 4;
        }
        for (let i = 0; i < BAR_COUNT; i++) {
          spatial[i] = bins[i] ?? 0;
        }
        for (let i = 0; i < BAR_COUNT; i++) {
          visual[i] += (spatial[i] - visual[i]) * VISUAL_LERP;
        }

        spectrumBoost = sum / BAR_COUNT;
        levelRef.current = levelRef.current * 0.78 + spectrumBoost * 0.22;
        waveAmpMod = 0.52 + levelRef.current * 1.25;
        ambientLevelRef.current +=
          (spectrumBoost - ambientLevelRef.current) * 0.072;

        const tdLen = analyser.fftSize;
        if (timeScratchRef.current.length !== tdLen) {
          timeScratchRef.current = new Uint8Array(tdLen);
        }
        analyser.getByteTimeDomainData(timeScratchRef.current);

        const td = timeScratchRef.current;
        const sp = scopePtsRef.current;
        for (let i = 0; i < SCOPE_POINTS; i++) {
          const t0 = Math.floor((i / SCOPE_POINTS) * tdLen);
          const t1 = Math.max(t0 + 1, Math.floor(((i + 1) / SCOPE_POINTS) * tdLen));
          let s2 = 0;
          for (let j = t0; j < t1; j++) s2 += td[j] ?? 0;
          const avg = s2 / (t1 - t0);
          const target = (avg - 128) / 128;
          sp[i] += (target - sp[i]) * 0.24;
        }
      } else if (playbackSurfaceActive || htmlAudioPlaying) {
        /* Web Audio 未接通或 MIDI 路径：仍按节拍合成柱与示波，保证中层波浪/山峦可见跳动 */
        ensureBarArrayLen(visualBarsRef);
        const visual = visualBarsRef.current;
        let sum = 0;
        for (let i = 0; i < BAR_COUNT; i++) {
          const ph = t * 2.85 + i * 0.12;
          const beat = 0.38 + 0.62 * (0.5 + 0.5 * Math.sin(ph)) ** 2;
          const shim =
            0.52 +
            0.48 * Math.sin(t * 3.55 + i * 0.21) * Math.sin(t * 5.1 + i * 0.07);
          const norm = Math.min(1, beat * shim * 1.08);
          visual[i] += (norm - visual[i]) * 0.2;
          sum += norm;
        }
        spectrumBoost = sum / BAR_COUNT;
        levelRef.current = levelRef.current * 0.8 + spectrumBoost * 0.2;
        ambientLevelRef.current += (spectrumBoost - ambientLevelRef.current) * 0.09;
        waveAmpMod = 0.58 + spectrumBoost * 1.35;
        const sp = scopePtsRef.current;
        for (let i = 0; i < SCOPE_POINTS; i++) {
          const ph = (i / SCOPE_POINTS) * Math.PI * 8 + t * 4.2;
          const target =
            Math.sin(ph) * 0.38 * (0.55 + spectrumBoost) +
            Math.sin(ph * 2.1 + t * 2.8) * 0.12;
          sp[i] += (target - sp[i]) * 0.15;
        }
      } else {
        levelRef.current *= 0.92;
        ambientLevelRef.current *= 0.965;
        ensureBarArrayLen(binEnergyRef);
        ensureBarArrayLen(visualBarsRef);
        const bins = binEnergyRef.current;
        const visual = visualBarsRef.current;
        for (let i = 0; i < BAR_COUNT; i++) {
          bins[i] *= 0.9;
          visual[i] += (bins[i] - visual[i]) * 0.08;
        }
        const spOff = scopePtsRef.current;
        for (let i = 0; i < SCOPE_POINTS; i++) spOff[i] *= 0.94;
      }

      const lively =
        Boolean(playing) || playbackSurfaceActive || htmlAudioPlaying;
      const mediaEl = audioElement;
      let songProg = 0;
      if (
        mediaEl &&
        mediaEl.duration > 0 &&
        Number.isFinite(mediaEl.duration) &&
        !mediaEl.paused
      ) {
        songProg = Math.max(0, Math.min(1, mediaEl.currentTime / mediaEl.duration));
      } else if (playbackSurfaceActive || (mediaEl && !mediaEl.paused)) {
        songProg = (t * 0.042) % 1;
      } else {
        songProg = 0;
      }
      const progOff = songProgressVisualOffsets(songProg);
      let hb = (((p.hueBase + progOff.hueShift) % 360) + 360) % 360;
      let pulseStrength = Math.max(0, Math.min(1, p.pulseStrength * progOff.pulseMul));
      let highEnergy = Math.max(0, Math.min(1, p.highEnergy * progOff.highEnergyMul));
      const waveProgressScale = progOff.waveAmpMul;
      const energyProgressScale = progOff.energyMul;

      const ambient = ambientLevelRef.current;
      const vbRhythm = visualBarsRef.current;
      let bassLow = 0;
      for (let i = 0; i < 14; i++) bassLow += vbRhythm[i] ?? 0;
      const bassNormRhythm = Math.min(1, bassLow / 14);
      bassEnvelopeRef.current +=
        (bassNormRhythm - bassEnvelopeRef.current) * (lively ? 0.14 : 0.06);
      const env = bassEnvelopeRef.current;
      const kickRaw = Math.max(0, bassNormRhythm - env * 0.88);
      bassTransientRef.current += (kickRaw - bassTransientRef.current) * 0.35;

      /* 只使用播放进度与低频包络驱动舞台/波线，不读取鼠标坐标，避免视觉焦点乱飘 */
      let my = Math.sin(t * 0.22 + songProg * Math.PI * 2) * 0.08;
      if (lively) {
        my += (env - 0.42) * 0.08 + bassTransientRef.current * 0.035;
      }
      const rhythmBeat =
        0.5 +
        0.5 *
          Math.sin(
            t * (1.55 + p.pulseStrength * 0.55) +
              songProg * Math.PI * 2 +
              env * 1.2,
          );
      const melodySway =
        Math.sin(t * (0.42 * p.waveSpeedMul) + songProg * Math.PI * 2) * 0.34 +
        Math.sin(t * (0.19 * p.waveSpeedMul) + env * 2.2) * 0.16;
      const wavePhaseKick =
        melodySway +
        env * 0.58 +
        bassTransientRef.current * 0.85 +
        rhythmBeat * 0.16;

      const moodLift = 0.86 + p.energyBias * 0.34 + highEnergy * 0.12;
      const idleEnergy =
        (composeActive ? 1.05 : lively ? 0.72 : 0.42) * moodLift;
      const energy = (
        lively
          ? Math.min(
              1.28,
              (0.45 + ambient * (1.55 + p.shimmer * 0.32 + pulseStrength * 0.18) + idleEnergy * 0.14) *
                moodLift,
            )
          : idleEnergy
      ) * energyProgressScale;

      const scaleBHEarly = Math.min(w, h);
      const stageCxPre = w * 0.5;
      const stageCyPre = h * 0.56 + my * scaleBHEarly * 0.002;
      const stageShieldR = scaleBHEarly * (0.15 + energy * 0.028);

      /* 基底：多段渐变（色相随 AI 意图），暗角随后 */
      const g0 = ctx.createLinearGradient(0, 0, w, h * 1.05);
      const satBg =
        44 +
        p.saturationBoost * 1.15 +
        vocal * 14 -
        minor * 5 +
        visualDensity * 12 +
        highEnergy * 6;
      const brightMul = 0.78 + brightness * 0.28;
      g0.addColorStop(
        0,
        `hsla(${hb}, ${satBg}%, ${(11 - minor * 3) * brightMul}%, ${0.72 + energy * 0.04})`,
      );
      g0.addColorStop(
        0.35,
        `hsla(${hb + 18}, ${satBg - 4}%, ${(10 - minor * 2) * brightMul}%, ${0.52 + energy * 0.06 + (lively ? ambient * 0.08 : 0)})`,
      );
      g0.addColorStop(
        0.65,
        `hsla(${hb - 12}, ${satBg - 6}%, ${(9 - minor * 2) * brightMul}%, ${0.53 + energy * 0.08})`,
      );
      g0.addColorStop(1, `hsla(${hb}, 28%, ${5 * brightMul}%, ${0.82})`);
      ctx.fillStyle = g0;
      ctx.fillRect(0, 0, w, h);

      const vignette = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        Math.min(w, h) * 0.12,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.72,
      );
      vignette.addColorStop(0, "transparent");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);

      /* —— 背景「山峦」频谱：整体上移减弱，并在舞台圆心带衰减，避免透过半透明核糊住主舞台 —— */
      {
        const vbM = visualBarsRef.current;
        const yBase = h * 0.805;
        const maxPeak = h * (0.085 + energy * 0.032 + ambient * 0.028);
        const hueSpread = Math.min(58, p.hueSpread * 0.72 + p.highEnergy * 10);
        const smoothVM = (idx: number) => {
          const a = vbM[Math.max(0, idx - 1)] ?? 0;
          const b = vbM[idx] ?? 0;
          const c = vbM[Math.min(BAR_COUNT - 1, idx + 1)] ?? 0;
          return (a + 2 * b + c) / 4;
        };
        const barW = w / BAR_COUNT;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        for (let i = 0; i < BAR_COUNT; i++) {
          if (lite && i % 2 === 1) continue;
          const u = i / (BAR_COUNT - 1 || 1);
          const centerBell = Math.exp(-(((u - 0.5) / 0.42) ** 2) * 2.8);
          let vi = smoothVM(i) * centerBell * (0.5 + ambient * 0.42);
          const x = (i / BAR_COUNT) * w;
          const cx = x + barW * 0.5;
          const barTopApprox = yBase - maxPeak * vi * 1.2;
          const dx = (cx - stageCxPre) / stageShieldR;
          const dy = (barTopApprox - stageCyPre) / stageShieldR;
          const distCore = Math.hypot(dx, dy);
          if (distCore < 1.35) {
            vi *= 0.18 + 0.82 * Math.min(1, distCore * distCore * 1.4);
          }
          const bh = maxPeak * vi * (playing ? 1.12 : 1);
          if (bh < 0.35) continue;
          const hue = neonHueAtX(cx, w, hb, hueSpread);
          const sat = 72 + p.saturationBoost * 0.35;
          const lg = ctx.createLinearGradient(x, yBase, x, yBase - bh);
          lg.addColorStop(0, `hsla(${hue}, ${sat}%, 58%, ${0.06 + vi * 0.16})`);
          lg.addColorStop(0.55, `hsla(${hue + 8}, ${sat}%, 52%, ${0.04 + vi * 0.11})`);
          lg.addColorStop(1, `hsla(${hue + 14}, ${sat - 6}%, 46%, 0)`);
          ctx.fillStyle = lg;
          ctx.fillRect(x, yBase - bh, Math.max(1.5, barW * 1.05), bh);
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
      }

      const audioDrive = lively
        ? Math.max(0.5, ambient + bassEnvelopeRef.current * 0.8 + bassTransientRef.current * 1.45)
        : 0;
      const audioPulse = lively
        ? Math.max(0, bassTransientRef.current * 1.8 + env * 0.9 + spectrumBoost * 0.9)
        : 0;

      /* 极光色块（叠加发光） */
      const prevComp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = "screen";
      const orbs = Math.min(
        lite ? 4 : 9,
        Math.max(
          3,
          Math.round(2 + audioDrive * 2.5 + audioPulse * 1.85 + visualDensity * 2.5 + (vocal > 0.45 ? 1 : 0) + lyricDensity * 2),
        ),
      );
      for (let o = 0; o < orbs; o++) {
        const cornerBias = o % 4;
        const ox =
          cornerBias < 2
            ? w * (0.06 + (o % 2) * 0.1) + Math.sin(t * 0.05 + o) * w * 0.04
            : w * (0.82 + (o % 2) * 0.08) + Math.cos(t * 0.06 + o * 1.1) * w * 0.035;
        const oy =
          cornerBias === 0 || cornerBias === 3
            ? h * (0.08 + (o % 3) * 0.05) + Math.cos(t * 0.05 + o * 0.7) * h * 0.03
            : h * (0.72 + (o % 2) * 0.12) + Math.sin(t * 0.055 + o) * h * 0.04;
        const rad = Math.min(w, h) * (0.26 + (o % 3) * 0.04);
        const og = ctx.createRadialGradient(ox, oy, 0, ox, oy, rad);
        const hue =
          hb +
          o * (p.hueSpread / 4) +
          ambient * 22 -
          minor * 8 +
          vocal * 12;
        og.addColorStop(
          0,
          `hsla(${hue}, 82%, 62%, ${0.14 + energy * 0.09 + (lively ? ambient * 0.14 : 0) + pulseStrength * 0.08 + bassTransientRef.current * 0.06})`,
        );
        og.addColorStop(0.45, `hsla(${hue + 22}, 72%, 52%, ${0.06 + highEnergy * 0.05})`);
        og.addColorStop(1, "transparent");
        ctx.fillStyle = og;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = prevComp;

      /* 全屏响应网格：列/行亮度随对应频段起伏（略加密 + kick 时更亮） */
      {
        const visG = visualBarsRef.current;
        const gxStep = w > 1600 ? 62 : 48;
        const gyStep = h > 900 ? 56 : 44;
        const kickBoost = bassTransientRef.current * 0.055 + audioPulse * 0.028;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.lineCap = "round";
        for (let gx = 0; gx <= w; gx += gxStep) {
          const bi = Math.min(BAR_COUNT - 1, Math.floor((gx / Math.max(1, w)) * BAR_COUNT));
          const v = visG[bi] ?? 0;
          const pulse =
            0.012 +
            v * 0.072 +
            ambient * 0.022 +
            energy * 0.016 +
            bassTransientRef.current * 0.038 +
            kickBoost;
          ctx.strokeStyle = `hsla(${hb + bi * 1.8}, 74%, 62%, ${Math.min(0.42, pulse)})`;
          ctx.lineWidth = lite ? 1 : 1 + v * 0.85;
          ctx.beginPath();
          ctx.moveTo(gx + 0.5, 0);
          ctx.lineTo(gx + 0.5, h);
          ctx.stroke();
        }
        for (let gy = 0; gy <= h; gy += gyStep) {
          const mix = (gy / Math.max(1, h)) * (BAR_COUNT * 0.55) + bassNormRhythm * (BAR_COUNT * 0.22);
          const bi = Math.min(BAR_COUNT - 1, Math.max(0, Math.floor(mix)));
          const v = visG[bi] ?? 0;
          const pulse =
            0.01 +
            v * 0.058 +
            ambient * 0.018 +
            (lively ? audioDrive * 0.02 : 0) +
            kickBoost * 0.85;
          ctx.strokeStyle = `hsla(${hb + bi + 8}, 70%, 60%, ${Math.min(0.38, pulse)})`;
          ctx.lineWidth = lite ? 1 : 1 + v * 0.65;
          ctx.beginPath();
          ctx.moveTo(0, gy + 0.5);
          ctx.lineTo(w, gy + 0.5);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 漂浮微粒：低速漂移 + 柔和明暗（不跟瞬时节拍猛闪） */
      const parts = ensureParticles(w, h);
      const twinkleBase =
        0.34 +
        energy * (0.42 + p.shimmer * 0.22) +
        (lively ? ambient * (0.72 + p.shimmer * 0.26) : 0) +
        vocal * 0.14 +
        lyricDensity * 0.1 +
        pulseStrength * 0.14 +
        bassTransientRef.current * 0.12;
      const pStep = lite ? 2 : lively ? 1 : 2;
      for (let pi = 0; pi < parts.length; pi += pStep) {
        const pt = parts[pi]!;
        pt.x += (pt.vx + Math.sin(t * 0.18 + pt.seed) * 0.06) * 0.55;
        pt.y += (pt.vy + Math.cos(t * 0.16 + pt.seed * 0.7) * 0.05) * 0.55;
        if (pt.x < -20) pt.x = w + 20;
        if (pt.x > w + 20) pt.x = -20;
        if (pt.y < -20) pt.y = h + 20;
        if (pt.y > h + 20) pt.y = -20;
        pt.life += (0.5 - pt.life) * 0.02;
        const tw =
          0.12 +
          twinkleBase *
            (0.55 + 0.45 * Math.sin(t * 0.65 + pt.seed + ambient * 3 + pt.tw * 6 + pt.phase));
        const lit = 72 + (1 - minor) * 18 + brightness * 10;
        ctx.fillStyle = `hsla(${hb + (pt.seed % 17)}, ${62 + p.saturationBoost}%, ${lit}%, ${tw * (pt.r / 2.4)})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const scaleBH = Math.min(w, h);
      const stageCx = w * 0.5;
      /* 保证中心舞台完整可见：固定居中、只做轻微呼吸漂浮 */
      const stageCy = h * 0.56 + my * scaleBH * 0.002;
      /* 中央粒子环：按低频节拍规律摆动，强化“声音从中心扩散”的感觉 */
      const swarm = ensureSwarm(w, h);
      const ringBase = Math.min(w, h) * 0.19;
      const ringPulse = 1 + env * 0.44 + bassTransientRef.current * 0.28 + audioDrive * 0.28 + audioPulse * 0.22 + pulseStrength * 0.08;
      const ringSpin = t * (0.08 + p.waveSpeedMul * 0.02) + songProg * Math.PI * 1.2;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let si = 0; si < swarm.length; si++) {
        const pt = swarm[si]!;
        const ang = ringSpin + si * 0.28 + Math.sin(t * 0.22 + pt.seed) * 0.08;
        const wobble = Math.sin(t * 1.2 + si * 0.45 + env * 3.4) * (14 + env * 18);
        const targetX = stageCx + Math.cos(ang) * (ringBase + wobble * 0.08) + Math.sin(ang * 2.1) * ringPulse * 8;
        const targetY = stageCy + Math.sin(ang) * (ringBase * 0.56 + wobble * 0.05) + Math.cos(ang * 1.7) * ringPulse * 5;
        pt.vx += (targetX - pt.x) * 0.018;
        pt.vy += (targetY - pt.y) * 0.018;
        pt.vx *= 0.9;
        pt.vy *= 0.9;
        pt.x += pt.vx;
        pt.y += pt.vy;
        const blink = 0.28 + env * 0.55 + bassTransientRef.current * 0.34 + highEnergy * 0.1 + audioPulse * 0.12;
        const size = pt.size * (0.58 + blink);
        ctx.fillStyle = `hsla(${hb + pt.hueOffset}, ${72 + p.saturationBoost * 0.25}%, ${68 + brightness * 14}%, ${0.18 + blink * 0.24})`;
        if (!lite) {
          ctx.shadowBlur = 6 + blink * 14;
          ctx.shadowColor = `hsla(${hb + pt.hueOffset}, 92%, 72%, ${0.28 + blink * 0.35})`;
        }
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();

      const midY = h * 0.5;
      const liveAmp =
        (lively ? waveAmpMod + audioDrive * 0.42 + audioPulse * 0.28 : 0.62 + energy * 0.55) *
        waveProgressScale *
        (1 + vocal * 0.18) *
        (0.95 + motionComplexity * 0.28) *
        (1 + pulseStrength * 0.15 + highEnergy * 0.1) *
        (1 + stereoWideness * 0.06) *
        (1 + layerDensity * 0.08 + instrumentBias * 0.4);

      /* 主波浪：少量层 + 低频主导，避免多正弦叠加成「乱线团」 */
      const layerN = lite ? 2 : 3;
      const vbWave = visualBarsRef.current;
      const xStep = lite ? (w > 1440 ? 8 : 6) : w > 1440 ? 5 : 4;
      const smoothWaveBand = (idx: number) => {
        const a = vbWave[Math.max(0, idx - 2)] ?? 0;
        const b = vbWave[Math.max(0, idx - 1)] ?? 0;
        const c = vbWave[idx] ?? 0;
        const d = vbWave[Math.min(BAR_COUNT - 1, idx + 1)] ?? 0;
        const e = vbWave[Math.min(BAR_COUNT - 1, idx + 2)] ?? 0;
        return (a + 3 * b + 4 * c + 3 * d + e) / 12;
      };
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let layer = 0; layer < layerN; layer++) {
        ctx.beginPath();
        const amp =
          (18 + layer * 9 + env * 18 + bassTransientRef.current * 12) *
          (0.72 + liveAmp * 0.34) *
          p.waveAmpMul *
          (1 + bassWeight * 0.08);
        const k = 0.00275 + layer * 0.00062;
        const speed = (0.16 + layer * 0.045) * p.waveSpeedMul;
        const phase = t * speed + layer * 0.72 + wavePhaseKick;
        const bandMix = lively ? 0.2 + env * 0.2 + bassTransientRef.current * 0.14 : 0.06;
        for (let x = 0; x <= w + 2; x += xStep) {
          const xi = Math.min(BAR_COUNT - 1, Math.floor((x / w) * BAR_COUNT));
          const band = smoothWaveBand(xi);
          const sx = Math.sin((x / Math.max(1, w)) * Math.PI);
          const envelope = (0.78 + 0.22 * sx) * (0.38 + 0.62 * (1 - Math.pow(sx, 1.05)));
          const y =
            midY +
            amp * envelope * Math.sin(x * k + phase) +
            amp * 0.16 * Math.sin(x * k * 1.62 + phase * 0.72 + melodySway) +
            band * amp * bandMix * Math.sin(x * 0.0065 + phase * 0.86 + layer * 0.5);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const wh = hb + layer * 14 + minor * 5 + secondaryCount * 3;
        ctx.strokeStyle = `hsla(${wh}, ${62 + p.saturationBoost}%, ${56 - layer * 3 - minor * 3}%, ${0.1 + layer * 0.028 + energy * 0.035 + (lively ? env * 0.04 : 0)})`;
        ctx.lineWidth = 1.2 + layer * 0.28;
        ctx.shadowBlur = lite ? 2 + layer * 2 : 4 + layer * 2 + env * 4;
        ctx.shadowColor = `hsla(${wh}, 86%, 62%, ${0.16 + env * 0.12})`;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      /* 旋律轨迹：三条细弧线围绕中心做规律呼吸，增强“声音可见化” */
      {
        const orbPulse = 1 + env * 0.22 + bassTransientRef.current * 0.12 + audioDrive * 0.18;
        const arcBase = Math.min(w, h) * (0.15 + ambient * 0.03);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.lineCap = "round";
        for (let ai = 0; ai < 3; ai++) {
          const radius = arcBase + ai * 16 + Math.sin(t * 0.7 + ai) * 2.5;
          ctx.beginPath();
          const start = -Math.PI * 0.9 + ai * 0.3;
          const end = Math.PI * 0.9 - ai * 0.22;
          ctx.arc(stageCx, stageCy, radius * orbPulse, start, end);
          ctx.strokeStyle = `hsla(${hb + ai * 12}, ${62 + p.saturationBoost}%, ${58 + ai * 4}%, ${0.08 + env * 0.06 + ai * 0.015})`;
          ctx.lineWidth = 1.1 + ai * 0.18;
          ctx.shadowBlur = 9 + ai * 2;
          ctx.shadowColor = `hsla(${hb + ai * 12}, 88%, 66%, ${0.18 + env * 0.1})`;
          ctx.stroke();
        }
        ctx.restore();
      }

      /* —— 参考图：中央霓虹舞台（双环 + 上下径向冠 + 圆内示波 + 镜面倒影）—— */
      const spDraw = scopePtsRef.current;
      const vbStage = visualBarsRef.current;
      const R0 = scaleBH * (0.112 + energy * 0.018 + ambient * 0.017 + bassWeight * 0.01);
      const R_ring2 = R0 * 1.08;
      const R_inner = R0 * 0.68;
      const hueSpreadNeon = Math.min(56, p.hueSpread * 0.68 + highEnergy * 9);
      const radialMax = scaleBH * (0.098 + ambient * 0.07 + pulseStrength * 0.03);

      const drawRadialCrown = (alphaM: number) => {
        /* 上半圆：弱点缀，避免与 UI 顶栏抢视觉 */
        const nTop = lite ? 2 : 4;
        const topA0 = -Math.PI + 0.5;
        const topA1 = -0.5;
        for (let i = 0; i < nTop; i++) {
          const u = i / Math.max(1, nTop - 1);
          const ang = topA0 + u * (topA1 - topA0);
          const bin = Math.min(BAR_COUNT - 1, Math.floor(u * (BAR_COUNT * 0.35)));
          const val = vbStage[BAR_COUNT - 1 - bin] ?? 0;
          const len =
            radialMax * (0.12 + val * 0.42) * (lively ? 0.55 : 0.35) * (0.55 + alphaM * 0.45);
          const hx = neonHueAtX(stageCx + Math.cos(ang) * R0, w, hb, hueSpreadNeon);
          ctx.strokeStyle = `hsla(${hx}, 72%, 58%, ${(0.12 + val * 0.18) * alphaM})`;
          ctx.lineWidth = 1.1 + val * 0.9;
          ctx.beginPath();
          ctx.moveTo(stageCx + Math.cos(ang) * R0, stageCy + Math.sin(ang) * R0);
          ctx.lineTo(stageCx + Math.cos(ang) * (R0 + len), stageCy + Math.sin(ang) * (R0 + len));
          ctx.stroke();
        }
        /* 下半圆：短频谱齿 + 外缘弧光（替代粗长「水柱」径向条） */
        const nBot = lite ? 11 : 22;
        const botA0 = 0.34;
        const botA1 = Math.PI - 0.34;
        const lenScale = (lively ? 1.05 : 0.68) * (0.55 + alphaM * 0.45);
        for (let i = 0; i < nBot; i++) {
          const u = i / Math.max(1, nBot - 1);
          const ang = botA0 + u * (botA1 - botA0);
          const bin = Math.min(BAR_COUNT - 1, Math.floor(u * (BAR_COUNT - 1)));
          const val = vbStage[BAR_COUNT - 1 - bin] ?? 0;
          const len =
            radialMax *
            (0.11 + val * 0.68 + (lively ? bassTransientRef.current * 0.14 : 0)) *
            lenScale;
          const hx = neonHueAtX(stageCx + Math.cos(ang) * (R0 + len * 0.45), w, hb, hueSpreadNeon);
          const strokeA = (0.32 + val * 0.48) * alphaM;
          ctx.strokeStyle = `hsla(${hx}, 82%, 68%, ${strokeA})`;
          ctx.lineWidth = 1.15 + val * 1.45 + (lively ? audioPulse * 0.22 : 0);
          if (!lite) {
            ctx.shadowBlur = 5 + val * 14 + env * 3;
            ctx.shadowColor = `hsla(${hx + 6}, 92%, 72%, ${0.24 + val * 0.32})`;
          }
          const x0 = stageCx + Math.cos(ang) * R0;
          const y0 = stageCy + Math.sin(ang) * R0;
          const x1 = stageCx + Math.cos(ang) * (R0 + len);
          const y1 = stageCy + Math.sin(ang) * (R0 + len);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
          ctx.shadowBlur = 0;
          if (!lite && val > 0.18) {
            const capR = 1.25 + val * 2.6 + audioDrive * 0.45;
            const gCap = ctx.createRadialGradient(x1, y1, 0, x1, y1, capR * 1.9);
            gCap.addColorStop(0, `hsla(${hx + 10}, 92%, 82%, ${0.32 + val * 0.42})`);
            gCap.addColorStop(0.5, `hsla(${hx}, 80%, 62%, ${0.12 + val * 0.18})`);
            gCap.addColorStop(1, "transparent");
            ctx.fillStyle = gCap;
            ctx.beginPath();
            ctx.arc(x1, y1, capR * 1.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, R0 * 1.015, botA0, botA1);
        ctx.strokeStyle = `hsla(${hb + 6}, 80%, 66%, ${(0.14 + env * 0.16 + bassTransientRef.current * 0.22) * alphaM})`;
        ctx.lineWidth = 1.45 + bassTransientRef.current * 2.4;
        ctx.shadowBlur = lite ? 0 : 12 + env * 10 + bassTransientRef.current * 8;
        ctx.shadowColor = `hsla(${hb}, 92%, 72%, ${0.32 * alphaM})`;
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      drawRadialCrown(1);

      /* 环形能量波爆发：节拍越强，越像从核心向外冲击 */
      const chorusLift = 1 + Math.max(0, env - 0.38) * 0.9 + layerDensity * 0.22 + instrumentBias * 0.35;
      const ringBurst = (1 + env * 0.48 + bassTransientRef.current * 0.34 + pulseStrength * 0.16 + audioDrive * 0.28 + audioPulse * 0.2) * chorusLift;
      const ringTrail = 0.18 + env * 0.24 + bassTransientRef.current * 0.18 + layerDensity * 0.08 + audioDrive * 0.08 + audioPulse * 0.06;
      const ringBurstN = lite ? 2 : 4;
      for (let bi = 0; bi < ringBurstN; bi++) {
        const rr = R0 * (1.04 + bi * 0.15) * ringBurst;
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hb + bi * 10}, ${72 + p.saturationBoost * 0.25}%, ${68 - bi * 2}%, ${0.14 - bi * 0.012 + env * 0.15 + bassTransientRef.current * 0.16})`;
        ctx.lineWidth = 2.9 - bi * 0.25 + bassTransientRef.current * 0.6;
        ctx.shadowBlur = lite ? 6 + bi * 3 : 14 + bi * 5 + env * 14 + bassTransientRef.current * 10;
        ctx.shadowColor = `hsla(${hb + bi * 10}, 94%, 72%, ${0.42 + env * 0.22})`;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(stageCx, stageCy, rr * (1.04 + ringTrail * 0.18), 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hb + bi * 12}, 86%, 72%, ${0.05 + ringTrail * 0.14})`;
        ctx.lineWidth = 1.1;
        ctx.shadowBlur = 0;
        ctx.stroke();
      }

      ctx.shadowBlur = lite ? 6 + ambient * 6 : 10 + ambient * 10;
      ctx.shadowColor = `hsla(${hb}, 80%, 62%, 0.4)`;
      ctx.strokeStyle = `hsla(${hb}, 82%, 68%, ${0.55 + energy * 0.12})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(stageCx, stageCy, R0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `hsla(${hb + 18}, 78%, 72%, ${0.35 + ambient * 0.15})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(stageCx, stageCy, R_ring2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(stageCx, stageCy, R_inner * 0.94, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(3, 4, 18, 0.72)";
      ctx.fill();

      /* 中心脉冲核：跟低频包络同步呼吸，增强主视觉焦点 */
      {
        const corePulse = 1 + env * 0.28 + bassTransientRef.current * 0.26 + highEnergy * 0.08 + layerDensity * 0.12 + audioDrive * 0.28 + audioPulse * 0.14;
        const coreR = R_inner * (0.28 + corePulse * 0.06);
        const coreG = ctx.createRadialGradient(stageCx, stageCy, 0, stageCx, stageCy, coreR * 4.5);
        coreG.addColorStop(0, `hsla(${hb + 8}, 88%, 76%, ${0.55 + env * 0.18})`);
        coreG.addColorStop(0.28, `hsla(${hb + 18}, 84%, 64%, ${0.22 + ambient * 0.08})`);
        coreG.addColorStop(0.7, `hsla(${hb - 8}, 72%, 50%, ${0.08 + pulseStrength * 0.04})`);
        coreG.addColorStop(1, "transparent");
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = coreG;
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, coreR * 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 24 + env * 24;
        ctx.shadowColor = `hsla(${hb}, 92%, 70%, ${0.55 + env * 0.14})`;
        ctx.fillStyle = `hsla(${hb + 12}, 90%, 72%, ${0.24 + env * 0.22})`;
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, coreR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `hsla(${hb + 20}, 86%, 76%, ${0.45 + env * 0.2})`;
        ctx.lineWidth = 1.5 + env * 0.5;
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, coreR * 1.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(stageCx, stageCy, R_inner * 0.9, 0, Math.PI * 2);
      ctx.clip();
      const ampIn = R_inner * 0.38 * (1 + pulseStrength * 0.35 + ambient * 0.12);
      const xL = stageCx - R_inner * 0.86;
      const xR = stageCx + R_inner * 0.86;
      const stepIn = w > 1400 ? 3 : 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let x = xL; x <= xR; x += stepIn) {
        const rel = (x - xL) / Math.max(1, xR - xL);
        const fi = rel * (SCOPE_POINTS - 1);
        const i0 = Math.floor(fi);
        const i1 = Math.min(SCOPE_POINTS - 1, i0 + 1);
        const f = fi - i0;
        const v = spDraw[i0] * (1 - f) + spDraw[i1] * f;
        const y = stageCy + v * ampIn;
        if (x <= xL + 0.01) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const hxLine = neonHueAtX(stageCx, w, hb, hueSpreadNeon);
      ctx.strokeStyle = `hsla(${hxLine}, 82%, 74%, ${0.75 + ambient * 0.15})`;
      ctx.lineWidth = 2.2;
      ctx.shadowBlur = 10;
      ctx.shadowColor = `hsla(${hxLine}, 90%, 70%, 0.5)`;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      ctx.restore();

      const floorY = stageCy + R_ring2 + scaleBH * 0.04;
      ctx.save();
      ctx.translate(0, 2 * floorY);
      ctx.scale(1, -1);
      /* 镜面倒影极弱：下半圆已改为短齿，倒影略减避免糊底 */
      ctx.globalAlpha = 0.05 + ambient * 0.03 + audioDrive * 0.015;
      ctx.globalCompositeOperation = "lighter";
      drawRadialCrown(0.16);
      ctx.globalAlpha = 0.1 + audioDrive * 0.02;
      ctx.strokeStyle = `hsla(${hb + 10}, 70%, 62%, 0.18)`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(stageCx, stageCy, R0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      /* 底部：贴底细柱频谱 + 流光曲线（替代大块紫色「山峦」填充） */
      const visual = visualBarsRef.current;
      const spectrumY = h * (0.974 - energy * 0.004);
      const shelfDepth = h * (0.13 + energy * 0.09 + (lively ? ambient * 0.11 : 0) + highEnergy * 0.07 + audioDrive * 0.12 + audioPulse * 0.11);
      const hueSpreadBot = Math.min(52, p.hueSpread * 0.62 + highEnergy * 8);

      const smoothV = (idx: number) => {
        const a = visual[Math.max(0, idx - 1)] ?? 0;
        const b = visual[idx] ?? 0;
        const c = visual[Math.min(BAR_COUNT - 1, idx + 1)] ?? 0;
        return (a + 2 * b + c) / 4;
      };

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const barStep = lite ? 2 : 1;
      const colBoost = 0.96 + pulseStrength * 0.18 + bassTransientRef.current * 0.22;
      for (let i = 0; i < BAR_COUNT; i += barStep) {
        const vi = smoothV(i);
        const slice = w / BAR_COUNT;
        const x = i * slice + slice * 0.12;
        const bw = Math.max(1.1, slice * 0.62);
        const idleH =
          0.35 +
          0.65 *
            (0.5 + 0.5 * Math.sin(t * 1.1 + i * 0.07 + env * 1.8)) *
            (0.5 + 0.5 * Math.sin(t * 0.75 + i * 0.035));
        const hCol =
          shelfDepth *
          colBoost *
          (lively ? vi * (0.58 + env * 0.24) : vi * 0.24 + idleH * 0.16);
        if (hCol < 0.85) continue;
        const top = spectrumY - hCol;
        const cx = x + bw * 0.5;
        const hx = neonHueAtX(cx, w, hb, hueSpreadBot);
        const lg = ctx.createLinearGradient(x, spectrumY, x, top);
        lg.addColorStop(0, `hsla(${hx}, 76%, 58%, ${0.1 + vi * 0.18})`);
        lg.addColorStop(0.45, `hsla(${hx + 12}, 86%, 66%, ${0.14 + vi * 0.42})`);
        lg.addColorStop(1, `hsla(${hx + 24}, 74%, 52%, 0)`);
        ctx.fillStyle = lg;
        ctx.fillRect(x, top, bw, spectrumY - top);
        if (!lite && vi > 0.14) {
          ctx.shadowBlur = 5 + vi * 14 + bassTransientRef.current * 7;
          ctx.shadowColor = `hsla(${hx + 8}, 94%, 76%, ${0.32 + vi * 0.38})`;
          ctx.fillStyle = `hsla(${hx + 6}, 90%, 80%, ${0.16 + vi * 0.32})`;
          ctx.fillRect(x, top, bw, Math.max(2, (spectrumY - top) * 0.13));
          ctx.shadowBlur = 0;
        }
      }

      const nRib = lite ? 3 : 6;
      for (let r = 0; r < nRib; r++) {
        const yBaseR = spectrumY - shelfDepth * (0.26 + (r / nRib) * 0.54);
        ctx.beginPath();
        ctx.moveTo(-4, yBaseR);
        const xStride = w > 1400 ? 12 : 9;
        for (let x = 0; x <= w + 4; x += xStride) {
          const xi = Math.min(BAR_COUNT - 1, Math.floor((x / Math.max(1, w)) * BAR_COUNT));
          const vr = smoothV(xi);
          const wob =
            Math.sin(x * 0.013 + t * (1.12 + r * 0.26) + env * 2.6) * (2.2 + vr * 14 + bassTransientRef.current * 9);
          ctx.lineTo(x, yBaseR + wob);
        }
        ctx.strokeStyle = `hsla(${hb + r * 16 + bassTransientRef.current * 28}, 80%, 68%, ${0.075 + env * 0.055 + (lively ? ambient * 0.08 : 0.03)})`;
        ctx.lineWidth = 1.15 + r * 0.32;
        if (!lite) {
          ctx.shadowBlur = 4 + r * 2;
          ctx.shadowColor = `hsla(${hb + r * 20}, 92%, 70%, 0.35)`;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.strokeStyle = `hsla(${hb + 40}, 86%, 74%, ${0.2 + (lively ? ambient * 0.16 : 0.08) + bassTransientRef.current * 0.14})`;
      ctx.lineWidth = 1.35;
      ctx.shadowBlur = lite ? 0 : 12;
      ctx.shadowColor = `hsla(${hb + 32}, 94%, 70%, 0.48)`;
      ctx.beginPath();
      ctx.moveTo(0, spectrumY);
      ctx.lineTo(w, spectrumY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      /* 左中右三段式均衡器柱阵（全屏看背景时关闭，减轻叠线与 GPU） */
      if (!lite) {
        const zones = [
          { x0: w * 0.06, x1: w * 0.28, bins: [0, 10] as const, lift: 0.88 },
          { x0: w * 0.36, x1: w * 0.64, bins: [10, 32] as const, lift: 1.12 },
          { x0: w * 0.72, x1: w * 0.94, bins: [32, BAR_COUNT] as const, lift: 0.9 },
        ] as const;
        const chorusBoost = 1 + Math.max(0, env - 0.36) * 0.78 + bassTransientRef.current * 0.28 + pulseStrength * 0.14 + layerDensity * 0.1;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        for (const zone of zones) {
          const cols = zone.bins[1] - zone.bins[0];
          const step = (zone.x1 - zone.x0) / Math.max(1, cols);
          const spread = 1 + (zone.lift - 1) * 0.18 + chorusBoost * 0.05;
          const pull = (zone.x0 + zone.x1) * 0.5;
          for (let i = 0; i < cols; i++) {
            const idx = zone.bins[0] + i;
            const band = smoothV(idx);
            const beatLift = 0.42 + env * 0.56 + bassTransientRef.current * 0.18 + pulseStrength * 0.08;
            const swish = 1 + Math.sin(t * 0.85 + idx * 0.18 + env * 2.6) * 0.08 * chorusBoost;
            const height = shelfDepth * (0.1 + band * 0.78 * zone.lift * beatLift * swish);
            const centerShift = (i / Math.max(1, cols - 1) - 0.5) * step * 0.16 * (zone.lift - 0.8);
            const bx = zone.x0 + i * step + step * 0.18 + centerShift;
            const bw = Math.max(1.1, step * 0.62 * spread);
            const barTop = spectrumY - height;
            const barGrad = ctx.createLinearGradient(0, barTop, 0, spectrumY);
            barGrad.addColorStop(0, `hsla(${hb + i * 2}, 82%, 64%, ${0.1 + band * 0.24})`);
            barGrad.addColorStop(0.6, `hsla(${hb + i * 2 + 12}, 80%, 56%, ${0.09 + band * 0.16})`);
            barGrad.addColorStop(1, "transparent");
            const sway = 0.82 + 0.18 * Math.sin((idx / BAR_COUNT) * Math.PI * 2 + t * 0.55 + env * 3);
            ctx.globalAlpha = 0.88 + band * 0.08;
            ctx.fillStyle = barGrad;
            ctx.fillRect(bx, barTop, bw, spectrumY - barTop);
            ctx.shadowBlur = 6 + band * 14 + chorusBoost * 3 + bassTransientRef.current * 6;
            ctx.shadowColor = `hsla(${hb + idx * 1.5 + 20}, 94%, 74%, ${0.3 + band * 0.28})`;
            ctx.globalAlpha = sway;
            ctx.fillRect(bx, barTop, bw, spectrumY - barTop);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 0.45 + band * 0.28;
            ctx.fillStyle = `hsla(${hb + 48}, 90%, 78%, ${0.1 + band * 0.18})`;
            ctx.fillRect(bx + bw * 0.15, barTop, bw * 0.2, Math.max(2, (spectrumY - barTop) * 0.12));
            ctx.globalAlpha = 1;
          }
          const haloR = shelfDepth * (0.16 + zone.lift * 0.08) * chorusBoost;
          const haloCy = spectrumY - shelfDepth * 0.12;
          const halo = ctx.createRadialGradient(pull, haloCy, 0, pull, haloCy, haloR);
          halo.addColorStop(0, `hsla(${hb + zone.lift * 10}, 78%, 60%, ${0.1 + chorusBoost * 0.03})`);
          halo.addColorStop(0.6, `hsla(${hb + zone.lift * 14}, 70%, 50%, ${0.04 + chorusBoost * 0.02})`);
          halo.addColorStop(1, "transparent");
          ctx.globalAlpha = 1;
          ctx.fillStyle = halo;
          ctx.fillRect(zone.x0 - step, haloCy - haloR * 0.92, zone.x1 - zone.x0 + step * 2, haloR);
        }
        ctx.restore();
      }

      /* 全屏动态光：旋转光幕 + 四角呼吸 + 软侧幕 + 底带 */
      let bassSum = 0;
      for (let bi = 0; bi < 12; bi++) bassSum += visual[bi] ?? 0;
      const bassNorm = Math.min(1, bassSum / 12);
      const sweepAng = t * 0.2 + songProg * Math.PI * 1.4 + ambient * 0.35;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const gx = Math.cos(sweepAng) * w * 0.62;
      const gy = Math.sin(sweepAng) * h * 0.52;
      const sw = ctx.createLinearGradient(
        w * 0.5 - gx,
        h * 0.5 - gy,
        w * 0.5 + gx,
        h * 0.5 + gy,
      );
      sw.addColorStop(0, `hsla(${hb}, 70%, 56%, 0)`);
      sw.addColorStop(
        0.5,
        `hsla(${hb + 32 + bassNorm * 24}, 88%, 66%, ${0.055 + ambient * 0.092 + bassNorm * 0.13 + bassTransientRef.current * 0.08})`,
      );
      sw.addColorStop(1, `hsla(${hb - 20}, 68%, 50%, 0)`);
      ctx.fillStyle = sw;
      ctx.fillRect(0, 0, w, h);

      const sweepAng2 = -t * 0.14 + songProg * Math.PI * 0.9 + bassNorm * 0.5;
      const gx2 = Math.cos(sweepAng2) * w * 0.38;
      const gy2 = Math.sin(sweepAng2) * h * 0.36;
      const sw2 = ctx.createLinearGradient(
        w * 0.5 - gx2,
        h * 0.5 - gy2,
        w * 0.5 + gx2,
        h * 0.5 + gy2,
      );
      sw2.addColorStop(0, `hsla(${hb + 50}, 74%, 58%, 0)`);
      sw2.addColorStop(
        0.5,
        `hsla(${hb - 8 + bassNorm * 18}, 86%, 62%, ${0.028 + ambient * 0.055 + bassTransientRef.current * 0.06})`,
      );
      sw2.addColorStop(1, `hsla(${hb + 20}, 70%, 52%, 0)`);
      ctx.fillStyle = sw2;
      ctx.fillRect(0, 0, w, h);

      const cr = Math.min(w, h) * (0.54 + bassNorm * 0.22 + energy * 0.08 + audioDrive * 0.07 + audioPulse * 0.06);
      const corners: readonly [number, number][] = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ];
      for (let ci = 0; ci < 4; ci++) {
        const [cx, cy] = corners[ci]!;
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        const pulseC = 0.072 + bassNorm * 0.14 + ambient * 0.09 + bassTransientRef.current * 0.1;
        rg.addColorStop(0, `hsla(${hb + ci * 18}, 76%, 58%, ${pulseC})`);
        rg.addColorStop(0.42, `hsla(${hb + ci * 12 + 24}, 68%, 52%, ${pulseC * 0.4})`);
        rg.addColorStop(1, "transparent");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, h);
      }

      const curtainA = 0.03 + ambient * 0.048 + energy * 0.028 + audioDrive * 0.028 + audioPulse * 0.03;
      for (let side = 0; side < 2; side++) {
        const x0 = side === 0 ? -w * 0.12 : w * 0.48;
        const x1 = side === 0 ? w * 0.42 : w * 1.12;
        const cg = ctx.createLinearGradient(x0, 0, x1, 0);
        const breath = 0.75 + 0.25 * Math.sin(t * 0.65 + side * 1.7 + bassNorm * 3);
        cg.addColorStop(0, "transparent");
        cg.addColorStop(
          0.5,
          `hsla(${side === 0 ? hb - 12 : hb + 28}, 66%, 56%, ${curtainA * breath})`,
        );
        cg.addColorStop(1, "transparent");
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, w, h);
      }

      const bandH = h * (0.045 + bassNorm * 0.07 + ambient * 0.05);
      const bandGrad = ctx.createLinearGradient(0, h - bandH, 0, h);
      bandGrad.addColorStop(0, "transparent");
      bandGrad.addColorStop(
        0.55,
        `hsla(${hb + 8}, 72%, 54%, ${0.1 + (lively ? ambient * 0.14 : 0.04)})`,
      );
      bandGrad.addColorStop(1, `hsla(${hb - 6}, 65%, 42%, ${0.14 + bassNorm * 0.12})`);
      ctx.fillStyle = bandGrad;
      ctx.fillRect(0, h - bandH, w, bandH);

      if (!lite) {
        /* 细扫描线纹理（全屏背景模式关闭：竖线多且贵） */
        ctx.globalCompositeOperation = "overlay";
        const scanA = 0.048 + energy * 0.038 + bassTransientRef.current * 0.05;
        const scanStep = w > 1600 ? 12 : 9;
        for (let sx = 0; sx < w; sx += scanStep) {
          const bi = Math.min(BAR_COUNT - 1, Math.floor((sx / w) * BAR_COUNT));
          const sh = 0.18 + (visual[bi] ?? 0) * 0.52;
          ctx.fillStyle = `rgba(255,255,255,${scanA * sh})`;
          ctx.fillRect(sx, 0, 1, h);
        }
      }

      /* 全屏节拍冲击波：自舞台中心向外扩散的多层霓虹环 */
      {
        const pulseHubCx = stageCx;
        const pulseHubCy = stageCy + my * scaleBH * 0.008;
        const maxEchoR = Math.max(w, h) * 0.76;
        const nEcho = lite ? 4 : 10;
        for (let ei = 0; ei < nEcho; ei++) {
          const stagger = ei / Math.max(1, nEcho);
          const travel =
            (t * (0.24 + bassNorm * 0.16) + stagger * 0.94 + bassTransientRef.current * 0.55 + songProg * 0.18) % 1;
          const r = maxEchoR * (0.05 + travel * 0.98);
          const fade = (1 - travel) * (1 - travel);
          const a =
            fade *
            (0.032 +
              bassNorm * 0.07 +
              ambient * 0.048 +
              bassTransientRef.current * 0.2 +
              (lively ? audioPulse * 0.05 : 0));
          if (a < 0.0025) continue;
          ctx.beginPath();
          ctx.arc(pulseHubCx, pulseHubCy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${hb + 24 + ei * 9}, 90%, 68%, ${a})`;
          ctx.lineWidth = 1.35 + (1 - travel) * 5.5 + bassTransientRef.current * 4;
          if (!lite) {
            ctx.shadowBlur = 8 + (1 - travel) * 28;
            ctx.shadowColor = `hsla(${hb + 38}, 94%, 74%, ${a * 1.85})`;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      /* 横向能量掠影：kick 时偶发划过整屏，增强「现场感」 */
      if (!lite && lively) {
        const flash = bassTransientRef.current * 0.95 + Math.max(0, bassNorm - 0.42) * 0.52;
        if (flash > 0.12) {
          const yFlash = h * (0.12 + Math.abs(Math.sin(t * 2.8 + bassNorm * 4.2)) * 0.54);
          const gF = ctx.createLinearGradient(0, yFlash, w, yFlash);
          gF.addColorStop(0, "transparent");
          gF.addColorStop(0.42, `hsla(${hb + 44}, 94%, 78%, ${flash * 0.12})`);
          gF.addColorStop(0.58, `hsla(${hb + 6}, 88%, 62%, ${flash * 0.095})`);
          gF.addColorStop(1, "transparent");
          ctx.fillStyle = gF;
          ctx.fillRect(0, yFlash - 10, w, 32);
        }
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      const ringN = Math.min(
        lite ? 4 : 8,
        Math.max(lite ? 2 : 3, Math.round(RING_N * (0.75 + visualDensity * 0.5 + layerDensity * 0.1 + instrumentBias * 0.12 + audioPulse * 0.2))),
      );
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let ri = 0; ri < ringN; ri++) {
        const rr = Math.min(w, h) * (0.08 + ri * 0.055 + ambient * 0.06 * (1 + ri * 0.15));
        const pulse = 1 + 0.04 * Math.sin(t * 2.2 + ri * 0.9 + audioDrive * 1.4);
        const burst = 1 + env * 0.22 + bassTransientRef.current * 0.18 + audioDrive * 0.12;
        const binForRing = visual[Math.min(BAR_COUNT - 1, ri * 6 + 8)] ?? 0;
        const alpha = 0.042 + (lively ? ambient * 0.058 + audioDrive * 0.032 : 0.018) + energy * 0.028;
        const outer =
          rr *
          pulse *
          (1.02 + ri * 0.03) *
          burst *
          (1 + (lively ? binForRing * 0.22 : 0));
        const inner = outer * (0.88 - ri * 0.02);
        ctx.beginPath();
        ctx.ellipse(stageCx, stageCy + my * scaleBH * 0.004, outer, inner, t * 0.08 + ri * 0.2, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hb + ri * 10}, 72%, ${62 + brightness * 12}%, ${alpha})`;
        ctx.lineWidth = 1.2 + env * 0.52 + audioDrive * 0.24 + binForRing * 1.05;
        ctx.shadowBlur = lite ? 2 + ri : 6 + env * 8 + ri * 3 + audioDrive * 8;
        ctx.shadowColor = `hsla(${hb + ri * 10}, 90%, 72%, ${0.24 + alpha * 3.2})`;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      /* 自中心辐射短线（高频能量驱动，暗示 AI 解析场） */
      ctx.save();
      ctx.translate(stageCx, stageCy + R_ring2 * 0.08);
      const nRay = lite ? 8 : 18;
      const hiBin = Math.min(BAR_COUNT - 1, Math.floor(BAR_COUNT * 0.72));
      const hiE = visual[hiBin] ?? 0;
      const midE = visual[Math.floor(BAR_COUNT * 0.45)] ?? 0;
      ctx.globalCompositeOperation = "lighter";
      for (let ri = 0; ri < nRay; ri++) {
        const ang = (ri / nRay) * Math.PI * 2 + t * 0.14 + songProg * 0.75;
        const binPick = Math.min(BAR_COUNT - 1, Math.floor((ri / Math.max(1, nRay - 1)) * (BAR_COUNT - 1)));
        const rayE = visual[binPick] ?? hiE;
        const rLen =
          Math.min(w, h) * (0.062 + rayE * 0.2 + midE * 0.055 + pulseStrength * 0.055);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * rLen, Math.sin(ang) * rLen);
        ctx.strokeStyle = `hsla(${hb + ri * 14}, 76%, 66%, ${0.048 + rayE * 0.16 + ambient * 0.055})`;
        ctx.lineWidth = 1.1 + rayE * 1.15;
        if (!lite) {
          ctx.shadowBlur = 4 + rayE * 10;
          ctx.shadowColor = `hsla(${hb + ri * 14}, 92%, 72%, ${0.22 + rayE * 0.25})`;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

      /* —— Agent 处理层：六边形场、径向数据脉冲、轨道节点与 HUD 角标（叠在辐射线之上）—— */
      {
        const hasIntent = Boolean(aiIntentRef.current);
        const agentBoost =
          (hasIntent ? 0.42 : 0) +
          (composeActive ? 0.38 : 0) +
          (lively ? env * 0.48 + bassTransientRef.current * 0.42 + ambient * 0.22 : 0.06);
        const alphaBase = 0.045 + Math.min(0.36, agentBoost * 0.58);
        const mc = motionComplexity;

        ctx.save();
        ctx.translate(stageCx, stageCy);
        ctx.globalCompositeOperation = "screen";

        const spacing = scaleBH * 0.034 * (0.92 + mc * 0.12);
        const hexCols = lite ? 5 : 9;
        const hexRows = lite ? 5 : 9;
        const hexMaxD = scaleBH * 0.44;
        for (let col = -hexCols; col <= hexCols; col++) {
          for (let row = -hexRows; row <= hexRows; row++) {
            const x = spacing * Math.sqrt(3) * (col + row * 0.5);
            const y = spacing * 1.5 * row;
            const dist = Math.hypot(x, y);
            if (dist > hexMaxD) continue;
            const bi = Math.max(
              0,
              Math.min(
                BAR_COUNT - 1,
                Math.floor(((dist / hexMaxD) * 0.85 + (col + row) * 0.02 + 0.5) * 0.25 * BAR_COUNT),
              ),
            );
            const vh = visual[bi] ?? 0;
            const pulseHex =
              0.5 +
              0.5 *
                Math.sin(t * (1.05 + mc * 0.35) + dist * 0.021 + vh * 3.8 + songProg * Math.PI);
            ctx.globalAlpha =
              alphaBase *
              (0.28 + pulseHex * 0.72) *
              (1 - dist / (hexMaxD * 1.08)) *
              (0.75 + layerDensity * 0.25);
            ctx.strokeStyle = `hsla(${hb + 14 + col * 2}, 72%, 58%, 0.55)`;
            ctx.lineWidth = 0.75 + vh * 0.45;
            const rHex = spacing * 0.5;
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2;
              const px = x + rHex * Math.cos(a);
              const py = y + rHex * Math.sin(a);
              if (k === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;

        const nPacket = lite ? 10 : 20;
        for (let pi = 0; pi < nPacket; pi++) {
          const ang = (pi / nPacket) * Math.PI * 2 + t * (lively ? 0.12 : 0.035) + songProg * 1.1;
          const binP =
            visual[Math.min(BAR_COUNT - 1, Math.floor((pi / Math.max(1, nPacket - 1)) * (BAR_COUNT - 1)))] ?? 0;
          const phase = (t * (0.52 + binP * 0.85 + mc * 0.12) + pi * 0.29 + songProg * 2.4) % 1;
          const r0 = R_ring2 * 1.02 + phase * scaleBH * (0.12 + binP * 0.14 + mc * 0.04);
          const r1 = r0 + scaleBH * (0.016 + binP * 0.036 + pulseStrength * 0.012);
          ctx.strokeStyle = `hsla(${hb + pi * 10 + 32}, 84%, 66%, ${alphaBase * (0.55 + binP * 1.15)})`;
          ctx.lineWidth = 1.25 + binP * 1.6;
          if (!lite) {
            ctx.shadowBlur = 6 + binP * 12;
            ctx.shadowColor = `hsla(${hb + 32}, 90%, 62%, 0.42)`;
          }
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
          ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }

        const nSat = lite ? 4 : 8;
        for (let si = 0; si < nSat; si++) {
          const ta = t * (0.32 + mc * 0.22) + si * 0.82 + songProg * 2.4;
          const rad = R0 * (1.48 + (si % 3) * 0.14) + Math.sin(t * 0.75 + si * 1.1) * scaleBH * 0.016;
          const sx = Math.cos(ta) * rad;
          const sy = Math.sin(ta) * rad * 0.84;
          const linkA = (lively ? 0.06 + env * 0.14 + bassTransientRef.current * 0.1 : 0.025) * (hasIntent ? 1.25 : 0.85);
          ctx.strokeStyle = `hsla(${hb + si * 18 + 8}, 70%, 60%, ${linkA})`;
          ctx.setLineDash([2, 4]);
          ctx.lineWidth = 0.85;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          ctx.setLineDash([]);
          const nodeA = Math.min(0.95, alphaBase * (1.05 + (visual[(si * 5) % BAR_COUNT] ?? 0) * 1.2));
          const gSat = ctx.createRadialGradient(sx, sy, 0, sx, sy, scaleBH * 0.032);
          gSat.addColorStop(0, `hsla(${hb + 48 + si * 6}, 90%, 74%, ${0.28 + nodeA * 0.45})`);
          gSat.addColorStop(0.55, `hsla(${hb + 32 + si * 8}, 78%, 58%, ${0.08 + nodeA * 0.2})`);
          gSat.addColorStop(1, "transparent");
          ctx.fillStyle = gSat;
          ctx.beginPath();
          ctx.arc(sx, sy, scaleBH * 0.017, 0, Math.PI * 2);
          ctx.fill();
        }

        const hudR = R_ring2 * 2.42 + ambient * scaleBH * 0.045 + mc * scaleBH * 0.012;
        const tick = 16 + mc * 14 + visualDensity * 8;
        ctx.strokeStyle = `hsla(${hb + 36}, 76%, 62%, ${alphaBase * 1.05})`;
        ctx.lineWidth = 1.2;
        const cornersHud: readonly [number, number, number, number][] = [
          [-hudR, -hudR, 1, 1],
          [hudR, -hudR, -1, 1],
          [-hudR, hudR, 1, -1],
          [hudR, hudR, -1, -1],
        ];
        for (const [cx, cy, sx, sy] of cornersHud) {
          ctx.beginPath();
          ctx.moveTo(cx, cy + sy * tick);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx - sx * tick, cy);
          ctx.stroke();
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
      }

      /* 单条远景波：压低且避开水平中线舞台带，减少「糊住」主舞台 */
      {
        const yLine = h * 0.84;
        const ampE =
          (7 + ambient * 7) *
          liveAmp *
          p.waveAmpMul *
          0.32 *
          (1 + atmosphere * 0.12);
        const kE = 0.0034;
        const speedE = 0.14 * p.waveSpeedMul;
        ctx.beginPath();
        for (let x = 0; x <= w + 4; x += lite ? 10 : 6) {
          const vbE = visual[Math.min(BAR_COUNT - 1, Math.floor((x / w) * BAR_COUNT))] ?? 0;
          const xc = Math.abs(x / Math.max(1, w) - 0.5) * 2;
          const centerDip = 0.28 + 0.72 * xc * xc;
          const y =
            yLine +
            ampE * centerDip * Math.sin(x * kE + t * speedE) +
            (lively ? vbE * 4.2 * centerDip * Math.sin(x * 0.012 + t * 0.7) : 0);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${hb + 16}, ${48 + p.saturationBoost}%, 46%, ${0.032 + energy * 0.022 + (lively ? ambient * 0.03 : 0)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      /* 四边全屏氛围：侧幕光柱 + 角锥射线 + 底/顶微粒子（顶边极弱，避免抢播放器） */
      if (!lite) {
        const edgeBoost = 0.38 + (lively ? ambient * 0.5 + env * 0.28 : 0.15) + bassTransientRef.current * 0.22;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const pad = Math.min(w, h) * 0.04;
        for (let side = 0; side < 2; side++) {
          const gw = pad * 2.2;
          const gSide = ctx.createLinearGradient(
            side === 0 ? 0 : w,
            0,
            side === 0 ? gw * 1.4 : w - gw * 1.4,
            0,
          );
          gSide.addColorStop(0, `hsla(${side === 0 ? hb - 14 : hb + 32}, 78%, 58%, ${0.14 * edgeBoost})`);
          gSide.addColorStop(0.45, `hsla(${hb + 20}, 72%, 52%, ${0.06 * edgeBoost})`);
          gSide.addColorStop(1, "transparent");
          ctx.fillStyle = gSide;
          ctx.fillRect(side === 0 ? 0 : w - gw * 1.4, 0, gw * 1.4, h);
          const nSpine = 11;
          for (let si = 0; si < nSpine; si++) {
            const ty = h * (0.12 + (si / (nSpine - 1)) * 0.76);
            const bin = Math.min(
              BAR_COUNT - 1,
              side === 0 ? Math.floor((si / nSpine) * BAR_COUNT * 0.5) : Math.floor(BAR_COUNT * 0.5 + (si / nSpine) * BAR_COUNT * 0.5),
            );
            const val = visual[bin] ?? 0;
            const len = (22 + val * 52 * edgeBoost) * (side === 0 ? 1 : -1);
            const hx = neonHueAtX(ty, h, hb, 44);
            ctx.strokeStyle = `hsla(${hx}, 82%, 66%, ${0.07 + val * 0.2 * edgeBoost})`;
            ctx.lineWidth = 1.2 + val * 1.8;
            ctx.shadowBlur = 6 + val * 10;
            ctx.shadowColor = `hsla(${hx + 8}, 90%, 70%, ${0.2 + val * 0.25})`;
            ctx.beginPath();
            ctx.moveTo(side === 0 ? 8 : w - 8, ty);
            ctx.lineTo(side === 0 ? 8 + len : w - 8 + len, ty);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        }
        const cornersXY: readonly [number, number][] = [
          [pad * 0.3, pad * 0.3],
          [w - pad * 0.3, pad * 0.3],
          [pad * 0.3, h - pad * 0.3],
          [w - pad * 0.3, h - pad * 0.3],
        ];
        const aimCx = stageCx;
        const aimCy = stageCy;
        for (let ci = 0; ci < 4; ci++) {
          const [cx, cy] = cornersXY[ci]!;
          const toMid = Math.atan2(aimCy - cy, aimCx - cx);
          const nRay = 9;
          for (let ri = 0; ri < nRay; ri++) {
            const spread = (ri / (nRay - 1) - 0.5) * 0.62;
            const ang = toMid + spread + Math.sin(t * 0.45 + ci * 1.1 + ri * 0.35) * 0.06;
            const reach = Math.min(w, h) * (0.2 + edgeBoost * 0.22);
            const bin = visual[(ci * 7 + ri * 3) % BAR_COUNT] ?? 0;
            ctx.strokeStyle = `hsla(${hb + ci * 16 + ri * 5}, 80%, 64%, ${0.048 + bin * 0.14 * edgeBoost})`;
            ctx.lineWidth = 1.15 + bin * 1;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(ang) * reach, cy + Math.sin(ang) * reach);
            ctx.stroke();
          }
        }
        const bottomSparkN = 28;
        for (let si = 0; si < bottomSparkN; si++) {
          const sx = (si / bottomSparkN) * w;
          const bin = Math.min(BAR_COUNT - 1, Math.floor((si / bottomSparkN) * BAR_COUNT));
          const val = visual[bin] ?? 0;
          const sy = h - 4 - val * 18 * edgeBoost;
          ctx.fillStyle = `hsla(${hb + (si % 9) * 4}, 88%, 74%, ${0.08 + val * 0.22})`;
          ctx.beginPath();
          ctx.arc(sx + Math.sin(t * 1.2 + si) * 2, sy, 0.9 + val * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        const topSparkN = 10;
        for (let ti = 0; ti < topSparkN; ti++) {
          const tx = (ti / (topSparkN - 1)) * w * 0.5 + w * 0.25;
          const val = visual[(ti * 5) % BAR_COUNT] ?? 0;
          ctx.fillStyle = `hsla(${hb + 50}, 70%, 72%, ${0.03 + val * 0.06})`;
          ctx.beginPath();
          ctx.arc(tx + Math.sin(t * 0.9 + ti) * 6, 6 + (ti % 3) * 5, 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
      }

      /* 舞台外圈「二次提亮」：叠在氛围层之上，锁死视觉焦点 */
      {
        const ringPulseOut = 1 + env * 0.08 + bassTransientRef.current * 0.1;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `hsla(${hb + 6}, 88%, 74%, ${0.38 + energy * 0.1})`;
        ctx.lineWidth = 2.2;
        ctx.shadowBlur = lite ? 4 : 14 + env * 10;
        ctx.shadowColor = `hsla(${hb}, 92%, 70%, 0.55)`;
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, R0 * ringPulseOut, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `hsla(${hb + 22}, 82%, 70%, ${0.22 + ambient * 0.12})`;
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        ctx.arc(stageCx, stageCy, R_ring2 * ringPulseOut, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
      }
      if (captionRailsActiveRef.current) {
        const nTicks = lite ? 16 : 26;
        const edgeBoost = 0.42 + (lively ? ambient * 0.55 + env * 0.35 : 0.18);
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        for (let side = 0; side < 2; side++) {
          const x0 = side === 0 ? 10 : w - 10;
          for (let i = 0; i < nTicks; i++) {
            const ty = h * (0.14 + (i / Math.max(1, nTicks - 1)) * 0.72);
            const bin = Math.min(
              BAR_COUNT - 1,
              side === 0 ? Math.floor((i / nTicks) * BAR_COUNT * 0.45) : Math.floor(BAR_COUNT * 0.55 + (i / nTicks) * BAR_COUNT * 0.45),
            );
            const val = visual[bin] ?? 0;
            const len = (12 + val * 36 * edgeBoost) * (side === 0 ? 1 : -1);
            const hx = neonHueAtX(ty, h, hb, Math.min(48, p.hueSpread * 0.5));
            ctx.strokeStyle = `hsla(${hx}, 76%, 62%, ${0.06 + val * 0.14 * edgeBoost})`;
            ctx.lineWidth = 1.1 + val * 1.2;
            ctx.beginPath();
            ctx.moveTo(x0, ty);
            ctx.lineTo(x0 + len, ty);
            ctx.stroke();
          }
        }
        const span = w * 0.22;
        for (let top = 0; top < 2; top++) {
          const y0 = top === 0 ? h * 0.1 : h * 0.9;
          const nH = lite ? 10 : 16;
          for (let j = 0; j < nH; j++) {
            const tx = w * 0.5 + (j / (nH - 1) - 0.5) * span * 2;
            const bin = Math.min(BAR_COUNT - 1, Math.floor((j / nH) * BAR_COUNT));
            const val = visual[bin] ?? 0;
            const dy = (5 + val * 16 * edgeBoost) * (top === 0 ? 1 : -1);
            const hx = neonHueAtX(tx, w, hb, 40);
            ctx.strokeStyle = `hsla(${hx + 8}, 72%, 58%, ${0.045 + val * 0.1 * edgeBoost})`;
            ctx.lineWidth = 1 + val * 0.9;
            ctx.beginPath();
            ctx.moveTo(tx, y0);
            ctx.lineTo(tx, y0 + dy);
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
      }

      /**
       * 四角流动柔光斑：与全屏 CSS 氛围层呼应，仅在非 lite 且试听/创作面活跃时绘制。
       */
      if (!lite && surfaceActive) {
        const nSpot = Math.min(6, 3 + Math.round(layerDensity * 4));
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        for (let s = 0; s < nSpot; s++) {
          const ang = (s / Math.max(1, nSpot)) * Math.PI * 2 + t * 0.35 + s * 0.7;
          const px = w * (0.05 + 0.9 * (0.5 + 0.42 * Math.cos(ang)));
          const py = h * (0.06 + 0.88 * (0.5 + 0.4 * Math.sin(ang * 1.07 + t * 0.2)));
          const rSpot = Math.min(w, h) * (0.06 + layerDensity * 0.04 + env * 0.03);
          const grd = ctx.createRadialGradient(px, py, 0, px, py, rSpot);
          const hu = hb + s * 20 + p.hueSpread * 0.12 * (s % 3);
          grd.addColorStop(0, `hsla(${hu}, 82%, 68%, ${0.035 + energy * 0.055 + ambient * 0.04})`);
          grd.addColorStop(1, "transparent");
          ctx.fillStyle = grd;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [composeActive, audioElement, playbackSurfaceActive, captionRailsActive]);

  useEffect(() => {
    return () => {
      const g = graphRef.current;
      if (!g) return;
      try {
        for (const src of g.sources.values()) {
          src.disconnect();
        }
        g.sources.clear();
        g.ctx.close();
      } catch {
        /* ignore */
      }
      graphRef.current = null;
    };
  }, []);

  if (prefersReducedMotion()) {
    return (
      <div
        className="rhythm-bg-fallback"
        aria-hidden="true"
      />
    );
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="rhythm-bg-canvas"
        aria-hidden="true"
      />
      <div className="rhythm-bg-hint" aria-hidden="true">
        FFT 频谱 + 意图调色；全屏响应网格；底缘流光与细柱；中心短齿径向冠；Agent：六边形场 / 径向脉冲 / HUD
      </div>
    </>
  );
}
