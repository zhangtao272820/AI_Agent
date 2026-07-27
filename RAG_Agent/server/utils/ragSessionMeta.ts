import fs from "node:fs/promises";
import path from "node:path";
import { agentPgQuery } from "#agent-shared/agentPgClient";
import { isPostgresStorageEnabled, resolveStorageBackend } from "#agent-shared/storageBackend";

export type RagSessionMeta = {
  title?: string;
  customTitle?: boolean;
  updatedAt?: string;
};

const META_DIR = "rag-session-meta";

function metaFilePath(dataRoot: string, sessionId: string) {
  return path.join(dataRoot, META_DIR, `${sessionId}.json`);
}

export function sanitizeRagSessionTitle(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > 80 ? s.slice(0, 80) : s;
}

export async function readRagSessionMeta(dataRoot: string, sessionId: string): Promise<RagSessionMeta> {
  const sid = String(sessionId || "").trim();
  if (!sid) return {};

  const backend = resolveStorageBackend(process.env.RAG_AGENT_STORAGE_BACKEND, "file");
  if (isPostgresStorageEnabled(backend)) {
    const res = await agentPgQuery<{ title: string | null; custom_title: boolean; updated_at: Date | string }>(
      `SELECT title, custom_title, updated_at FROM rag_sessions WHERE id = $1`,
      [sid]
    );
    const row = res?.rows?.[0];
    if (row) {
      const title = sanitizeRagSessionTitle(row.title);
      const ts = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || "");
      return {
        title: title || undefined,
        customTitle: Boolean(row.custom_title && title),
        updatedAt: ts || undefined,
      };
    }
  }

  try {
    const raw = await fs.readFile(metaFilePath(dataRoot, sid), "utf8");
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return {};
    const title = sanitizeRagSessionTitle((obj as RagSessionMeta).title);
    return {
      title: title || undefined,
      customTitle: Boolean((obj as RagSessionMeta).customTitle),
      updatedAt: String((obj as RagSessionMeta).updatedAt || "") || undefined,
    };
  } catch {
    return {};
  }
}

export async function writeRagSessionMeta(dataRoot: string, sessionId: string, meta: RagSessionMeta) {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const title = sanitizeRagSessionTitle(meta.title);
  if (!title) return;

  const backend = resolveStorageBackend(process.env.RAG_AGENT_STORAGE_BACKEND, "file");
  if (isPostgresStorageEnabled(backend)) {
    await agentPgQuery(
      `INSERT INTO rag_sessions (id, title, custom_title, updated_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         custom_title = true,
         updated_at = NOW()`,
      [sid, title]
    );
  }

  await fs.mkdir(path.join(dataRoot, META_DIR), { recursive: true }).catch(() => undefined);
  const payload: RagSessionMeta = {
    title,
    customTitle: true,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(metaFilePath(dataRoot, sid), JSON.stringify(payload, null, 2), "utf8");
}

export async function deleteRagSessionArtifacts(sessionId: string) {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const dataRoot = path.join(process.cwd(), ".data");
  await fs.unlink(metaFilePath(dataRoot, sid)).catch(() => undefined);
  await fs.unlink(path.join(dataRoot, "rag-sessions", `${sid}.json`)).catch(() => undefined);
}
