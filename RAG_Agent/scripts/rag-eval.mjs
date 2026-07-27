/**
 * 轻量检索评测：对 data/rag-eval-questions.json 调用 /api/retrieve
 * 用法：先 npm run dev，再 npm run eval:rag
 * CI：npm run eval:rag:ci（未达 RAG_EVAL_MIN_PASS_RATE 时 exit 1）
 */
import fs from "node:fs";
import path from "node:path";

const base = process.env.RAG_EVAL_URL || "http://localhost:13102";
const minPassRate = Number(process.env.RAG_EVAL_MIN_PASS_RATE ?? "0.5");
const ciMode = process.argv.includes("--ci") || process.env.RAG_EVAL_CI === "1";

const cases = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data/rag-eval-questions.json"), "utf8")
);

const results = [];
let ok = 0;

for (const c of cases) {
  const t0 = Date.now();
  let data = {};
  try {
    const res = await fetch(`${base}/api/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: c.question, skipLlmRerank: true, skipEvidenceSelect: true }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    console.error(`ERR [${c.id}]`, e?.message || e);
  }
  const sources = (data.evidence || []).map((e) => String(e.source || "")).join(" ");
  const hit =
    c.expect_intent === "document_list"
      ? false
      : (c.expect_sources || []).some((s) => sources.includes(s) || JSON.stringify(data).includes(s));
  const pass = data.ok && (c.expect_intent ? false : (data.evidence?.length > 0 || hit));
  if (pass) ok += 1;
  const row = {
    id: c.id,
    pass,
    hits: data.evidence?.length ?? 0,
    ms: data.ms ?? Date.now() - t0,
    agentic_rounds: data.agentic_rounds ?? 0,
    experience_hits: data.experience_hits ?? 0,
    rerank_mode: data.rerank_mode,
  };
  results.push(row);
  console.log(
    `${pass ? "PASS" : "FAIL"} [${c.id}] ${c.question.slice(0, 40)}… hits=${row.hits} exp=${row.experience_hits}`
  );
}

const report = {
  at: new Date().toISOString(),
  base,
  total: cases.length,
  passed: ok,
  passRate: cases.length ? ok / cases.length : 0,
  minPassRate,
  ciMode,
  results,
};

const outDir = path.join(process.cwd(), ".data");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "rag-eval-baseline.json");
fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

console.log(`\n${ok}/${cases.length} passed (${Math.round(report.passRate * 100)}%)`);
console.log(`baseline -> ${outFile}`);

if (ciMode && report.passRate < minPassRate) {
  console.error(`CI gate failed: passRate ${report.passRate} < ${minPassRate}`);
  process.exit(1);
}
