import fs from "node:fs/promises";
import path from "node:path";

export async function appendAgentTraceLog(entry: {
  agent: string;
  path: string;
  trace_id?: string;
  ok?: boolean;
  latency_ms?: number;
  detail?: string;
}) {
  if (String(process.env.MANAGER_AGENT_TRACE ?? "1").trim() === "0") return;
  const file =
    String(process.env.AGENT_TRACE_LOG_PATH || "").trim() ||
    path.join(process.cwd(), ".data", "agent-trace.jsonl");
  const row = { ts: new Date().toISOString(), service: "DB_Agent", ...entry };
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch {}
}
