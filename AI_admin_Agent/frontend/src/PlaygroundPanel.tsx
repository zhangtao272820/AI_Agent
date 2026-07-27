import { useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export type PlaygroundItem = {
  id: string;
  name: string;
  emoji?: string;
  tagline?: string;
  samplePrompt?: string;
  configured?: boolean;
  mcpSidecarReady?: boolean;
  mcpConfigured?: boolean;
  deployPhase?: number;
};

type QuotePreview = { text?: string; author?: string };

export function PlaygroundPanel(props: {
  onQuickChat: (text: string) => void;
}) {
  const { onQuickChat } = props;
  const [items, setItems] = useState<PlaygroundItem[]>([]);
  const [quotePreview, setQuotePreview] = useState<QuotePreview | null>(null);
  const [mcpSummary, setMcpSummary] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, quoteRes] = await Promise.all([
        fetch(`${API_BASE}/playground/catalog`),
        fetch(`${API_BASE}/playground/quote`),
      ]);
      const cat = await catRes.json();
      setItems(Array.isArray(cat.items) ? cat.items : []);
      const gw = cat?.mcpGateway;
      const parts: string[] = [];
      if (cat?.mcpSidecarEnabled) parts.push('MCP 侧车已启用');
      if (gw?.ok) parts.push(`网关在线 · ${cat.mcpSidecarReadyCount ?? 0} 项侧车就绪`);
      else if (cat?.mcpSidecarEnabled) parts.push('网关离线（内置仍可用）');
      setMcpSummary(parts.join(' · '));
      if (quoteRes.ok) {
        const quote = await quoteRes.json();
        if (quote?.text) setQuotePreview({ text: quote.text, author: quote.author });
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="playground-panel app-chat-scroll flex-1 overflow-y-auto">
      <div className="playground-panel__hero app-content-shell">
        <div className="playground-panel__spark">✨</div>
        <h2 className="playground-panel__title">玩法台</h2>
        <p className="playground-panel__subtitle">
          温情八件套 — 每日一句、百科盲盒、技术脉搏… 点卡片开玩
        </p>
        {mcpSummary ? <p className="playground-panel__mcp-line">{mcpSummary}</p> : null}
        {quotePreview?.text ? (
          <div className="playground-panel__hot-strip">
            <span className="playground-panel__hot-label">💬 今日一句</span>
            <button
              type="button"
              className="playground-panel__quote-chip"
              onClick={() =>
                onQuickChat(
                  `我很喜欢这句：「${quotePreview.text}」${quotePreview.author ? `——${quotePreview.author}` : ''}。能再聊聊吗？`,
                )
              }
              title={quotePreview.text}
            >
              「{quotePreview.text}」
              {quotePreview.author ? <span className="playground-panel__quote-author"> — {quotePreview.author}</span> : null}
            </button>
          </div>
        ) : null}
      </div>

      <div className="app-content-shell playground-panel__grid">
        {loading ? <p className="text-white/45">加载玩法目录…</p> : null}
        {!loading &&
          items.map((it) => (
            <article key={it.id} className={`playground-card playground-card--${it.id}`}>
              <div className="playground-card__top">
                <span className="playground-card__emoji">{it.emoji || '🎮'}</span>
                <div>
                  <h3 className="playground-card__name">{it.name}</h3>
                  <p className="playground-card__tagline">{it.tagline}</p>
                </div>
              </div>
              <div className="playground-card__badges">
                {it.configured !== false ? (
                  <span className="playground-card__status playground-card__status--ok">内置 ✓</span>
                ) : (
                  <span className="playground-card__status">MinerU 待配置</span>
                )}
                {it.mcpSidecarReady ? (
                  <span className="playground-card__status playground-card__status--mcp">MCP 侧车 ✓</span>
                ) : it.mcpConfigured ? (
                  <span className="playground-card__status">MCP 已注册</span>
                ) : it.deployPhase && it.deployPhase > 1 ? (
                  <span className="playground-card__status">Phase {it.deployPhase} 侧车</span>
                ) : null}
              </div>
              <button
                type="button"
                className="playground-card__btn"
                onClick={() => onQuickChat(it.samplePrompt || `试试 ${it.name}`)}
              >
                一键试玩 →
              </button>
            </article>
          ))}
      </div>

      <div className="app-content-shell playground-panel__footer">
        <p className="playground-panel__doc-hint">
          启用侧车：<code>docker compose --profile fun-mcp up admin_mcp_gateway mineru_api</code>
          ，详见 <code>doc/MCP趣味八件套-分阶段接入.md</code>
        </p>
      </div>
    </div>
  );
}
