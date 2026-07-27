/**
 * 可配置蓝图：由模型按语义选取适用提示，不用正则匹配问句。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { clipText } from "./nlu/text";
import { loadDomainPatch } from "./domain_patch";

export type BlueprintHintRule = {
  id?: string;
  scope?: string;
  description?: string;
  text: string;
  /** @deprecated 仅兼容旧配置，不再用于正则匹配 */
  match?: string;
  /** P5：进化来源阶段 */
  stage?: "plan" | "preflight" | "sql";
  sourcePatchId?: string;
};

export type DbBlueprintConfig = {
  schemaSearchKeywords?: string[];
  hints?: BlueprintHintRule[];
};

let cached: DbBlueprintConfig | null | undefined;

const hintSelectCache = new Map<string, { ts: number; value: string }>();
const HINT_CACHE_TTL_MS = 120_000;

function legacyBlueprintPaths(): string[] {
  return [join(process.cwd(), ".data", "db-blueprint.evolved.json")];
}

function evolvedBlueprintFile() {
  const dir = join(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "db-blueprint.evolved.json");
}

function mergeBlueprintConfigs(configs: DbBlueprintConfig[]): DbBlueprintConfig {
  const hints: BlueprintHintRule[] = [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const cfg of configs) {
    for (const kw of cfg.schemaSearchKeywords ?? []) {
      const k = String(kw).trim();
      if (k && !keywords.includes(k)) keywords.push(k);
    }
    for (const h of cfg.hints ?? []) {
      const id = String(h.id || h.text).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      hints.push(h);
    }
  }
  return { schemaSearchKeywords: keywords, hints };
}

export function invalidateBlueprintCache() {
  cached = undefined;
  hintSelectCache.clear();
}

export function loadDbBlueprint(): DbBlueprintConfig {
  if (cached !== undefined) return cached ?? {};
  const configs: DbBlueprintConfig[] = [loadDomainPatch().blueprint];
  for (const p of legacyBlueprintPaths()) {
    try {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, "utf8");
      const o = JSON.parse(raw) as DbBlueprintConfig;
      if (o && typeof o === "object") configs.push(o);
    } catch {
      continue;
    }
  }
  cached = configs.length ? mergeBlueprintConfigs(configs) : {};
  return cached;
}

export function listEvolvedHints(): BlueprintHintRule[] {
  const p = evolvedBlueprintFile();
  if (!existsSync(p)) return [];
  try {
    const o = JSON.parse(readFileSync(p, "utf8")) as DbBlueprintConfig;
    return Array.isArray(o?.hints) ? o.hints : [];
  } catch {
    return [];
  }
}

export function appendEvolvedBlueprintHint(rule: BlueprintHintRule) {
  const file = evolvedBlueprintFile();
  let store: DbBlueprintConfig = { hints: [] };
  if (existsSync(file)) {
    try {
      store = JSON.parse(readFileSync(file, "utf8")) as DbBlueprintConfig;
    } catch {
      store = { hints: [] };
    }
  }
  const hints = Array.isArray(store.hints) ? store.hints : [];
  const id = String(rule.id || "").trim();
  if (id && hints.some((h) => String(h.id) === id)) return id;
  hints.push({
    id: id || `evolved_${Date.now()}`,
    scope: rule.scope,
    text: String(rule.text).trim(),
    stage: rule.stage,
    sourcePatchId: rule.sourcePatchId,
  });
  writeFileSync(file, JSON.stringify({ hints: hints.slice(-30) }, null, 2), "utf8");
  invalidateBlueprintCache();
  return id;
}

export function clearEvolvedBlueprint() {
  try {
    writeFileSync(evolvedBlueprintFile(), JSON.stringify({ hints: [] }, null, 2), "utf8");
  } catch {
    /* ignore */
  }
  invalidateBlueprintCache();
}

export function extractBlueprintSchemaKeywords(_question: string): string[] {
  return [];
}

/** @deprecated 同步正则匹配已废弃，请用 selectBlueprintHintsWithModel */
export function getBlueprintSqlHints(_question: string): string {
  return "";
}

export async function selectBlueprintHintsWithModel(
  model: BaseLanguageModel,
  question: string,
): Promise<string> {
  const q = String(question ?? "").trim();
  if (!q) return "";

  const cfg = loadDbBlueprint();
  const rules = (Array.isArray(cfg.hints) ? cfg.hints : []).filter((r) => String(r?.text ?? "").trim());
  if (!rules.length) return "";

  const catalog = rules.map((r, i) => ({
    id: String(r.id || `hint_${i}`),
    scope: String(r.scope || r.description || "").trim(),
    text: String(r.text).trim(),
  }));

  const cacheKey = `${q}::${catalog.map((c) => c.id).join(",")}`;
  const hit = hintSelectCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < HINT_CACHE_TTL_MS) return hit.value;

  const prompt = [
    "你是查询规划助手。根据用户问题，从下列「提示条目」中选出适用的 id（可多选，也可不选）。",
    "只依据问题语义与每条 scope 描述是否相关，不要用关键词表硬套。",
    '只输出 JSON：{"ids":["id1","id2"]}',
    "",
    `用户问题：${q}`,
    "",
    "提示条目：",
    ...catalog.map((c) => `- id=${c.id}；适用场景：${c.scope || "通用"}`),
  ].join("\n");

  try {
    const resp = await model.invoke(prompt);
    const text =
      typeof (resp as any)?.content === "string" ? (resp as any).content : JSON.stringify((resp as any)?.content);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return "";
    const obj = JSON.parse(text.slice(start, end + 1));
    const ids = new Set(
      (Array.isArray(obj?.ids) ? obj.ids : [])
        .map((x: unknown) => String(x ?? "").trim())
        .filter(Boolean),
    );
    const lines = catalog.filter((c) => ids.has(c.id)).map((c) => `- ${c.text}`);
    const out = lines.length ? clipText(`\n\n[查询规划提示]\n${lines.join("\n")}`, 520) : "";
    hintSelectCache.set(cacheKey, { ts: Date.now(), value: out });
    return out;
  } catch {
    return "";
  }
}
