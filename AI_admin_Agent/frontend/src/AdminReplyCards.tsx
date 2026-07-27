import { AmapReplyCards, type UiCard as AmapUiCard } from './AmapReplyCards';
import { SearchReplyCards, type WebSearchCard } from './SearchReplyCards';
import { PlayReplyCards, type PlayUiCard } from './PlayReplyCards';

export type AdminUiCard = AmapUiCard | WebSearchCard | PlayUiCard;

const PLAY_TYPES = new Set([
  'hot_topics',
  'bilibili_search',
  'arxiv_search',
  'fetch_url',
  'memory_graph',
  'thinking_outline',
]);

export function parseAdminUiCards(raw: unknown): AdminUiCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === 'object' && typeof (c as { type?: string }).type === 'string') as AdminUiCard[];
}

export function AdminReplyCards({ cards }: { cards: AdminUiCard[] }) {
  const searchCards = cards.filter((c) => c.type === 'web_search') as WebSearchCard[];
  const amapCards = cards.filter((c) => String(c.type || '').startsWith('amap_')) as AmapUiCard[];
  const playCards = cards.filter((c) => PLAY_TYPES.has(String(c.type || ''))) as PlayUiCard[];
  return (
    <>
      {playCards.length > 0 ? <PlayReplyCards cards={playCards} /> : null}
      {searchCards.length > 0 ? <SearchReplyCards cards={searchCards} /> : null}
      {amapCards.length > 0 ? <AmapReplyCards cards={amapCards} /> : null}
    </>
  );
}
