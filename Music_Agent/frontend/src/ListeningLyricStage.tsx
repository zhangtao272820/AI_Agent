import { useMemo } from "react";

/** 单条时间轴文案（Whisper 分片或 Omni 意象句） */
export type LyricTimelineLine = {
  start: number;
  end: number;
  text: string;
};

export type ListeningCaptionsLite = {
  top: string;
  right: string;
  bottom: string;
  left: string;
  footnote?: string;
};

/**
 * 将 Omni 返回的相对时间轴拉伸到整曲时长（片头截取时常用）。
 */
function scaleTimelineToDuration(lines: LyricTimelineLine[], fullDur: number): LyricTimelineLine[] {
  if (!lines.length || fullDur <= 0) return lines;
  const mx = Math.max(...lines.map((l) => l.end));
  if (mx <= 0) return lines;
  if (mx >= fullDur * 0.88) return lines;
  const k = fullDur / mx;
  return lines.map((l) => ({
    start: Math.max(0, l.start * k),
    end: Math.min(fullDur, l.end * k),
    text: l.text,
  }));
}

/**
 * 无分句时间轴时，把四边听感拆句并按时长均分，形成伪同步。
 */
function pseudoTimelineFromCaptions(caps: ListeningCaptionsLite, fullDur: number): LyricTimelineLine[] {
  if (fullDur <= 0) return [];
  const blob = [caps.top, caps.right, caps.bottom, caps.left].filter(Boolean).join("。");
  const parts = blob
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  if (!parts.length) return [];
  const slice = fullDur / parts.length;
  return parts.map((text, i) => ({
    start: i * slice,
    end: (i + 1) * slice,
    text,
  }));
}

/** 诗意原创词无时间戳：按非空行切分，在整曲时长内均分展示区间 */
function pseudoTimelineFromPoeticLyrics(raw: string, fullDur: number): LyricTimelineLine[] {
  if (fullDur <= 0) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!lines.length) return [];
  const slice = fullDur / lines.length;
  return lines.map((text, i) => ({
    start: i * slice,
    end: (i + 1) * slice,
    text,
  }));
}

function pickActiveIndex(lines: LyricTimelineLine[], t: number): number {
  if (!lines.length) return -1;
  for (let i = 0; i < lines.length; i++) {
    const { start, end } = lines[i];
    const isLast = i === lines.length - 1;
    if (t >= start && (isLast ? t <= end + 0.05 : t < end)) return i;
  }
  if (t < lines[0].start) return 0;
  return lines.length - 1;
}

type ListeningLyricStageProps = {
  playerTime: number;
  playerDuration: number;
  /** 浏览器尚未解析出 duration 时，用分析/意图里的秒数对齐伪时间轴，减轻切歌延迟感 */
  durationHintSec?: number;
  captions: ListeningCaptionsLite | null;
  whisperTimeline: LyricTimelineLine[] | null | undefined;
  omniTimeline: LyricTimelineLine[] | null | undefined;
  /** 诗意原创词正文：在无 Whisper/Omni 时间轴时按行均分整曲时长 */
  poeticLyricsZh?: string | null;
};

/**
 * 随播放进度展示主行「逐字显影」与下一行预览，替代静态大段听感卡片。
 */
export function ListeningLyricStage({
  playerTime,
  playerDuration,
  durationHintSec,
  captions,
  whisperTimeline,
  omniTimeline,
  poeticLyricsZh,
}: ListeningLyricStageProps) {
  const timelineDuration = useMemo(() => {
    if (playerDuration > 0 && Number.isFinite(playerDuration)) return playerDuration;
    const h = durationHintSec;
    if (typeof h === "number" && Number.isFinite(h) && h > 0) return h;
    return 0;
  }, [playerDuration, durationHintSec]);

  /** 降低逐字重绘频率，避免与 canvas 争抢主线程 */
  const displayTime = useMemo(
    () => Math.round(playerTime * 10) / 10,
    [playerTime],
  );

  const poeticLines = useMemo(() => {
    const t = typeof poeticLyricsZh === "string" ? poeticLyricsZh.trim() : "";
    if (!t || timelineDuration <= 0) return [];
    return pseudoTimelineFromPoeticLyrics(t, timelineDuration);
  }, [poeticLyricsZh, timelineDuration]);

  const primaryLines = useMemo(() => {
    const w = whisperTimeline?.length ? whisperTimeline : null;
    if (w) return w;
    const oRaw = omniTimeline?.length ? omniTimeline : null;
    if (oRaw) return scaleTimelineToDuration(oRaw, timelineDuration);
    if (poeticLines.length) return poeticLines;
    if (captions) {
      const pseudo = pseudoTimelineFromCaptions(captions, timelineDuration);
      if (pseudo.length) return pseudo;
    }
    return [];
  }, [whisperTimeline, omniTimeline, poeticLines, captions, timelineDuration]);

  const auraLines = useMemo(() => {
    if (whisperTimeline?.length && omniTimeline?.length && timelineDuration > 0) {
      return scaleTimelineToDuration(omniTimeline, timelineDuration);
    }
    return [];
  }, [whisperTimeline, omniTimeline, timelineDuration]);

  const idx = useMemo(
    () => pickActiveIndex(primaryLines, displayTime),
    [primaryLines, displayTime],
  );

  const current = idx >= 0 ? primaryLines[idx] : null;
  const nextPrimary = idx >= 0 && idx + 1 < primaryLines.length ? primaryLines[idx + 1] : null;

  const auraIdx = useMemo(() => pickActiveIndex(auraLines, displayTime), [auraLines, displayTime]);
  const auraCurrent = auraIdx >= 0 ? auraLines[auraIdx] : null;

  const charSpans = useMemo(() => {
    if (!current || current.end <= current.start) return [];
    const text = current.text;
    const chars = Array.from(text);
    if (!chars.length) return [];
    const span = Math.max(0.001, current.end - current.start);
    const local = Math.max(0, Math.min(1, (displayTime - current.start) / span));
    let cut = Math.min(chars.length, Math.ceil(local * chars.length));
    if (cut < 1) cut = 1;
    return chars.map((ch, i) => ({
      ch,
      state: i < cut - 1 ? "on" : i === cut - 1 ? "edge" : "off",
    }));
  }, [current, displayTime]);

  if (!primaryLines.length && !captions?.footnote) {
    return null;
  }

  return (
    <div className="lyric-stage-root lyric-stage-root--studio" aria-live="polite">
      {current ? (
        <div className="lyric-stage-main">
          <p className="lyric-stage-line lyric-stage-line--primary">
            {charSpans.length > 0 ? (
              charSpans.map((c, i) => (
                <span key={`${idx}-${i}`} className={`lyric-stage-char lyric-stage-char--${c.state}`}>
                  {c.ch}
                </span>
              ))
            ) : (
              <span className="lyric-stage-char lyric-stage-char--on">{current.text}</span>
            )}
          </p>
          {auraCurrent && auraCurrent.text !== current.text ? (
            <p className="lyric-stage-line lyric-stage-line--aura">{auraCurrent.text}</p>
          ) : null}
          {nextPrimary ? <p className="lyric-stage-line lyric-stage-line--next">{nextPrimary.text}</p> : null}
        </div>
      ) : captions?.footnote ? (
        <p className="lyric-stage-line lyric-stage-line--next">{captions.footnote}</p>
      ) : null}
    </div>
  );
}
