/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * 可选：直连 SoundFont 根 URL（覆盖默认「同源 /api/soundfont/sgm_plus」）。
   * 一般留空即可，由后端转发并走国内镜像。
   */
  readonly VITE_MIDI_SOUNDFONT_URL?: string;
}
