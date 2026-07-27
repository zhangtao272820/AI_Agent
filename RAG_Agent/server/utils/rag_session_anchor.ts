/**
 * RAG 会话检索锚点：进程内 + 文件缓存（无需 PG 迁移）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RagSessionRetrievalAnchor } from "./rag_multi_turn";

const MAX_ANCHORS = 200;
const ANCHOR_TTL_MS = 1000 * 60 * 60 * 6;

let anchorCache: Record<string, RagSessionRetrievalAnchor> | null = null;

function anchorFile(): string {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "rag-retrieval-anchors.json");
}

function loadStore(): Record<string, RagSessionRetrievalAnchor> {
  const p = anchorFile();
  if (!existsSync(p)) return {};
  try {
    const o = JSON.parse(readFileSync(p, "utf8"));
    return o && typeof o === "object" ? (o as Record<string, RagSessionRetrievalAnchor>) : {};
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, RagSessionRetrievalAnchor>) {
  const now = Date.now();
  const entries = Object.entries(store).filter(([, v]) => {
    const ts = Date.parse(String(v.updatedAt || ""));
    return Number.isFinite(ts) && now - ts <= ANCHOR_TTL_MS;
  });
  entries.sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt));
  writeFileSync(anchorFile(), JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ANCHORS)), null, 0), "utf8");
}

function getStore(): Record<string, RagSessionRetrievalAnchor> {
  if (!anchorCache) anchorCache = loadStore();
  return anchorCache;
}

export function getRagSessionRetrievalAnchor(sessionId: string): RagSessionRetrievalAnchor | null {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const hit = getStore()[id];
  if (!hit) return null;
  const ts = Date.parse(String(hit.updatedAt || ""));
  if (!Number.isFinite(ts) || Date.now() - ts > ANCHOR_TTL_MS) {
    delete getStore()[id];
    saveStore(getStore());
    return null;
  }
  return hit;
}

export function setRagSessionRetrievalAnchor(sessionId: string, anchor: RagSessionRetrievalAnchor): void {
  const id = String(sessionId || "").trim();
  if (!id) return;
  const store = getStore();
  store[id] = anchor;
  saveStore(store);
}

export function clearRagSessionRetrievalAnchor(sessionId: string): void {
  const id = String(sessionId || "").trim();
  if (!id) return;
  delete getStore()[id];
  saveStore(getStore());
}
