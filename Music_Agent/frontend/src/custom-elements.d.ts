import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "midi-player": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          visualizer?: string;
          /** 空字符串或 URL：启用 Magenta SoundFont（GM 采样），否则为简易振荡器 */
          "sound-font"?: string;
        },
        HTMLElement
      >;
      "midi-visualizer": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          type?: string;
          id?: string;
        },
        HTMLElement
      >;
    }
  }
}

export {};
