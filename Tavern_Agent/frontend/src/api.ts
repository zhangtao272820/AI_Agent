const API = "";

/** 酒品面板四维（1–10），与醉酒矩阵独立 */
export type WineStats = {
  potency: number;
  sweetness: number;
  complexity: number;
  legend: number;
};

export const WINE_STAT_KEYS = ["potency", "sweetness", "complexity", "legend"] as const;

export const DEFAULT_WINE_STAT_LABELS: Record<(typeof WINE_STAT_KEYS)[number], string> = {
  potency: "烈度",
  sweetness: "甜度",
  complexity: "层次",
  legend: "传奇",
};

export type Wine = {
  id: string;
  name: string;
  tagline: string;
  abv_hint: string;
  flavor_notes: string;
  imageUrl: string;
  stats: WineStats;
};

export type Character = {
  id: string;
  name: string;
  role: string;
  archetype: string;
  catchphrase: string;
  imageUrl: string;
};

export type Catalog = {
  wines: Wine[];
  characters: Character[];
  wineStatLabels?: Partial<Record<(typeof WINE_STAT_KEYS)[number], string>>;
};

export async function fetchCatalog(): Promise<Catalog> {
  const r = await fetch(`${API}/api/catalog`);
  if (!r.ok) throw new Error(`catalog ${r.status}`);
  return r.json();
}

export type Behavior = {
  chatter: number;
  mood_swing: number;
  aggression: number;
  artsy: number;
  confusion: number;
};

export async function fetchMatrix(characterId: string, wineId: string): Promise<{ behavior: Behavior }> {
  const r = await fetch(`${API}/api/matrix/${characterId}/${wineId}`);
  if (!r.ok) throw new Error(`matrix ${r.status}`);
  return r.json();
}

export async function sendChat(body: {
  wine_id: string;
  character_id: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<{ reply: string; meta: unknown }> {
  const r = await fetch(`${API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || `chat ${r.status}`);
  }
  return r.json();
}
