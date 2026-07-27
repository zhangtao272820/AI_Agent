import { useMemo, useState, type ReactNode } from 'react';

export type AmapRouteStep = { text: string; kind?: string };

export type AmapPlaceItem = {
  name: string;
  address?: string;
  distance_m?: number;
  map_url?: string | null;
};

export type AmapRouteOption = {
  mode?: string;
  mode_label?: string;
  duration_minutes?: number;
  distance_km?: number;
  steps?: AmapRouteStep[];
  map_url?: string | null;
  unavailable?: boolean;
  hint?: string;
};

export type UiCard =
  | {
      type: 'amap_route';
      title?: string;
      origin?: string;
      destination?: string;
      mode_label?: string;
      duration_minutes?: number;
      distance_km?: number;
      steps?: AmapRouteStep[];
      map_url?: string | null;
      map_image_url?: string | null;
      provider?: string;
    }
  | {
      type: 'amap_route_compare';
      title?: string;
      origin?: string;
      destination?: string;
      recommended_mode?: string;
      options?: AmapRouteOption[];
      map_image_url?: string | null;
      provider?: string;
    }
  | {
      type: 'amap_places';
      title?: string;
      subtitle?: string;
      places?: AmapPlaceItem[];
      map_image_url?: string | null;
      provider?: string;
    }
  | {
      type: 'amap_address';
      title?: string;
      address?: string;
      location?: string;
      map_url?: string | null;
      map_image_url?: string | null;
      provider?: string;
    };

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
const ROUTE_STEP_PREVIEW = 4;

function stepIcon(kind?: string): string {
  switch (kind) {
    case 'walk':
      return '🚶';
    case 'transit':
      return '🚇';
    case 'bike':
      return '🚲';
    case 'drive':
      return '🚗';
    default:
      return '•';
  }
}

function resolveMapImageSrc(path?: string | null): string | null {
  const raw = String(path || '').trim();
  if (!raw) return null;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="amap-stat-pill">
      <span className="amap-stat-pill__label">{label}</span>
      <span className="amap-stat-pill__value">{value}</span>
    </span>
  );
}

function MapLink({ href, label }: { href?: string | null; label: string }) {
  if (!href) return null;
  return (
    <a className="amap-map-link" href={href} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  );
}

function MapPreview({ src, alt }: { src?: string | null; alt: string }) {
  const resolved = resolveMapImageSrc(src);
  if (!resolved) return null;
  return (
    <div className="amap-map-preview">
      <img className="amap-map-preview__img" src={resolved} alt={alt} loading="lazy" />
    </div>
  );
}

function RouteStepsList({ steps }: { steps: AmapRouteStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? steps : steps.slice(0, ROUTE_STEP_PREVIEW);
  const hiddenCount = Math.max(0, steps.length - ROUTE_STEP_PREVIEW);
  return (
    <>
      <ol className="amap-route-steps">
        {visible.map((step, idx) => (
          <li key={idx} className="amap-route-step">
            <span className="amap-route-step__icon" aria-hidden>
              {stepIcon(step.kind)}
            </span>
            <span className="amap-route-step__text">{step.text}</span>
          </li>
        ))}
      </ol>
      {hiddenCount > 0 && (
        <button type="button" className="amap-steps-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起步骤' : `展开全部 ${steps.length} 步（还有 ${hiddenCount} 步）`}
        </button>
      )}
    </>
  );
}

function modeTabIcon(mode?: string): string {
  switch (String(mode || '').toLowerCase()) {
    case 'driving':
    case 'drive':
      return '🚗';
    case 'transit':
    case 'bus':
    case 'subway':
      return '🚇';
    case 'walk':
    case 'walking':
      return '🚶';
    case 'bike':
    case 'bicycling':
      return '🚲';
    default:
      return '📍';
  }
}

function AmapRouteCompareCard({ card }: { card: Extract<UiCard, { type: 'amap_route_compare' }> }) {
  const options = card.options ?? [];
  const defaultMode =
    card.recommended_mode
    || options.find((o) => !o.unavailable && o.duration_minutes != null)?.mode
    || options.find((o) => !o.unavailable)?.mode
    || options[0]?.mode
    || '';
  const [activeMode, setActiveMode] = useState(defaultMode);
  const active =
    options.find((o) => o.mode === activeMode)
    ?? options[0]
    ?? null;
  const steps = active?.steps ?? [];

  return (
    <article className="amap-card amap-card--route amap-card--compare">
      <header className="amap-card__head">
        <div className="amap-card__title-row">
          <span className="amap-card__badge">高德</span>
          <h4 className="amap-card__title">{card.title || '出行方案对比'}</h4>
        </div>
        <p className="amap-card__route-endpoints">
          <span>{card.origin || '起点'}</span>
          <span className="amap-card__arrow" aria-hidden>
            →
          </span>
          <span>{card.destination || '终点'}</span>
        </p>
      </header>
      <MapPreview
        src={card.map_image_url}
        alt={`${card.origin || '起点'} 到 ${card.destination || '终点'} 路线预览`}
      />
      <div className="amap-compare-tabs" role="tablist" aria-label="出行方式对比">
        {options.map((opt) => {
          const isActive = opt.mode === activeMode;
          const isRecommended = !opt.unavailable && opt.mode === card.recommended_mode;
          return (
            <button
              key={opt.mode || opt.mode_label}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`amap-compare-tab${isActive ? ' is-active' : ''}${opt.unavailable ? ' is-unavailable' : ''}`}
              onClick={() => opt.mode && setActiveMode(opt.mode)}
            >
              <span className="amap-compare-tab__icon" aria-hidden>
                {modeTabIcon(opt.mode)}
              </span>
              <span className="amap-compare-tab__label">{opt.mode_label || opt.mode || '方案'}</span>
              <span className="amap-compare-tab__meta">
                {opt.unavailable
                  ? '暂无方案'
                  : `${opt.duration_minutes != null ? `${opt.duration_minutes} 分钟` : '—'}${opt.distance_km != null ? ` · ${opt.distance_km} 公里` : ''}`}
              </span>
              {isRecommended ? <span className="amap-compare-tab__badge">最快</span> : null}
            </button>
          );
        })}
      </div>
      {active && (
        <>
          {active.unavailable ? (
            <p className="amap-compare-unavailable">{active.hint || '该出行方式暂无可用路线'}</p>
          ) : (
            <>
              <div className="amap-card__stats">
                {active.duration_minutes != null && (
                  <StatPill label="预计" value={`${active.duration_minutes} 分钟`} />
                )}
                {active.distance_km != null && (
                  <StatPill label="距离" value={`${active.distance_km} 公里`} />
                )}
                {active.mode_label && <StatPill label="方式" value={active.mode_label} />}
              </div>
              {steps.length > 0 && <RouteStepsList steps={steps} />}
            </>
          )}
        </>
      )}
      <footer className="amap-card__foot">
        {!active?.unavailable ? <MapLink href={active?.map_url} label="在高德地图中打开导航 →" /> : null}
        <span className="amap-card__hint">已对比驾车 / 公交地铁 / 步行 · 数据来自高德 Web 服务</span>
      </footer>
    </article>
  );
}

function AmapRouteCard({ card }: { card: Extract<UiCard, { type: 'amap_route' }> }) {
  const steps = card.steps ?? [];
  return (
    <article className="amap-card amap-card--route">
      <header className="amap-card__head">
        <div className="amap-card__title-row">
          <span className="amap-card__badge">高德</span>
          <h4 className="amap-card__title">{card.title || '出行路线'}</h4>
        </div>
        <p className="amap-card__route-endpoints">
          <span>{card.origin || '起点'}</span>
          <span className="amap-card__arrow" aria-hidden>
            →
          </span>
          <span>{card.destination || '终点'}</span>
        </p>
      </header>
      <MapPreview src={card.map_image_url} alt={`${card.origin || '起点'} 到 ${card.destination || '终点'} 路线预览`} />
      <div className="amap-card__stats">
        {card.duration_minutes != null && (
          <StatPill label="预计" value={`${card.duration_minutes} 分钟`} />
        )}
        {card.distance_km != null && <StatPill label="距离" value={`${card.distance_km} 公里`} />}
        {card.mode_label && <StatPill label="方式" value={card.mode_label} />}
      </div>
      {steps.length > 0 && <RouteStepsList steps={steps} />}
      <footer className="amap-card__foot">
        <MapLink href={card.map_url} label="在高德地图中打开导航 →" />
        <span className="amap-card__hint">数据来自高德 Web 服务 · 个人开发者有日免费额度</span>
      </footer>
    </article>
  );
}

function AmapPlacesCard({ card }: { card: Extract<UiCard, { type: 'amap_places' }> }) {
  const places = card.places ?? [];
  return (
    <article className="amap-card amap-card--places">
      <header className="amap-card__head">
        <div className="amap-card__title-row">
          <span className="amap-card__badge">高德</span>
          <h4 className="amap-card__title">{card.title || '地点'}</h4>
        </div>
        {card.subtitle && <p className="amap-card__subtitle">{card.subtitle}</p>}
      </header>
      <MapPreview src={card.map_image_url} alt={card.title || '地点分布预览'} />
      <ul className="amap-place-list">
        {places.map((place, idx) => (
          <li key={`${place.name}-${idx}`} className="amap-place-item">
            <div className="amap-place-item__main">
              <span className="amap-place-item__index">{idx + 1}</span>
              <div className="amap-place-item__body">
                <div className="amap-place-item__name">{place.name}</div>
                {place.address && <div className="amap-place-item__addr">{place.address}</div>}
              </div>
              {place.distance_m != null && (
                <span className="amap-place-item__dist">{place.distance_m}m</span>
              )}
            </div>
            {place.map_url && (
              <a className="amap-place-item__link" href={place.map_url} target="_blank" rel="noreferrer noopener">
                查看地图
              </a>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

function AmapAddressCard({ card }: { card: Extract<UiCard, { type: 'amap_address' }> }) {
  return (
    <article className="amap-card amap-card--address">
      <header className="amap-card__head">
        <div className="amap-card__title-row">
          <span className="amap-card__badge">高德</span>
          <h4 className="amap-card__title">{card.title || '地址'}</h4>
        </div>
      </header>
      <MapPreview src={card.map_image_url} alt={card.address || '地址位置预览'} />
      <p className="amap-address-text">{card.address || '—'}</p>
      {card.location && <p className="amap-address-coord">坐标 {card.location}</p>}
      <footer className="amap-card__foot">
        <MapLink href={card.map_url} label="在高德地图中查看 →" />
      </footer>
    </article>
  );
}

export function AmapReplyCards({ cards }: { cards: UiCard[] }) {
  const nodes = useMemo(() => {
    const out: ReactNode[] = [];
    for (const card of cards) {
      if (card.type === 'amap_route') {
        out.push(<AmapRouteCard key={`route-${card.origin}-${card.destination}`} card={card} />);
      } else if (card.type === 'amap_route_compare') {
        out.push(
          <AmapRouteCompareCard
            key={`compare-${card.origin}-${card.destination}`}
            card={card}
          />,
        );
      } else if (card.type === 'amap_places') {
        out.push(<AmapPlacesCard key={`places-${card.title}`} card={card} />);
      } else if (card.type === 'amap_address') {
        out.push(<AmapAddressCard key={`addr-${card.address}`} card={card} />);
      }
    }
    return out;
  }, [cards]);
  if (!nodes.length) return null;
  return <div className="amap-reply-cards">{nodes}</div>;
}

export function parseUiCards(raw: unknown): UiCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is UiCard => {
    if (!item || typeof item !== 'object') return false;
    const t = (item as { type?: string }).type;
    return t === 'amap_route' || t === 'amap_route_compare' || t === 'amap_places' || t === 'amap_address';
  });
}
