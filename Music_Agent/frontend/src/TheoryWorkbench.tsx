import { useCallback, useEffect, useState } from "react";

export type TheoryAnalyzePayload = {
  ok: boolean;
  key?: string;
  mode?: string;
  time_signature?: string;
  tempo_bpm?: number | null;
  duration_quarters?: number;
  duration_seconds?: number | null;
  parts?: number;
  note_count?: number;
  chord_progression?: string[];
  summary_zh?: string;
  issues?: string[];
  tracks?: Array<Record<string, unknown>>;
};

type Props = {
  savedFilename: string;
  isMidi: boolean;
  isAudio: boolean;
  theoryEnabled?: boolean;
  demucsAvailable?: boolean;
  absAssetUrl: (rel: string) => string;
  onLog: (msg: string, kind?: "ok" | "err") => void;
  onHarmonized: (wavOrMidiUrl: string, label: string) => void;
  onStemPlay?: (url: string, label: string) => void;
};

const HARMONY_STYLES = [
  { value: "pop", label: "流行" },
  { value: "jazz", label: "爵士" },
  { value: "classical", label: "古典" },
  { value: "folk", label: "民谣" },
  { value: "chinese", label: "中国风" },
] as const;

const STEM_LABELS: Record<string, string> = {
  vocals: "人声",
  drums: "鼓组",
  bass: "贝斯",
  other: "其他",
};

export function TheoryWorkbench({
  savedFilename,
  isMidi,
  isAudio,
  theoryEnabled = true,
  demucsAvailable = true,
  absAssetUrl,
  onLog,
  onHarmonized,
  onStemPlay,
}: Props) {
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const [harmonizeBusy, setHarmonizeBusy] = useState(false);
  const [stemsBusy, setStemsBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [analysis, setAnalysis] = useState<TheoryAnalyzePayload | null>(null);
  const [harmonyStyle, setHarmonyStyle] = useState("pop");
  const [harmonizeUrls, setHarmonizeUrls] = useState<{ midi?: string; wav?: string }>({});
  const [exportUrls, setExportUrls] = useState<Record<string, string>>({});
  const [stemUrls, setStemUrls] = useState<Record<string, string>>({});
  const [demucsMaxSec, setDemucsMaxSec] = useState(120);

  useEffect(() => {
    setAnalysis(null);
    setHarmonizeUrls({});
    setExportUrls({});
    setStemUrls({});
  }, [savedFilename]);

  useEffect(() => {
    fetch("/api/music/stems/status")
      .then((r) => r.json())
      .then((d: { max_seconds?: number }) => {
        if (typeof d.max_seconds === "number" && d.max_seconds > 0) {
          setDemucsMaxSec(Math.min(d.max_seconds, 300));
        }
      })
      .catch(() => {});
  }, []);

  const runAnalyze = useCallback(async () => {
    if (!savedFilename || analyzeBusy || !theoryEnabled) return;
    setAnalyzeBusy(true);
    onLog("乐理分析请求中…", "ok");
    try {
      const resp = await fetch("/api/music/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved_filename: savedFilename }),
      });
      const data = (await resp.json()) as TheoryAnalyzePayload & { detail?: string };
      if (!resp.ok) {
        throw new Error(String(data.detail || resp.statusText));
      }
      setAnalysis(data);
      onLog(data.summary_zh || "分析完成", "ok");
    } catch (e) {
      onLog(String(e instanceof Error ? e.message : e), "err");
    } finally {
      setAnalyzeBusy(false);
    }
  }, [savedFilename, analyzeBusy, theoryEnabled, onLog]);

  const runHarmonize = useCallback(async () => {
    if (!savedFilename || !isMidi || harmonizeBusy || !theoryEnabled) return;
    setHarmonizeBusy(true);
    onLog("自动配和声中…", "ok");
    try {
      const resp = await fetch("/api/music/harmonize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saved_filename: savedFilename,
          harmony_style: harmonyStyle,
        }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        midi_url?: string;
        wav_url?: string;
        detail?: string;
        chord_roman?: string[];
        summary_zh?: string;
      };
      if (!resp.ok || !data.ok) {
        throw new Error(String(data.detail || "配和声失败"));
      }
      setHarmonizeUrls({ midi: data.midi_url, wav: data.wav_url });
      const pick = data.wav_url || data.midi_url;
      if (pick) {
        onHarmonized(pick, "配和声成品");
      }
      onLog(
        data.summary_zh ||
          `配和声完成${data.chord_roman?.length ? `：${data.chord_roman.slice(0, 8).join(" ")}` : ""}`,
        "ok",
      );
    } catch (e) {
      onLog(String(e instanceof Error ? e.message : e), "err");
    } finally {
      setHarmonizeBusy(false);
    }
  }, [savedFilename, isMidi, harmonizeBusy, harmonyStyle, theoryEnabled, onHarmonized, onLog]);

  const runExportScore = useCallback(async () => {
    if (!savedFilename || !isMidi || exportBusy || !theoryEnabled) return;
    setExportBusy(true);
    onLog("导出乐谱中…", "ok");
    try {
      const resp = await fetch("/api/music/export-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved_filename: savedFilename }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        urls?: Record<string, string>;
        detail?: string;
      };
      if (!resp.ok || !data.ok) {
        throw new Error(String(data.detail || "导出失败"));
      }
      setExportUrls(data.urls || {});
      onLog("乐谱导出完成", "ok");
    } catch (e) {
      onLog(String(e instanceof Error ? e.message : e), "err");
    } finally {
      setExportBusy(false);
    }
  }, [savedFilename, isMidi, exportBusy, theoryEnabled, onLog]);

  const runStems = useCallback(async () => {
    if (!savedFilename || !isAudio || stemsBusy || !demucsAvailable) return;
    setStemsBusy(true);
    onLog(`Demucs 分轨中（CPU，最长 ${demucsMaxSec}s）…`, "ok");
    try {
      const resp = await fetch("/api/music/stems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saved_filename: savedFilename,
          max_seconds: demucsMaxSec,
        }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        stem_urls?: Record<string, string>;
        summary_zh?: string;
        detail?: string;
      };
      if (!resp.ok || !data.ok) {
        throw new Error(String(data.detail || "分轨失败"));
      }
      setStemUrls(data.stem_urls || {});
      onLog(data.summary_zh || "分轨完成", "ok");
    } catch (e) {
      onLog(String(e instanceof Error ? e.message : e), "err");
    } finally {
      setStemsBusy(false);
    }
  }, [savedFilename, isAudio, stemsBusy, demucsAvailable, demucsMaxSec, onLog]);

  if (!savedFilename) return null;

  return (
    <div className="theory-workbench">
      <div className="theory-workbench-head">
        <span className="theory-workbench-title">乐理 & 音频工具</span>
        <span className="theory-workbench-sub">music21 · Demucs · 乐谱导出</span>
      </div>

      {!theoryEnabled ? (
        <p className="theory-hint theory-hint-warn">乐理工具已在服务端关闭（ENABLE_MUSIC_THEORY=false）</p>
      ) : null}

      <div className="theory-section">
        <div className="theory-section-label">MIDI 乐理</div>
        <div className="theory-workbench-actions">
          <button
            type="button"
            className="primary theory-btn"
            disabled={!isMidi || analyzeBusy || !theoryEnabled}
            onClick={() => void runAnalyze()}
          >
            {analyzeBusy ? "分析中…" : "深度分析"}
          </button>
          {isMidi ? (
            <>
              <select
                className="theory-style-select"
                value={harmonyStyle}
                onChange={(e) => setHarmonyStyle(e.target.value)}
                aria-label="和声风格"
              >
                {HARMONY_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary theory-btn"
                disabled={harmonizeBusy || !theoryEnabled}
                onClick={() => void runHarmonize()}
              >
                {harmonizeBusy ? "配和声中…" : "自动配和声"}
              </button>
              <button
                type="button"
                className="theory-btn theory-btn-secondary"
                disabled={exportBusy || !theoryEnabled}
                onClick={() => void runExportScore()}
              >
                {exportBusy ? "导出中…" : "导出乐谱"}
              </button>
            </>
          ) : (
            <span className="theory-hint">上传 .mid 可用分析 / 配和声 / 乐谱</span>
          )}
        </div>
      </div>

      {isAudio ? (
        <div className="theory-section">
          <div className="theory-section-label">音频分轨</div>
          <div className="theory-workbench-actions">
            <label className="theory-stem-limit">
              <span>最长</span>
              <input
                type="number"
                min={15}
                max={300}
                step={15}
                value={demucsMaxSec}
                onChange={(e) => setDemucsMaxSec(Number(e.target.value) || 120)}
              />
              <span>秒</span>
            </label>
            <button
              type="button"
              className="primary theory-btn"
              disabled={stemsBusy || !demucsAvailable}
              onClick={() => void runStems()}
            >
              {stemsBusy ? "分轨中…" : "Demucs 分轨"}
            </button>
          </div>
          {!demucsAvailable ? (
            <p className="theory-hint theory-hint-warn">Demucs 未就绪，请确认 Docker INSTALL_DEMUCS=1</p>
          ) : stemsBusy ? (
            <p className="theory-hint">CPU 分轨较慢，请耐心等待…</p>
          ) : null}
        </div>
      ) : null}

      {analysis?.ok ? (
        <div className="theory-result-card">
          <p className="theory-summary">{analysis.summary_zh}</p>
          <dl className="theory-stats-grid">
            {analysis.key ? (
              <>
                <dt>调性</dt>
                <dd>
                  {analysis.key}
                  {analysis.mode ? ` ${analysis.mode}` : ""}
                </dd>
              </>
            ) : null}
            {analysis.time_signature ? (
              <>
                <dt>拍号</dt>
                <dd>{analysis.time_signature}</dd>
              </>
            ) : null}
            {analysis.tempo_bpm ? (
              <>
                <dt>速度</dt>
                <dd>{Math.round(analysis.tempo_bpm)} BPM</dd>
              </>
            ) : null}
            {typeof analysis.parts === "number" ? (
              <>
                <dt>声部</dt>
                <dd>{analysis.parts}</dd>
              </>
            ) : null}
            {typeof analysis.note_count === "number" ? (
              <>
                <dt>音符</dt>
                <dd>{analysis.note_count}</dd>
              </>
            ) : null}
          </dl>
          {analysis.chord_progression && analysis.chord_progression.length > 0 ? (
            <p className="theory-chords">
              和弦：{analysis.chord_progression.slice(0, 16).join(" · ")}
              {analysis.chord_progression.length > 16 ? " …" : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {(harmonizeUrls.midi || harmonizeUrls.wav) && (
        <div className="theory-output-row">
          <span className="theory-output-label">配和声</span>
          {harmonizeUrls.wav ? (
            <button
              type="button"
              className="server-uploads-btn"
              onClick={() => onHarmonized(harmonizeUrls.wav!, "配和声试听")}
            >
              试听 WAV
            </button>
          ) : null}
          {harmonizeUrls.midi ? (
            <a className="upload-dl-link" href={absAssetUrl(harmonizeUrls.midi)} download>
              下载 MIDI
            </a>
          ) : null}
        </div>
      )}

      {Object.keys(exportUrls).length > 0 ? (
        <div className="theory-output-row">
          <span className="theory-output-label">乐谱</span>
          {exportUrls.musicxml ? (
            <a className="upload-dl-link" href={absAssetUrl(exportUrls.musicxml)} download>
              MusicXML
            </a>
          ) : null}
          {exportUrls.pdf ? (
            <a className="upload-dl-link" href={absAssetUrl(exportUrls.pdf)} download>
              PDF
            </a>
          ) : null}
          {exportUrls.abc ? (
            <a className="upload-dl-link upload-dl-link-muted" href={absAssetUrl(exportUrls.abc)} download>
              ABC
            </a>
          ) : null}
        </div>
      ) : null}

      {Object.keys(stemUrls).length > 0 ? (
        <div className="theory-stem-grid">
          {Object.entries(stemUrls).map(([k, u]) => (
            <div key={k} className="theory-stem-card">
              <span className="theory-stem-name">{STEM_LABELS[k] ?? k}</span>
              <div className="theory-stem-actions">
                {onStemPlay ? (
                  <button
                    type="button"
                    className="server-uploads-btn"
                    onClick={() => onStemPlay(u, `分轨 · ${STEM_LABELS[k] ?? k}`)}
                  >
                    试听
                  </button>
                ) : null}
                <a className="upload-dl-link upload-dl-link-muted" href={absAssetUrl(u)} download>
                  下载
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
