import { useCallback, useRef, useState } from "react";

export function useTtsPlayer() {
  const [mouthLevel, setMouthLevel] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const playGenRef = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const a = audioRef.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.removeAttribute("src");
      a.load();
      audioRef.current = null;
    }
    setPlaying(false);
    setMouthLevel(0);
  }, []);

  const play = useCallback(
    async (base64: string, mime = "audio/wav", volume = 1): Promise<string | null> => {
      if (!base64?.trim()) return "语音数据为空";

      const gen = ++playGenRef.current;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;

      const prev = audioRef.current;
      if (prev) {
        prev.onended = null;
        prev.onerror = null;
        prev.pause();
        prev.removeAttribute("src");
        prev.load();
        audioRef.current = null;
      }

      try {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.src = url;
        audio.volume = Math.max(0, Math.min(1, volume));
        audioRef.current = audio;

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = ctxRef.current ?? new AudioCtx();
        ctxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume();

        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (playGenRef.current !== gen) return;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length / 255;
          setMouthLevel(Math.min(1, avg * 2.2 + 0.15));
          rafRef.current = requestAnimationFrame(tick);
        };

        await new Promise<void>((resolve, reject) => {
          audio.oncanplaythrough = () => resolve();
          audio.onerror = () => reject(new Error("音频加载失败"));
          audio.load();
        });

        if (playGenRef.current !== gen) {
          URL.revokeObjectURL(url);
          return null;
        }

        setPlaying(true);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (playGenRef.current === gen) stop();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          if (playGenRef.current === gen) stop();
        };

        await audio.play();
        tick();
        return null;
      } catch (ex) {
        if (playGenRef.current === gen) stop();
        return ex instanceof Error ? ex.message : "语音播放失败";
      }
    },
    [stop],
  );

  return { play, stop, playing, mouthLevel };
}
