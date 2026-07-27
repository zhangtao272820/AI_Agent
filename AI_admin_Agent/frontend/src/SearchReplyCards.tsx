export type SearchHitItem = {
  title: string;
  url?: string;
  snippet?: string;
  publishedDate?: string | null;
  engine?: string | null;
};

export type WebSearchCard = {
  type: 'web_search';
  title?: string;
  query?: string;
  provider?: string;
  hits?: SearchHitItem[];
};

export function SearchReplyCards({ cards }: { cards: WebSearchCard[] }) {
  if (!cards.length) return null;
  return (
    <div className="search-reply-cards">
      {cards.map((card, ci) => (
        <article key={ci} className="search-card">
          <header className="search-card__head">
            <span className="search-card__badge">联网</span>
            <h4 className="search-card__title">
              {card.title || '实时资讯'}
              {card.query ? ` · ${card.query}` : ''}
            </h4>
            {card.provider ? <span className="search-card__provider">{card.provider}</span> : null}
          </header>
          <ol className="search-hit-list">
            {(card.hits || []).map((hit, hi) => (
              <li key={hi} className="search-hit-item">
                <div className="search-hit-item__index">{hi + 1}</div>
                <div className="search-hit-item__body">
                  {hit.url ? (
                    <a
                      className="search-hit-item__title"
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {hit.title || hit.url}
                    </a>
                  ) : (
                    <div className="search-hit-item__title">{hit.title || '—'}</div>
                  )}
                  {hit.snippet ? <p className="search-hit-item__snippet">{hit.snippet}</p> : null}
                  <div className="search-hit-item__meta">
                    {hit.publishedDate ? <span>{hit.publishedDate}</span> : null}
                    {hit.engine ? <span>{hit.engine}</span> : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </article>
      ))}
    </div>
  );
}
