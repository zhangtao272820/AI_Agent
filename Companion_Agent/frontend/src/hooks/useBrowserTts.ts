import { useCallback, useRef, useState } from "react";

function pickZhVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const prefer = voices.find((v) => v.lang.startsWith("zh") && /女|female|xiaoxiao|xiaoyi/i.test(v.name));
  if (prefer) return prefer;
  return voices.find((v) => v.lang.startsWith("zh")) ?? voices[0] ?? null;
}

export function useBrowserTts() {
  const [speaking, setSpeaking] = useState(false);
  const [mouthLevel, setMouthLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const genRef = useRef(0);

  const stop = useCallback(() => {
    genRef.current += 1;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    setMouthLevel(0);
  }, []);

  const speak = useCallback(
    (text: string): Promise<string | null> => {
      const spoken = text.trim();
      if (!spoken) return Promise.resolve("朗读文本为空");
      if (!window.speechSynthesis) return Promise.resolve("浏览器不支持语音合成");

      stop();
      const myGen = genRef.current;

      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(spoken);
        utter.lang = "zh-CN";
        utter.rate = 1.02;
        utter.pitch = 1.05;
        const voice = pickZhVoice();
        if (voice) utter.voice = voice;

        const tick = () => {
          if (genRef.current !== myGen) return;
          const t = Date.now() / 120;
          setMouthLevel(0.35 + Math.abs(Math.sin(t)) * 0.45);
          rafRef.current = requestAnimationFrame(tick);
        };

        utter.onstart = () => {
          if (genRef.current !== myGen) return;
          setSpeaking(true);
          tick();
        };
        utter.onend = () => {
          if (genRef.current !== myGen) return;
          stop();
          resolve(null);
        };
        utter.onerror = () => {
          if (genRef.current !== myGen) return;
          stop();
          resolve("浏览器朗读失败");
        };

        window.speechSynthesis.speak(utter);
      });
    },
    [stop],
  );

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  return { speak, stop, speaking, mouthLevel, supported };
}
