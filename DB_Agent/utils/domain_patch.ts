/**
 * 库级补丁加载器：换库时只改 data/domains/<domain>/ 与 DB_AGENT_DOMAIN。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DbBlueprintConfig } from "./blueprint_config";

export type SchemaOverrides = {
  data_domain_tables?: Record<string, string[]>;
  search_boost_tables?: string[];
  foot_pressure_tables?: string[];
  foot_pressure_markers?: string[];
};

export type FootPressurePatch = {
  main_table: string;
  measure_table: string;
  area_detail_markers?: string[];
};

export type JoinHintPatch = {
  when_tables: string[];
  join_only_if_question_needs?: string;
  sql_hint?: string;
};

export type RelationsPatch = {
  foot_pressure?: FootPressurePatch;
  join_hints?: JoinHintPatch[];
};

export type DefaultTimeRange = {
  relative_days?: number;
  description?: string;
};

export type DisplayRulesPatch = {
  yn_column_patterns?: string[];
  completion_context_keywords?: string[];
  sync_keywords?: string[];
  enable_keywords?: string[];
  yes_no_comment_marker?: string;
  column_suffix_completion?: string[];
};

export type DomainToolsPatch = {
  tables?: Record<string, string>;
  health_link_columns?: string[];
};

export type FastPathsPatch = {
  statistics_templates?: { kind: string; description: string }[];
};

export type MetricPatch = {
  id: string;
  title: string;
  description?: string;
  match_hints?: string[];
  tables?: string[];
  sql: string;
};

export type DomainPatch = {
  id: string;
  blueprint: DbBlueprintConfig;
  schemaOverrides: SchemaOverrides;
  relations: RelationsPatch;
  defaultTimeRanges: Record<string, DefaultTimeRange>;
  valueMaps: Record<string, Record<string, string>>;
  displayRules: DisplayRulesPatch;
  domainTools: DomainToolsPatch;
  fastPaths: FastPathsPatch;
  metrics: MetricPatch[];
};

const EMPTY_PATCH: DomainPatch = {
  id: "generic",
  blueprint: { schemaSearchKeywords: [], hints: [] },
  schemaOverrides: {},
  relations: {},
  defaultTimeRanges: {},
  valueMaps: {},
  displayRules: {},
  domainTools: {},
  fastPaths: {},
  metrics: [],
};

let cached: { domain: string; patch: DomainPatch } | null = null;

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function domainDir(domain: string) {
  return join(process.cwd(), "data", "domains", domain);
}

export function invalidateDomainPatchCache() {
  cached = null;
}

const DOMAIN_ALIASES: Record<string, string> = {
  elderly_care: "p2026",
  p2026: "p2026",
};

function resolveDomainId(raw: string): string {
  const id = String(raw ?? "").trim() || "generic";
  if (existsSync(domainDir(id))) return id;
  const alias = DOMAIN_ALIASES[id];
  if (alias && existsSync(domainDir(alias))) return alias;
  if (alias) return alias;
  return id;
}

function mergePatchLayers(specific: DomainPatch, generic: DomainPatch): DomainPatch {
  if (specific.id === generic.id) return specific;
  return {
    ...specific,
    blueprint: {
      schemaSearchKeywords: [
        ...(generic.blueprint.schemaSearchKeywords ?? []),
        ...(specific.blueprint.schemaSearchKeywords ?? []),
      ],
      hints: [...(generic.blueprint.hints ?? []), ...(specific.blueprint.hints ?? [])],
    },
    schemaOverrides: {
      ...generic.schemaOverrides,
      ...specific.schemaOverrides,
      data_domain_tables: {
        ...(generic.schemaOverrides.data_domain_tables ?? {}),
        ...(specific.schemaOverrides.data_domain_tables ?? {}),
      },
    },
    relations: { ...generic.relations, ...specific.relations },
    defaultTimeRanges: { ...generic.defaultTimeRanges, ...specific.defaultTimeRanges },
    valueMaps: { ...generic.valueMaps, ...specific.valueMaps },
    displayRules: { ...generic.displayRules, ...specific.displayRules },
    domainTools: {
      tables: { ...(generic.domainTools.tables ?? {}), ...(specific.domainTools.tables ?? {}) },
      health_link_columns:
        specific.domainTools.health_link_columns?.length
          ? specific.domainTools.health_link_columns
          : generic.domainTools.health_link_columns,
    },
    fastPaths: {
      statistics_templates: [
        ...(generic.fastPaths.statistics_templates ?? []),
        ...(specific.fastPaths.statistics_templates ?? []),
      ],
    },
    metrics: specific.metrics.length ? specific.metrics : generic.metrics,
  };
}

function loadPatchFromDir(id: string): DomainPatch {
  const dir = domainDir(id);
  const blueprint =
    readJson<DbBlueprintConfig>(join(dir, "blueprint.json")) ?? EMPTY_PATCH.blueprint;

  const schemaOverrides = readJson<SchemaOverrides>(join(dir, "schema_overrides.json")) ?? {};
  const relations = readJson<RelationsPatch>(join(dir, "relations.json")) ?? {};
  const defaultTimeRanges = readJson<Record<string, DefaultTimeRange>>(join(dir, "default_time_range.json")) ?? {};
  const valueMaps = readJson<Record<string, Record<string, string>>>(join(dir, "value_maps.json")) ?? {};
  const displayRules = readJson<DisplayRulesPatch>(join(dir, "display_rules.json")) ?? {};
  const domainTools = readJson<DomainToolsPatch>(join(dir, "domain_tools.json")) ?? {};
  const fastPaths = readJson<FastPathsPatch>(join(dir, "fast_paths.json")) ?? {};
  const metricsFile = readJson<{ metrics?: MetricPatch[] }>(join(dir, "metrics.json"));
  const metrics = Array.isArray(metricsFile?.metrics) ? metricsFile!.metrics!.filter((m) => m?.id && m?.sql) : [];

  return {
    id,
    blueprint: {
      schemaSearchKeywords: blueprint.schemaSearchKeywords ?? [],
      hints: blueprint.hints ?? [],
    },
    schemaOverrides,
    relations,
    defaultTimeRanges,
    valueMaps,
    displayRules,
    domainTools,
    fastPaths,
    metrics,
  };
}

export function loadDomainPatch(domain?: string | null): DomainPatch {
  const requested = String(
    domain ?? process.env.DB_AGENT_DOMAIN ?? process.env.AGENT_DOMAIN ?? "generic",
  ).trim() || "generic";
  const id = resolveDomainId(requested);
  if (cached && cached.domain === requested) return cached.patch;

  const specific = loadPatchFromDir(id);
  const generic = id === "generic" ? specific : loadPatchFromDir("generic");
  const patch = id === "generic" ? specific : mergePatchLayers(specific, generic);
  patch.id = id;

  cached = { domain: requested, patch };
  return patch;
}

export function getMustTablesForDataDomain(dataDomain: string, patch?: DomainPatch): string[] {
  const p = patch ?? loadDomainPatch();
  const tables = p.schemaOverrides.data_domain_tables?.[dataDomain];
  return Array.isArray(tables) ? tables.filter(Boolean) : [];
}

/** 健康档案连表默认表对（补丁未配置时的结构性回退，非问句路由） */
export function getHealthLinkTables(patch?: DomainPatch): string[] {
  const fromPatch = getMustTablesForDataDomain("person_health", patch);
  if (fromPatch.length) return fromPatch;
  return ["person_info", "person_health_records"];
}

export function getFootPressureConfig(patch?: DomainPatch): FootPressurePatch {
  const p = patch ?? loadDomainPatch();
  return (
    p.relations.foot_pressure ?? {
      main_table: "remote_activity_foot_log",
      measure_table: "remote_activity_foot_measure_log",
      area_detail_markers: [
        "区域信息",
        "区域压力",
        "分区",
        "重心",
        "坐标",
        "热力",
        "左右脚",
        "足弓",
        "前掌",
        "后跟",
      ],
    }
  );
}

export function getFootPressureMarkers(patch?: DomainPatch): string[] {
  const p = patch ?? loadDomainPatch();
  if (p.schemaOverrides.foot_pressure_markers?.length) return p.schemaOverrides.foot_pressure_markers;
  return ["足底", "足压", "压力测试", "平衡测量", "步态", "活动检测"];
}

export function getDefaultTimeRange(relativeKey: string, patch?: DomainPatch): DefaultTimeRange | null {
  const p = patch ?? loadDomainPatch();
  return p.defaultTimeRanges[relativeKey] ?? null;
}

export function getDomainTable(key: string, fallback: string, patch?: DomainPatch): string {
  const p = patch ?? loadDomainPatch();
  const hit = p.domainTools.tables?.[key];
  return typeof hit === "string" && hit.trim() ? hit.trim() : fallback;
}

export function getHealthLinkColumnCandidates(patch?: DomainPatch): string[] {
  const p = patch ?? loadDomainPatch();
  const cols = p.domainTools.health_link_columns;
  return Array.isArray(cols) && cols.length ? cols.filter(Boolean) : ["person_id", "user_id"];
}

export function getStatisticsTemplateHints(patch?: DomainPatch): string {
  const p = patch ?? loadDomainPatch();
  const templates = p.fastPaths.statistics_templates ?? [];
  if (!templates.length) return "";
  return templates.map((t) => `- ${t.kind}: ${t.description}`).join("\n");
}
