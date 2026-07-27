export type HotTopicItem = {
  title?: string;
  url?: string;
  heat?: string;
  platform?: string;
};

export type BilibiliVideoItem = {
  title?: string;
  url?: string;
  author?: string;
  description?: string;
};

export type ArxivPaperItem = {
  title?: string;
  url?: string;
  authors?: string;
  published?: string;
  summary?: string;
};

export type MemoryEntityItem = {
  name?: string;
  type?: string;
  observations?: string[];
};

export type ThinkingStepItem = {
  step?: number;
  title?: string;
};

export type HotTopicsCard = {
  type: 'hot_topics';
  title?: string;
  platform?: string;
  items?: HotTopicItem[];
};

export type BilibiliSearchCard = {
  type: 'bilibili_search';
  title?: string;
  query?: string;
  videos?: BilibiliVideoItem[];
};

export type ArxivSearchCard = {
  type: 'arxiv_search';
  title?: string;
  query?: string;
  papers?: ArxivPaperItem[];
};

export type FetchUrlCard = {
  type: 'fetch_url';
  title?: string;
  url?: string;
  excerpt?: string;
};

export type MemoryGraphCard = {
  type: 'memory_graph';
  title?: string;
  entities?: MemoryEntityItem[];
  relation_count?: number;
};

export type ThinkingOutlineCard = {
  type: 'thinking_outline';
  title?: string;
  goal?: string;
  steps?: ThinkingStepItem[];
};

export type TechPulseItem = {
  title?: string;
  url?: string;
  snippet?: string;
  source?: string;
};

export type DailyQuoteCard = {
  type: 'daily_quote';
  title?: string;
  quote?: string;
  author?: string;
};

export type RandomWikiCard = {
  type: 'random_wiki';
  title?: string;
  summary?: string;
  url?: string;
};

export type TechPulseCard = {
  type: 'tech_pulse';
  title?: string;
  items?: TechPulseItem[];
};

export type PlayUiCard =
  | DailyQuoteCard
  | RandomWikiCard
  | TechPulseCard
  | HotTopicsCard
  | BilibiliSearchCard
  | ArxivSearchCard
  | FetchUrlCard
  | MemoryGraphCard
  | ThinkingOutlineCard;

const SOURCE_LABEL: Record<string, string> = {
  github: 'GitHub',
  hn: 'HN',
  news: '资讯',
  bilibili: 'B站',
  weibo: '微博',
  zhihu: '知乎',
};

export function PlayReplyCards({ cards }: { cards: PlayUiCard[] }) {
  return (
    <div className="play-cards">
      {cards.map((card, idx) => {
        if (card.type === 'daily_quote') {
          return (
            <div key={`quote-${idx}`} className="play-card play-card--quote">
              <div className="play-card__head">
                <span className="play-card__emoji">💬</span>
                <h4>{card.title || '每日一句'}</h4>
              </div>
              <blockquote className="play-card__quote">「{card.quote}」</blockquote>
              {card.author ? <p className="play-card__sub">—— {card.author}</p> : null}
            </div>
          );
        }
        if (card.type === 'random_wiki') {
          return (
            <div key={`wiki-${idx}`} className="play-card play-card--wiki">
              <div className="play-card__head">
                <span className="play-card__emoji">📖</span>
                <h4>{card.title || '百科盲盒'}</h4>
              </div>
              <p className="play-card__snippet">{card.summary}</p>
              {card.url ? (
                <a href={card.url} target="_blank" rel="noopener noreferrer" className="play-card__url">
                  阅读原文 →
                </a>
              ) : null}
            </div>
          );
        }
        if (card.type === 'tech_pulse') {
          return (
            <div key={`tech-${idx}`} className="play-card play-card--tech">
              <div className="play-card__head">
                <span className="play-card__emoji">⚡</span>
                <h4>{card.title || '技术脉搏'}</h4>
              </div>
              <ol className="play-card__list">
                {(card.items || []).map((it, i) => (
                  <li key={i} className="play-card__row">
                    <span className="play-card__badge">{SOURCE_LABEL[it.source || ''] || it.source}</span>
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noopener noreferrer" className="play-card__link">
                        {it.title}
                      </a>
                    ) : (
                      <span>{it.title}</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          );
        }
        if (card.type === 'hot_topics') {
          return (
            <div key={`hot-${idx}`} className="play-card play-card--hot">
              <div className="play-card__head">
                <span className="play-card__emoji">🔥</span>
                <h4>{card.title || '今日热榜'}</h4>
              </div>
              <ol className="play-card__list">
                {(card.items || []).map((it, i) => (
                  <li key={i} className="play-card__row">
                    <span className="play-card__badge">{SOURCE_LABEL[it.platform || ''] || it.platform}</span>
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noopener noreferrer" className="play-card__link">
                        {it.title}
                      </a>
                    ) : (
                      <span>{it.title}</span>
                    )}
                    {it.heat ? <span className="play-card__meta">{it.heat}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          );
        }
        if (card.type === 'bilibili_search') {
          return (
            <div key={`bili-${idx}`} className="play-card play-card--bili">
              <div className="play-card__head">
                <span className="play-card__emoji">📺</span>
                <h4>{card.title || 'B 站搜索'}</h4>
              </div>
              <ul className="play-card__list play-card__list--media">
                {(card.videos || []).map((v, i) => (
                  <li key={i} className="play-card__media">
                    {v.url ? (
                      <a href={v.url} target="_blank" rel="noopener noreferrer" className="play-card__link">
                        {v.title}
                      </a>
                    ) : (
                      <div className="play-card__link">{v.title}</div>
                    )}
                    {v.author ? <div className="play-card__sub">UP · {v.author}</div> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (card.type === 'arxiv_search') {
          return (
            <div key={`arxiv-${idx}`} className="play-card play-card--arxiv">
              <div className="play-card__head">
                <span className="play-card__emoji">📄</span>
                <h4>{card.title || 'arXiv'}</h4>
              </div>
              <ul className="play-card__list">
                {(card.papers || []).map((p, i) => (
                  <li key={i} className="play-card__paper">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="play-card__link">
                        {p.title}
                      </a>
                    ) : (
                      <div className="play-card__link">{p.title}</div>
                    )}
                    <div className="play-card__sub">
                      {[p.authors, p.published].filter(Boolean).join(' · ')}
                    </div>
                    {p.summary ? <p className="play-card__snippet">{p.summary}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (card.type === 'fetch_url') {
          return (
            <div key={`fetch-${idx}`} className="play-card play-card--fetch">
              <div className="play-card__head">
                <span className="play-card__emoji">🔗</span>
                <h4>{card.title || '网页精读'}</h4>
              </div>
              {card.url ? (
                <a href={card.url} target="_blank" rel="noopener noreferrer" className="play-card__url">
                  {card.url}
                </a>
              ) : null}
              {card.excerpt ? <pre className="play-card__excerpt">{card.excerpt}</pre> : null}
            </div>
          );
        }
        if (card.type === 'memory_graph') {
          return (
            <div key={`mem-${idx}`} className="play-card play-card--memory">
              <div className="play-card__head">
                <span className="play-card__emoji">🧠</span>
                <h4>{card.title || '记忆墙'}</h4>
                {typeof card.relation_count === 'number' ? (
                  <span className="play-card__meta">{card.relation_count} 条关系</span>
                ) : null}
              </div>
              <ul className="play-card__list">
                {(card.entities || []).map((e, i) => (
                  <li key={i} className="play-card__memory-row">
                    <strong>{e.name}</strong>
                    {e.type ? <span className="play-card__badge">{e.type}</span> : null}
                    {(e.observations || []).slice(0, 2).map((o, j) => (
                      <div key={j} className="play-card__sub">{o}</div>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (card.type === 'thinking_outline') {
          return (
            <div key={`think-${idx}`} className="play-card play-card--think">
              <div className="play-card__head">
                <span className="play-card__emoji">🧩</span>
                <h4>{card.title || '分步规划'}</h4>
              </div>
              {card.goal ? <p className="play-card__goal">🎯 {card.goal}</p> : null}
              <ol className="play-card__steps">
                {(card.steps || []).map((s, i) => (
                  <li key={i}>
                    <span className="play-card__step-num">{s.step ?? i + 1}</span>
                    {s.title}
                  </li>
                ))}
              </ol>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
