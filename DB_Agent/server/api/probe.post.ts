import { getDataSource } from "../../utils/db";
import { introspectSchemaWithComments } from "../../utils/schema";
import { ensureRateLimit } from "../../utils/rate";
import { resolveAgentRuntimeConfig } from "../../utils/runtime";

export default defineEventHandler(async (event) => {
  ensureRateLimit(event, { max: 120, refillPerSec: 60 });
  const body = await readBody<{ question?: string; dbId?: string }>(event);
  const question = String(body?.question ?? "").trim();
  if (!question) {
    throw createError({ statusCode: 400, statusMessage: "question 不能为空" });
  }
  const runtimeConfig = useRuntimeConfig(event) as any;
  const config = resolveAgentRuntimeConfig(runtimeConfig, body?.dbId);
  const ds = await getDataSource(config);
  const dbName = String((ds.options as any)?.database ?? "");
  const searchResult = await introspectSchemaWithComments(ds, `search:${question}`);
  const text = typeof searchResult === "string" ? searchResult : "";
  const tables = text
    .split("\n")
    .filter((l) => /^\s*-\s+/.test(l))
    .map((l) => l.replace(/^\s*-\s+/, "").split(/\s+/)[0]?.trim() || "")
    .filter(Boolean)
    .slice(0, 6);
  const schemaMatched = tables.length > 0;
  let pingOk = false;
  let pingError: string | undefined;
  try {
    await ds.query("SELECT 1 AS ok");
    pingOk = true;
  } catch (e: any) {
    pingOk = false;
    pingError = String(e?.message ?? e ?? "ping failed").slice(0, 240);
  }
  const executable = schemaMatched && pingOk;
  return {
    ok: true,
    db: dbName,
    schemaMatched,
    pingOk,
    executable,
    matched: executable,
    tables,
    evidence: text
      .split("\n")
      .filter((l) => /^\s*-\s+/.test(l))
      .slice(0, 6)
      .join("\n"),
    ...(pingError ? { pingError } : {}),
  };
});

