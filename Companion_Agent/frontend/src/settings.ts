/** Client-side game settings (localStorage). */

export type DisplayMode = "windowed" | "fullscreen";
export type SpriteStyleSetting = "anime" | "photoreal";

export type GameSettings = {
  ttsEnabled: boolean;
  ttsVolume: number; // 0–1
  bgmEnabled: boolean;
  bgmVolume: number; // 0–1
  softTips: boolean;
  reducedMotion: boolean;
  /** Desktop exe: windowed (default) or fullscreen */
  displayMode: DisplayMode;
  /** 对话舞台：二次元全身（默认）或真人化 menu_*；名牌始终 Q 头 */
  spriteStyle: SpriteStyleSetting;
};

const KEY = "companion.game_settings.v3";
const LEGACY_KEYS = ["companion.game_settings.v2", "companion.game_settings.v1"];

const DEFAULTS: GameSettings = {
  ttsEnabled: true,
  ttsVolume: 0.85,
  bgmEnabled: true,
  bgmVolume: 0.88,
  /** 关=选项为主（美德式）；开=引导提示 + 对话始终显示输入框 */
  softTips: false,
  reducedMotion: false,
  displayMode: "windowed",
  spriteStyle: "anime",
};

export function loadSettings(): GameSettings {
  try {
    let raw = localStorage.getItem(KEY);
    let fromLegacy = false;
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        raw = localStorage.getItem(k);
        if (raw) {
          fromLegacy = true;
          break;
        }
      }
    }
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const mode =
      parsed.displayMode === "fullscreen" || parsed.displayMode === "windowed"
        ? parsed.displayMode
        : DEFAULTS.displayMode;
    // 旧档音量偏小（默认 0.55）：升到新默认，避免「听不清」
    let bgmVolume = clamp01(parsed.bgmVolume ?? DEFAULTS.bgmVolume);
    if (fromLegacy && bgmVolume < 0.7) {
      bgmVolume = DEFAULTS.bgmVolume;
    }
    const spriteStyle: SpriteStyleSetting =
      parsed.spriteStyle === "photoreal" || parsed.spriteStyle === "anime"
        ? parsed.spriteStyle
        : DEFAULTS.spriteStyle;
    const next: GameSettings = {
      ttsEnabled: parsed.ttsEnabled ?? DEFAULTS.ttsEnabled,
      ttsVolume: clamp01(parsed.ttsVolume ?? DEFAULTS.ttsVolume),
      bgmEnabled: parsed.bgmEnabled ?? DEFAULTS.bgmEnabled,
      bgmVolume,
      softTips: parsed.softTips ?? DEFAULTS.softTips,
      reducedMotion: parsed.reducedMotion ?? DEFAULTS.reducedMotion,
      displayMode: mode,
      spriteStyle,
    };
    if (fromLegacy) {
      localStorage.setItem(KEY, JSON.stringify(next));
    }
    return next;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: GameSettings): void {
  localStorage.setItem(KEY, JSON.stringify(next));
  applySettingsToDom(next);
}

export function applySettingsToDom(s: GameSettings): void {
  document.documentElement.dataset.reducedMotion = s.reducedMotion ? "1" : "0";
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return DEFAULTS.ttsVolume;
  return Math.max(0, Math.min(1, n));
}
