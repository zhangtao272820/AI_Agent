import { useCallback, useEffect, useState } from "react";

export type MusicHealth = {
  ok?: boolean;
  compose_backend?: string;
  enable_music_theory?: boolean;
  enable_demucs_stems?: boolean;
  demucs_available?: boolean;
  enable_audio_remix?: boolean;
  enable_midi_swap?: boolean;
  theory_tools?: number;
  neural_music?: {
    will_use_neural?: boolean;
    skip_reason?: string;
    cuda_ready?: boolean;
  };
};

type CatalogTool = {
  id: string;
  method?: string;
  description?: string;
};

type Props = {
  health: MusicHealth | null;
  onQuickCompose: (text: string) => void;
  onNavigate: (section: "compose" | "upload") => void;
  variant?: "default" | "drawer";
};

const TOOL_META: Record<
  string,
  { emoji: string; samplePrompt?: string; nav?: "compose" | "upload"; navLabel?: string }
> = {
  music_compose: { emoji: "🎹", samplePrompt: "写一段 30 秒舒缓钢琴纯音乐，C 大调", nav: "compose" },
  music_bgm: { emoji: "🎬", samplePrompt: "生成 45 秒短视频 BGM，轻快、无歌词", nav: "compose" },
  music_analyze: { emoji: "🔍", nav: "upload", navLabel: "上传 MIDI 分析" },
  music_harmonize: { emoji: "🎼", nav: "upload", navLabel: "上传 MIDI 配和声" },
  music_midi_swap: { emoji: "🎛️", nav: "upload", navLabel: "上传 MIDI 换音色" },
  music_stems: { emoji: "🎚️", nav: "upload", navLabel: "上传音频分轨" },
  music_score: { emoji: "📄", nav: "upload", navLabel: "上传 MIDI 导出乐谱" },
  music_lyrics: { emoji: "✍️", nav: "upload", navLabel: "上传音频写词" },
};

function statusChip(
  label: string,
  on: boolean,
  hint?: string,
): { label: string; on: boolean; hint?: string } {
  return { label, on, hint };
}

export function MusicToolkitPanel({ health, onQuickCompose, onNavigate, variant = "default" }: Props) {
  const [tools, setTools] = useState<CatalogTool[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/music/theory/catalog");
      const data = (await resp.json()) as { tools?: CatalogTool[] };
      setTools(Array.isArray(data.tools) ? data.tools : []);
    } catch {
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const chips = [
    statusChip(
      `作曲 · ${health?.compose_backend === "neural" ? "神经" : "规则 CPU"}`,
      health?.compose_backend !== "neural",
    ),
    statusChip("乐理工具", Boolean(health?.enable_music_theory)),
    statusChip(
      "Demucs 分轨",
      Boolean(health?.demucs_available && health?.enable_demucs_stems),
      health?.enable_demucs_stems && !health?.demucs_available ? "依赖未就绪" : undefined,
    ),
    statusChip(
      "神经 BGM",
      Boolean(health?.neural_music?.will_use_neural),
      health?.neural_music?.skip_reason || "需 GPU · 默认关闭",
    ),
    statusChip("MIDI 换音色", Boolean(health?.enable_midi_swap ?? true)),
  ];

  return (
    <section
      className={`music-toolkit${variant === "drawer" ? " music-toolkit--drawer" : " panel"}`}
      aria-label="音乐能力台"
    >
      <div className="music-toolkit-head">
        <div>
          <h2 className="music-toolkit-title">能力台</h2>
          <p className="music-toolkit-sub">
            CPU 优先 · {(health?.theory_tools ?? tools.length) || 8} 项内置能力
            {health?.enable_audio_remix ? " · 音频重混已开（调试）" : ""}
          </p>
        </div>
        <button type="button" className="server-uploads-btn" onClick={() => void loadCatalog()}>
          刷新
        </button>
      </div>

      <div className="music-toolkit-status" role="list" aria-label="服务状态">
        {chips.map((c) => (
          <span
            key={c.label}
            role="listitem"
            className={`music-toolkit-chip${c.on ? " music-toolkit-chip--on" : " music-toolkit-chip--off"}`}
            title={c.hint}
          >
            <span className="music-toolkit-chip-dot" aria-hidden />
            {c.label}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="music-toolkit-loading">加载能力清单…</p>
      ) : (
        <div className="music-toolkit-grid">
          {tools.map((tool) => {
            const meta = TOOL_META[tool.id] ?? { emoji: "🎵" };
            const canCompose = Boolean(meta.samplePrompt);
            return (
              <article key={tool.id} className="music-toolkit-card">
                <div className="music-toolkit-card-top">
                  <span className="music-toolkit-card-emoji" aria-hidden>
                    {meta.emoji}
                  </span>
                  <div className="music-toolkit-card-meta">
                    <h3 className="music-toolkit-card-id">{tool.id.replace(/^music_/, "")}</h3>
                    <p className="music-toolkit-card-desc">{tool.description}</p>
                    {tool.method ? (
                      <code className="music-toolkit-card-method">{tool.method}</code>
                    ) : null}
                  </div>
                </div>
                <div className="music-toolkit-card-actions">
                  {canCompose ? (
                    <button
                      type="button"
                      className="primary music-toolkit-card-btn"
                      onClick={() => {
                        onNavigate("compose");
                        onQuickCompose(meta.samplePrompt!);
                      }}
                    >
                      填入示例
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary music-toolkit-card-btn"
                      onClick={() => onNavigate(meta.nav ?? "upload")}
                    >
                      {meta.navLabel ?? "去上传区"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
