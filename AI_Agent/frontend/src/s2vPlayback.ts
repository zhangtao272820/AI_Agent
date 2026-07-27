/**
 * wan s2v 播放：优先使用 MP4 内嵌音轨（与口型同源）；
 * 无外置音轨时再以外置 TTS 为主时钟并校正视频。
 */

export type SyncedS2vSession = {
  stop: () => void;
};

function waitCanPlay(el: HTMLMediaElement, timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      el.removeEventListener("canplaythrough", onReady);
      reject(new Error("媒体加载超时"));
    }, timeoutMs);
    const onReady = () => {
      window.clearTimeout(timer);
      el.removeEventListener("canplaythrough", onReady);
      resolve();
    };
    el.addEventListener("canplaythrough", onReady);
  });
}

/** 口型视频内已 mux 驱动音频，直接播放即可对齐。 */
export async function playEmbeddedS2v(
  video: HTMLVideoElement,
  onEnded: () => void,
): Promise<SyncedS2vSession> {
  video.loop = false;
  video.muted = false;
  video.playbackRate = 1;
  video.currentTime = 0;

  await waitCanPlay(video);
  let ended = false;
  video.onended = () => {
    if (ended) return;
    ended = true;
    onEnded();
  };

  await video.play();

  return {
    stop: () => {
      video.onended = null;
      video.pause();
    },
  };
}

/** 外置 TTS 为主时钟，按音轨时长微调视频倍速并逐帧对齐 currentTime。 */
export async function playDualTrackS2v(
  video: HTMLVideoElement,
  audio: HTMLAudioElement,
  onEnded: () => void,
): Promise<SyncedS2vSession> {
  video.loop = false;
  video.muted = true;
  video.playbackRate = 1;
  audio.preload = "auto";
  audio.currentTime = 0;
  video.currentTime = 0;

  await Promise.all([waitCanPlay(video), waitCanPlay(audio)]);

  const ad = audio.duration;
  const vd = video.duration;
  if (vd > 0 && ad > 0 && Math.abs(vd - ad) > 0.08) {
    video.playbackRate = Math.min(2, Math.max(0.75, vd / ad));
  }

  let cancelled = false;
  let raf = 0;

  const stop = () => {
    cancelled = true;
    if (raf) cancelAnimationFrame(raf);
    video.onended = null;
    audio.onended = null;
    video.pause();
    audio.pause();
  };

  const syncLoop = () => {
    if (cancelled || audio.paused) return;
    const t = audio.currentTime;
    if (Math.abs(video.currentTime - t) > 0.04) {
      try {
        video.currentTime = t;
      } catch {
        /* ignore seek errors */
      }
    }
    raf = requestAnimationFrame(syncLoop);
  };

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    stop();
    onEnded();
  };
  audio.onended = finish;
  video.onended = () => {
    if (audio.currentTime < ad - 0.2) return;
    finish();
  };

  await Promise.all([video.play(), audio.play()]);
  raf = requestAnimationFrame(syncLoop);

  return { stop };
}

/**
 * 有外置 TTS 时一律双轨同步（避免 MP4 无内嵌音轨导致无声）；
 * 无外置 TTS 时再尝试 MP4 内嵌音轨。
 */
export async function playSyncedS2v(
  video: HTMLVideoElement,
  opts: { ttsBlobUrl?: string; legacyCache?: boolean; onEnded: () => void },
): Promise<SyncedS2vSession> {
  const { ttsBlobUrl, onEnded } = opts;

  video.loop = false;
  video.removeAttribute("loop");

  if (ttsBlobUrl) {
    const audio = new Audio(ttsBlobUrl);
    return playDualTrackS2v(video, audio, onEnded);
  }

  return playEmbeddedS2v(video, onEnded);
}
