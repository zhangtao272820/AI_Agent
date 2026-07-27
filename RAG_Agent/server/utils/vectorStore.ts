import type { OpenAIEmbeddings } from "@langchain/openai";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { getRagEmbeddings } from "./embedding_query_cache";
import { createRagChatOpenAI } from "./rag_chat_openai";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { splitDocumentsStructured } from "./chunk_text";
import { getRagAgentEnv } from "./rag_agent_env";
import { rankBm25Docs, type Bm25Hit } from "./bm25_lexical";
import { performOCR } from "./ocr";
import { looksLikeHtmlDocument, stripHtmlToPlainText } from "./html_text";
import { extractPptxText, isLegacyPptOle } from "./pptx_text";

const DATA_DIR = path.join(process.cwd(), ".data");
const VECTOR_STORE_PATH = path.join(DATA_DIR, "vector_store.json");
const DOCS_METADATA_PATH = path.join(DATA_DIR, "docs_metadata.json");
const LEGACY_VECTOR_STORE_PATH = path.join(process.cwd(), "data/vector_store.json");
const LEGACY_DOCS_METADATA_PATH = path.join(process.cwd(), "data/docs_metadata.json");

type AnyVectorStore = MemoryVectorStore | PGVectorStore;

/** 分批写入向量库，兼容 DashScope 等 embedding API 的 batch≤10 限制 */
const addDocumentsInBatches = async (store: AnyVectorStore, docs: any[]) => {
  if (!docs.length) return;
  const batchSize = getRagAgentEnv().embeddingBatchSize;
  for (let i = 0; i < docs.length; i += batchSize) {
    await store.addDocuments(docs.slice(i, i + batchSize));
  }
};

let vectorStore: AnyVectorStore | null = null;
let vectorBackend: "memory" | "pgvector" = "memory";
let pgPool: Pool | null = null;
let uploadedDocuments: { name: string; summary?: string; type: string }[] = [];
export type KeywordCandidate = {
  pageContent: string;
  metadata: Record<string, any>;
  matchedTerms: number;
};

type ProcessLimits = {
  maxUploadBytes: number;
  maxZipEntries: number;
  maxZipTotalUncompressedBytes: number;
  maxTotalChunks: number;
  totalChunks: number;
  totalZipEntries: number;
  totalZipUncompressedBytes: number;
};

const getDefaultLimits = (): ProcessLimits => ({
  maxUploadBytes: parseInt(process.env.MAX_UPLOAD_BYTES ?? "52428800"),
  maxZipEntries: parseInt(process.env.MAX_ZIP_ENTRIES ?? "200"),
  maxZipTotalUncompressedBytes: parseInt(process.env.MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES ?? "209715200"),
  maxTotalChunks: parseInt(process.env.MAX_TOTAL_CHUNKS ?? "5000"),
  totalChunks: 0,
  totalZipEntries: 0,
  totalZipUncompressedBytes: 0,
});

const envBool = (v: any, defaultValue: boolean) => {
  if (v === undefined || v === null || v === "") return defaultValue;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return defaultValue;
};

const normalizeBackend = (v: any): "memory" | "pgvector" => {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "pg" || s === "postgres" || s === "pgvector") return "pgvector";
  return "memory";
};

const sanitizeIdentifier = (input: string, fallback: string) => {
  const s = String(input || "").trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) ? s : fallback;
};

// 确保持久化目录存在（Docker 挂载 /app/.data）
const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const migrateLegacyDataFiles = () => {
  ensureDataDir();
  if (!fs.existsSync(DOCS_METADATA_PATH) && fs.existsSync(LEGACY_DOCS_METADATA_PATH)) {
    try {
      fs.copyFileSync(LEGACY_DOCS_METADATA_PATH, DOCS_METADATA_PATH);
      console.log("[Disk] Migrated legacy docs_metadata.json -> .data/");
    } catch (e) {
      console.warn("[Disk] Legacy docs metadata migration failed:", e);
    }
  }
  if (!fs.existsSync(VECTOR_STORE_PATH) && fs.existsSync(LEGACY_VECTOR_STORE_PATH)) {
    try {
      fs.copyFileSync(LEGACY_VECTOR_STORE_PATH, VECTOR_STORE_PATH);
      console.log("[Disk] Migrated legacy vector_store.json -> .data/");
    } catch (e) {
      console.warn("[Disk] Legacy vector store migration failed:", e);
    }
  }
};

const loadDocsMetadataFromDisk = () => {
  migrateLegacyDataFiles();
  if (!fs.existsSync(DOCS_METADATA_PATH)) return;
  try {
    uploadedDocuments = JSON.parse(fs.readFileSync(DOCS_METADATA_PATH, "utf-8"));
  } catch (e) {
    console.warn("[Disk] Failed to load docs metadata, reset to empty:", e);
    uploadedDocuments = [];
  }
};

const syncMetadataFromPgIfEmpty = async (pool: Pool, tableName: string, metadataColumnName: string) => {
  if (uploadedDocuments.length > 0) return;
  try {
    const res = await pool.query(
      `SELECT DISTINCT "${metadataColumnName}"->>'source' AS src FROM "${tableName}" WHERE "${metadataColumnName}"->>'source' IS NOT NULL`
    );
    const names = (res.rows ?? [])
      .map((r: { src?: string }) => String(r?.src ?? "").trim())
      .filter(Boolean);
    if (!names.length) return;
    uploadedDocuments = names.map((name) => ({
      name,
      type: name.includes(".") ? String(name.split(".").pop() || "unknown") : "unknown",
    }));
    saveDocsMetadataToDisk();
    console.log(`[PGVector] Rebuilt docs metadata from ${names.length} distinct sources.`);
  } catch (e) {
    console.warn("[PGVector] syncMetadataFromPgIfEmpty skipped:", e);
  }
};

const saveDocsMetadataToDisk = () => {
  ensureDataDir();
  fs.writeFileSync(DOCS_METADATA_PATH, JSON.stringify(uploadedDocuments));
};

/**
 * 持久化保存向量数据和元数据
 */
const saveToDisk = async () => {
  if (!vectorStore) return;
  ensureDataDir();
  // 文档元数据始终落盘（用于文档列表）
  saveDocsMetadataToDisk();
  if (vectorBackend === "memory") {
    // MemoryVectorStore 的简单持久化方案
    const memoryStore = vectorStore as MemoryVectorStore;
    const data = JSON.stringify(memoryStore.memoryVectors);
    fs.writeFileSync(VECTOR_STORE_PATH, data);
  }
  console.log(`[Disk] Saved metadata for ${uploadedDocuments.length} docs (backend=${vectorBackend}).`);
};

/**
 * 从磁盘加载向量数据和元数据
 */
const loadMemoryFromDisk = async (embeddings: OpenAIEmbeddings) => {
  ensureDataDir();
  loadDocsMetadataFromDisk();

  const store = new MemoryVectorStore(embeddings);
  
  // 加载向量数据
  if (fs.existsSync(VECTOR_STORE_PATH)) {
    const vectors = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, "utf-8"));
    store.memoryVectors = vectors;
    console.log(`[Disk] Loaded ${vectors.length} vectors from disk.`);
  }
  
  return store;
};

const getPgRuntimeConfig = () => {
  const connectionString = String(process.env.RAG_PG_CONNECTION_STRING ?? "").trim();
  if (!connectionString) {
    throw new Error("RAG_PG_CONNECTION_STRING is required when RAG_VECTOR_BACKEND=pgvector");
  }
  const tableName = sanitizeIdentifier(process.env.RAG_PG_TABLE_NAME ?? "rag_documents", "rag_documents");
  const idColumnName = sanitizeIdentifier(process.env.RAG_PG_ID_COLUMN ?? "id", "id");
  const vectorColumnName = sanitizeIdentifier(process.env.RAG_PG_VECTOR_COLUMN ?? "embedding", "embedding");
  const contentColumnName = sanitizeIdentifier(process.env.RAG_PG_CONTENT_COLUMN ?? "content", "content");
  const metadataColumnName = sanitizeIdentifier(process.env.RAG_PG_METADATA_COLUMN ?? "metadata", "metadata");
  const max = Number.parseInt(process.env.RAG_PG_POOL_MAX ?? "10", 10);
  const trigramThresholdRaw = Number.parseFloat(process.env.RAG_PG_TRGM_THRESHOLD ?? "0.12");
  return {
    connectionString,
    tableName,
    idColumnName,
    vectorColumnName,
    contentColumnName,
    metadataColumnName,
    poolMax: Number.isFinite(max) ? max : 10,
    trigramThreshold: Number.isFinite(trigramThresholdRaw) ? trigramThresholdRaw : 0.12,
  };
};

const getPgTableCount = async (pool: Pool, tableName: string) => {
  const res = await pool.query(`SELECT COUNT(*)::int AS c FROM "${tableName}"`);
  return Number(res.rows?.[0]?.c ?? 0);
};

const toPgJson = (v: any): Record<string, any> => {
  if (!v) return {};
  if (typeof v === "object") return v as Record<string, any>;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return {};
};

const migrateLegacyMemoryFileToPgIfNeeded = async (
  store: PGVectorStore,
  pool: Pool,
  tableName: string
) => {
  const enableMigration = envBool(process.env.RAG_MIGRATE_LEGACY_MEMORY_ON_BOOT, true);
  if (!enableMigration) return;
  if (!fs.existsSync(VECTOR_STORE_PATH)) return;
  const currentRows = await getPgTableCount(pool, tableName);
  if (currentRows > 0) return;

  try {
    const vectors = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, "utf-8"));
    if (!Array.isArray(vectors) || vectors.length === 0) return;
    const { Document } = await import("@langchain/core/documents");
    const docs = vectors
      .map((v: any) => {
        const pageContent = String(v?.content ?? v?.pageContent ?? "").trim();
        if (!pageContent) return null;
        const metadata = v?.metadata ?? {};
        return new Document({ pageContent, metadata });
      })
      .filter(Boolean);
    if (docs.length === 0) return;
    await addDocumentsInBatches(store, docs as any);
    console.log(`[PGVector] Migrated ${docs.length} legacy vectors from disk to "${tableName}".`);
  } catch (e) {
    console.warn("[PGVector] Legacy memory migration skipped due to parse/import error:", e);
  }
};

const loadPgVectorStore = async (embeddings: OpenAIEmbeddings) => {
  loadDocsMetadataFromDisk();
  const cfg = getPgRuntimeConfig();
  const pool = new Pool({
    connectionString: cfg.connectionString,
    max: cfg.poolMax,
  });
  pgPool = pool;
  // pgvector 镜像通常已预装 extension；确保扩展存在，便于首次启动
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  const store = await PGVectorStore.initialize(embeddings, {
    postgresConnectionOptions: {
      connectionString: cfg.connectionString,
    },
    tableName: cfg.tableName,
    columns: {
      idColumnName: cfg.idColumnName,
      vectorColumnName: cfg.vectorColumnName,
      contentColumnName: cfg.contentColumnName,
      metadataColumnName: cfg.metadataColumnName,
    },
  });
  const trigramIndexName = sanitizeIdentifier(
    `${cfg.tableName}_${cfg.contentColumnName}_trgm_idx`,
    "rag_documents_content_trgm_idx"
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS "${trigramIndexName}" ON "${cfg.tableName}" USING GIN ("${cfg.contentColumnName}" gin_trgm_ops)`
  );
  await migrateLegacyMemoryFileToPgIfNeeded(store, pool, cfg.tableName);
  await syncMetadataFromPgIfEmpty(pool, cfg.tableName, cfg.metadataColumnName);
  const rows = await getPgTableCount(pool, cfg.tableName);
  console.log(`[PGVector] Connected table "${cfg.tableName}", rows=${rows}.`);
  return store;
};

export const getUploadedDocuments = async () => {
  // 确保向量存储已加载，这样元数据也会被加载
  await getVectorStore();
  return uploadedDocuments;
};

export const deleteDocument = async (fileName: string) => {
  // 确保向量存储已加载，这样元数据也会被加载
  await getVectorStore();
  
  const index = uploadedDocuments.findIndex(d => d.name === fileName);
  if (index !== -1) {
    uploadedDocuments.splice(index, 1);
    
    if (vectorStore) {
      if (vectorBackend === "memory") {
        // MemoryVectorStore：过滤内存向量实现删除
        const memoryStore = vectorStore as MemoryVectorStore;
        memoryStore.memoryVectors = memoryStore.memoryVectors.filter(
          (v) => v.metadata.source !== fileName
        );
      } else {
        // PGVector：按 metadata.source 物理删除
        const cfg = getPgRuntimeConfig();
        const col = cfg.metadataColumnName;
        if (pgPool) {
          await pgPool.query(
            `DELETE FROM "${cfg.tableName}" WHERE COALESCE("${col}"->>'source','') = $1`,
            [fileName]
          );
        }
      }
      await saveToDisk();
    }
    return true;
  }
  return false;
};

export const getVectorStore = async () => {
  if (!vectorStore) {
    const embeddings = getRagEmbeddings();
    vectorBackend = normalizeBackend(process.env.RAG_VECTOR_BACKEND ?? "memory");
    vectorStore =
      vectorBackend === "pgvector"
        ? await loadPgVectorStore(embeddings)
        : await loadMemoryFromDisk(embeddings);
    console.log(`[VectorStore] backend=${vectorBackend}`);
  }
  return vectorStore;
};

export const getVectorBackend = async (): Promise<"memory" | "pgvector"> => {
  await getVectorStore();
  return vectorBackend;
};

export type VectorStoreHealthAudit = {
  backend: "memory" | "pgvector";
  metadataDocCount: number;
  vectorRowCount: number | null;
  pgDistinctSources: number | null;
  memoryVectorCount: number | null;
  consistent: boolean;
  reconciled: boolean;
  warnings: string[];
};

/** pgvector / memory 与 docs_metadata 对账；ready 探针可调用 */
export async function auditVectorStoreHealth(opts?: { reconcile?: boolean }): Promise<VectorStoreHealthAudit> {
  await getVectorStore();
  const warnings: string[] = [];
  let reconciled = false;
  let vectorRowCount: number | null = null;
  let pgDistinctSources: number | null = null;
  let memoryVectorCount: number | null = null;

  if (vectorBackend === "pgvector" && pgPool) {
    const cfg = getPgRuntimeConfig();
    vectorRowCount = await getPgTableCount(pgPool, cfg.tableName);
    try {
      const res = await pgPool.query(
        `SELECT COUNT(DISTINCT "${cfg.metadataColumnName}"->>'source')::int AS c FROM "${cfg.tableName}" WHERE "${cfg.metadataColumnName}"->>'source' IS NOT NULL`
      );
      pgDistinctSources = Number(res.rows?.[0]?.c ?? 0);
    } catch {
      warnings.push("pg_distinct_source_query_failed");
    }
    if (opts?.reconcile !== false && uploadedDocuments.length === 0 && (pgDistinctSources ?? 0) > 0) {
      await syncMetadataFromPgIfEmpty(pgPool, cfg.tableName, cfg.metadataColumnName);
      reconciled = uploadedDocuments.length > 0;
    }
    if (uploadedDocuments.length > 0 && vectorRowCount === 0) {
      warnings.push("metadata_has_docs_but_pg_empty");
    }
    if (
      (pgDistinctSources ?? 0) > 0 &&
      uploadedDocuments.length > 0 &&
      uploadedDocuments.length !== pgDistinctSources
    ) {
      warnings.push("metadata_pg_source_count_mismatch");
    }
  } else if (vectorStore) {
    const mem = vectorStore as MemoryVectorStore;
    memoryVectorCount = Array.isArray(mem.memoryVectors) ? mem.memoryVectors.length : 0;
    vectorRowCount = memoryVectorCount;
    if (uploadedDocuments.length > 0 && memoryVectorCount === 0) {
      warnings.push("metadata_has_docs_but_memory_empty");
    }
    if (fs.existsSync(VECTOR_STORE_PATH) && memoryVectorCount === 0 && uploadedDocuments.length === 0) {
      warnings.push("legacy_vector_file_present_but_empty_memory");
    }
  }

  return {
    backend: vectorBackend,
    metadataDocCount: uploadedDocuments.length,
    vectorRowCount,
    pgDistinctSources,
    memoryVectorCount,
    consistent: warnings.length === 0,
    reconciled,
    warnings,
  };
};

export const searchKeywordCandidates = async (params: {
  terms: string[];
  sources?: string[];
  limit?: number;
}): Promise<KeywordCandidate[]> => {
  await getVectorStore();
  const terms = Array.from(new Set((params.terms ?? []).map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)));
  if (!terms.length) return [];
  const limit = Math.max(1, Math.min(200, Math.floor(Number(params.limit ?? 24))));
  const sourceFilters = Array.from(new Set((params.sources ?? []).map((s) => String(s || "").trim()).filter(Boolean)));

  const searchFromMemoryFile = (): KeywordCandidate[] => {
    if (!fs.existsSync(VECTOR_STORE_PATH)) return [];
    try {
      const vectors = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, "utf-8"));
      if (!Array.isArray(vectors)) return [];
      const out: KeywordCandidate[] = [];
      for (const vec of vectors) {
        const metadata = (vec?.metadata ?? {}) as Record<string, any>;
        const source = String(metadata?.source ?? "");
        if (sourceFilters.length > 0 && !sourceFilters.includes(source)) continue;
        const content = String(vec?.content ?? vec?.pageContent ?? "");
        const lc = content.toLowerCase();
        if (!lc) continue;
        let matched = 0;
        for (const term of terms) {
          if (lc.includes(term)) matched += 1;
        }
        if (!matched) continue;
        out.push({
          pageContent: content,
          metadata,
          matchedTerms: matched,
        });
      }
      out.sort((a, b) => b.matchedTerms - a.matchedTerms || a.pageContent.length - b.pageContent.length);
      return out.slice(0, limit);
    } catch (e) {
      console.warn("[KeywordFallback] Failed to search local vector_store.json:", e);
      return [];
    }
  };

  if (vectorBackend === "pgvector" && pgPool) {
    const cfg = getPgRuntimeConfig();
    const contentCol = cfg.contentColumnName;
    const metadataCol = cfg.metadataColumnName;
    const sourceClause =
      sourceFilters.length > 0
        ? `AND COALESCE("${metadataCol}"->>'source','') = ANY($2::text[])`
        : "";
    const sql = `
      SELECT
        "${contentCol}" AS content,
        "${metadataCol}" AS metadata,
        (
          SELECT COUNT(*)
          FROM unnest($1::text[]) AS term
          WHERE lower("${contentCol}") LIKE '%' || term || '%'
        )::int AS matched
        ,
        (
          SELECT COALESCE(SUM(similarity(lower("${contentCol}"), term)), 0)
          FROM unnest($1::text[]) AS term
        )::float AS sim
      FROM "${cfg.tableName}"
      WHERE (
        SELECT COALESCE(COUNT(*), 0)
        FROM unnest($1::text[]) AS term
        WHERE
          lower("${contentCol}") LIKE '%' || term || '%'
          OR similarity(lower("${contentCol}"), term) >= $${sourceFilters.length > 0 ? "3" : "2"}
      ) > 0
      ${sourceClause}
      ORDER BY matched DESC, sim DESC, length("${contentCol}") ASC
      LIMIT $${sourceFilters.length > 0 ? "4" : "3"}
    `;
    const values: any[] = [terms];
    if (sourceFilters.length > 0) values.push(sourceFilters);
    values.push(cfg.trigramThreshold);
    values.push(limit);
    const rows = (await pgPool.query(sql, values)).rows ?? [];
    const pgResults: KeywordCandidate[] = rows.map((r: any) => ({
      pageContent: String(r?.content ?? ""),
      metadata: toPgJson(r?.metadata),
      matchedTerms: Number(r?.matched ?? 0),
    }));
    if (pgResults.length > 0) return pgResults;
    // PG 未命中时回退到本地向量文件关键词检索，兜住迁移/编码/过滤异常。
    return searchFromMemoryFile();
  }

  const memoryStore = vectorStore as MemoryVectorStore;
  const memoryVectors = (memoryStore as any)?.memoryVectors ?? [];
  const out: KeywordCandidate[] = [];
  for (const vec of memoryVectors) {
    const metadata = (vec?.metadata ?? {}) as Record<string, any>;
    const source = String(metadata?.source ?? "");
    if (sourceFilters.length > 0 && !sourceFilters.includes(source)) continue;
    const content = String(vec?.content ?? "");
    const lc = content.toLowerCase();
    if (!lc) continue;
    let matched = 0;
    for (const term of terms) {
      if (lc.includes(term)) matched += 1;
    }
    if (!matched) continue;
    out.push({
      pageContent: content,
      metadata,
      matchedTerms: matched,
    });
  }
  out.sort((a, b) => b.matchedTerms - a.matchedTerms || a.pageContent.length - b.pageContent.length);
  const memoryResults = out.slice(0, limit);
  if (memoryResults.length > 0) return memoryResults;
  return searchFromMemoryFile();
};

export type Bm25Candidate = Bm25Hit;

/** BM25 词法检索（进程内；与向量结果 RRF 融合） */
export const searchBm25Candidates = async (params: {
  terms: string[];
  sources?: string[];
  limit?: number;
}): Promise<Bm25Candidate[]> => {
  await getVectorStore();
  const terms = Array.from(new Set((params.terms ?? []).map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)));
  if (!terms.length) return [];
  const limit = Math.max(1, Math.min(200, Math.floor(Number(params.limit ?? 24))));
  const sourceFilters = Array.from(new Set((params.sources ?? []).map((s) => String(s || "").trim()).filter(Boolean)));

  const collectDocs = (): { pageContent: string; metadata: Record<string, unknown> }[] => {
    const docs: { pageContent: string; metadata: Record<string, unknown> }[] = [];
    const memoryStore = vectorStore as MemoryVectorStore;
    const memoryVectors = (memoryStore as any)?.memoryVectors ?? [];
    for (const vec of memoryVectors) {
      const metadata = (vec?.metadata ?? {}) as Record<string, unknown>;
      const source = String(metadata?.source ?? "");
      if (sourceFilters.length > 0 && !sourceFilters.includes(source)) continue;
      const content = String(vec?.content ?? "");
      if (!content.trim()) continue;
      docs.push({ pageContent: content, metadata });
    }
    if (docs.length) return docs;
    if (!fs.existsSync(VECTOR_STORE_PATH)) return [];
    try {
      const vectors = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, "utf-8"));
      if (!Array.isArray(vectors)) return [];
      for (const vec of vectors) {
        const metadata = (vec?.metadata ?? {}) as Record<string, unknown>;
        const source = String(metadata?.source ?? "");
        if (sourceFilters.length > 0 && !sourceFilters.includes(source)) continue;
        const content = String(vec?.content ?? vec?.pageContent ?? "");
        if (!content.trim()) continue;
        docs.push({ pageContent: content, metadata });
      }
    } catch {
      return [];
    }
    return docs;
  };

  return rankBm25Docs(collectDocs(), terms, limit);
};

const generateSummary = async (text: string) => {
  const model = createRagChatOpenAI({
    modelName: getRagAgentEnv().summaryModel,
    maxTokens: 200,
    jsonTask: true,
  });
  
  const response = await model.invoke(`请为以下文档内容生成一个简短的摘要（不超过100字）：\n\n${text.substring(0, 3000)}`);
  return response.content.toString();
};

/**
 * 文档处理服务
 * 对应架构图中的：文档解析服务 -> 文本分块 -> 向量化存储
 */
export const processDocument = async (file: Blob | Buffer, fileName: string, limits?: ProcessLimits): Promise<number> => {
  const normalizeFilename = (name: string) => {
    const s = String(name || "").trim();
    if (!s) return "unknown";
    const looksBroken = /[\u0000-\u001f\u007f-\u00ff]/.test(s);
    if (!looksBroken) return s;
    try {
      const recovered = Buffer.from(s, "latin1").toString("utf8").trim();
      return recovered || s;
    } catch {
      return s;
    }
  };

  fileName = normalizeFilename(fileName);
  const buffer = file instanceof Buffer ? file : Buffer.from(await (file as Blob).arrayBuffer());
  console.log(`[Process] Parsing: ${fileName}, Size: ${buffer.length} bytes, Magic: ${buffer.slice(0, 4).toString('hex')}`);
  
  const effectiveLimits = limits ?? getDefaultLimits();

  if (buffer.length > effectiveLimits.maxUploadBytes) {
    throw new Error(`File too large: ${buffer.length} > ${effectiveLimits.maxUploadBytes}`);
  }

  let fileType = fileName.split('.').pop()?.toLowerCase() || 'unknown';
  if (fileType === "zip") {
    try {
      if (buffer.slice(0, 4).toString('hex') !== "504b0304") {
        throw new Error("Invalid .zip file: magic number mismatch");
      }
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      console.log(`[ZIP] Found ${zipEntries.length} entries in ${fileName}`);
      
      if (zipEntries.length > effectiveLimits.maxZipEntries) {
        throw new Error(`ZIP too many entries: ${zipEntries.length} > ${effectiveLimits.maxZipEntries}`);
      }

      let totalChunks = 0;
      for (const entry of zipEntries) {
        const entryName = normalizeFilename(entry.name);
        if (!entry.isDirectory && (
          entryName.endsWith(".txt") || 
          entryName.endsWith(".pdf") || 
          entryName.endsWith(".docx") ||
          entryName.endsWith(".md") ||
          entryName.endsWith(".csv") ||
          entryName.endsWith(".xlsx") ||
          entryName.endsWith(".xls") ||
          entryName.endsWith(".json") ||
          entryName.endsWith(".html") ||
          entryName.endsWith(".htm") ||
          entryName.endsWith(".pptx") ||
          entryName.endsWith(".png") ||
          entryName.endsWith(".jpg") ||
          entryName.endsWith(".jpeg") ||
          entryName.endsWith(".bmp") ||
          entryName.endsWith(".tiff")
        )) {
          const data = entry.getData();
          effectiveLimits.totalZipEntries += 1;
          effectiveLimits.totalZipUncompressedBytes += data.length;
          if (effectiveLimits.totalZipUncompressedBytes > effectiveLimits.maxZipTotalUncompressedBytes) {
            throw new Error(`ZIP uncompressed data too large: ${effectiveLimits.totalZipUncompressedBytes} > ${effectiveLimits.maxZipTotalUncompressedBytes}`);
          }
          totalChunks += await processDocument(data, entryName, effectiveLimits);
        }
      }
      return totalChunks;
    } catch (zipErr: any) {
      console.error(`[ZIP Error] ${fileName}:`, zipErr.message);
      throw zipErr;
    }
  }

  const store = await getVectorStore();
  let docs = [];

  try {
    // 1. 文档解析服务 (拓展更多格式)
    if (fileType === "pdf") {
      const pdfParseModule: any = await import("pdf-parse");
      // pdf-parse v2+ exports a PDFParse class; older versions export a callable function.
      const PDFParseCtor =
        pdfParseModule?.PDFParse ??
        pdfParseModule?.default?.PDFParse ??
        null;

      let text = "";
      if (typeof PDFParseCtor === "function") {
        const parser = new PDFParseCtor({ data: buffer });
        try {
          const textResult = await parser.getText();
          text = textResult?.text ?? "";
          const pages = Array.isArray(textResult?.pages) ? textResult.pages : [];
          if (pages.length > 0) {
            const { Document } = await import("@langchain/core/documents");
            docs = pages
              .map((page: any) => {
                const pageText = String(page?.text ?? "").trim();
                if (!pageText) return null;
                return new Document({
                  pageContent: pageText,
                  metadata: {
                    source: fileName,
                    fileType,
                    page: page?.num ?? undefined,
                  },
                });
              })
              .filter(Boolean);
          }
        } finally {
          if (typeof parser.destroy === "function") {
            await parser.destroy();
          }
        }
      } else {
        const pdfParseFn = pdfParseModule?.default ?? pdfParseModule;
        if (typeof pdfParseFn !== "function") {
          throw new Error("pdf-parse export is not callable and PDFParse class not found");
        }
        const parsed = await pdfParseFn(buffer);
        text = parsed?.text ?? "";
      }
      if (docs.length === 0) {
        const { Document } = await import("@langchain/core/documents");
        docs = [new Document({ pageContent: text, metadata: { source: fileName, fileType } })];
      }
    } else if (fileType === "docx" || fileType === "doc") {
      const magic = buffer.slice(0, 4).toString('hex');
      const { Document } = await import("@langchain/core/documents");
      
      if (magic === "504b0304") {
        // Modern .docx (ZIP structure)
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buffer });
        docs = [new Document({ pageContent: result.value, metadata: { source: fileName, fileType } })];
      } else if (magic === "d0cf11e0") {
        // Legacy .doc (OLECF structure)
        const WordExtractor = (await import("word-extractor")).default;
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        docs = [new Document({ pageContent: extracted.getBody(), metadata: { source: fileName, fileType } })];
      } else {
        throw new Error(`Unsupported Word format: Magic number ${magic} not recognized for ${fileName}`);
      }
    } else if (["png", "jpg", "jpeg", "bmp", "tiff", "gif", "webp"].includes(fileType)) {
      // 1.2 OCR 识别 (针对扫描件/图片)
      const text = await performOCR(buffer, fileName);
      const { Document } = await import("@langchain/core/documents");
      docs = [new Document({ pageContent: text, metadata: { source: fileName, isOCR: true, fileType } })];
    } else if (fileType === "xlsx" || fileType === "xls") {
      const { parseSpreadsheetBuffer } = await import("./spreadsheet_parse");
      const text = parseSpreadsheetBuffer(buffer, fileName);
      const { Document } = await import("@langchain/core/documents");
      docs = [new Document({ pageContent: text, metadata: { source: fileName, fileType } })];
    } else if (fileType === "pptx") {
      const text = await extractPptxText(buffer);
      if (!text.trim()) throw new Error(`PPTX 未解析到文本内容: ${fileName}`);
      const { Document } = await import("@langchain/core/documents");
      docs = [new Document({ pageContent: text, metadata: { source: fileName, fileType: "pptx" } })];
    } else if (fileType === "ppt" || isLegacyPptOle(buffer)) {
      throw new Error(`旧版 .ppt 暂不支持，请将 ${fileName} 另存为 .pptx 后上传`);
    } else if (fileType === "html" || fileType === "htm" || looksLikeHtmlDocument(buffer, fileName)) {
      const text = stripHtmlToPlainText(buffer.toString("utf-8"));
      const { Document } = await import("@langchain/core/documents");
      docs = [new Document({ pageContent: text, metadata: { source: fileName, fileType: "html" } })];
    } else if (["md", "csv", "json", "txt"].includes(fileType)) {
      const text = buffer.toString('utf-8');
      const { Document } = await import("@langchain/core/documents");
      docs = [new Document({ pageContent: text, metadata: { source: fileName, fileType } })];
    } else {
      // 默认作为文本处理
      const text = buffer.toString('utf-8');
      const { Document } = await import("@langchain/core/documents");
      docs = [new Document({ pageContent: text, metadata: { source: fileName, fileType } })];
    }
  } catch (err: any) {
    console.error(`[Parse Error] ${fileName}:`, err.message);
    throw new Error(`无法解析文件 ${fileName}: ${err.message}`);
  }

  if (docs.length === 0) return 0;

  const env = getRagAgentEnv();
  const splitDocs = await splitDocumentsStructured(docs);

  const docsWithMetadata = splitDocs.map(doc => ({
    ...doc,
    metadata: {
      ...doc.metadata,
      source: fileName,
      fileType,
      chunkSize: env.chunkSize,
      chunkOverlap: env.chunkOverlap,
      processedAt: new Date().toISOString()
    }
  }));

  const remaining = Math.max(0, effectiveLimits.maxTotalChunks - effectiveLimits.totalChunks);
  if (remaining <= 0) {
    throw new Error(`Chunk budget exceeded: ${effectiveLimits.totalChunks} >= ${effectiveLimits.maxTotalChunks}`);
  }
  if (docsWithMetadata.length > remaining) {
    throw new Error(`Chunk budget exceeded: need ${docsWithMetadata.length}, remaining ${remaining}, max ${effectiveLimits.maxTotalChunks}`);
  }
  const docsToAdd = docsWithMetadata;
  await addDocumentsInBatches(store, docsToAdd);
  effectiveLimits.totalChunks += docsToAdd.length;
  
  // 自动生成摘要
  let summary = "";
  try {
    const fullText = docs.map(d => d.pageContent).join(" ");
    summary = await generateSummary(fullText);
  } catch (summaryErr) {
    console.warn(`[Summary Warning] Failed to generate summary for ${fileName}:`, summaryErr);
    summary = "摘要生成失败，但文档已存入向量数据库。";
  }

  if (!uploadedDocuments.find(d => d.name === fileName)) {
    console.log(`[Upload Success] Document added to list: ${fileName}`);
    uploadedDocuments.push({ name: fileName, summary, type: fileType });
  } else {
    console.log(`[Upload Success] Document updated in list: ${fileName}`);
    const existingDoc = uploadedDocuments.find(d => d.name === fileName);
    if (existingDoc) existingDoc.summary = summary;
  }
  
  await saveToDisk();
  
  return docsToAdd.length;
};
