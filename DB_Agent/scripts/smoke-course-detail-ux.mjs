/** Course details UX + bank regression. */
const BASE = process.env.DB_AGENT_URL || "http://127.0.0.1:13101";
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 180000);

function extractAnswer(sseText) {
  const parts = [];
  for (const block of String(sseText).split("\n\n")) {
    if (!block.includes("event: data")) continue;
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    const raw = line.slice(5).trim();
    try {
      parts.push(JSON.parse(raw));
    } catch {
      parts.push(raw);
    }
  }
  return parts.join("") || sseText;
}

async function ask(q) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
      signal: ac.signal,
    });
    return extractAnswer(await res.text());
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const detailQ = "课程名称是测试课程的课程，它的课程明细分别是什么";
  const bankQ = "课程中课程名称是测试课程的课程，绑定的题库列表是什么";
  console.log("\n>>> DETAIL", detailQ);
  const detail = await ask(detailQ);
  console.log(String(detail).slice(0, 800));
  const df = [];
  if (/创建时间/.test(detail) || /更新时间/.test(detail)) df.push("audit_time");
  if (!/记录\s*1/.test(detail) && !/记录 1/.test(detail)) df.push("not_per_row");
  if (/章节名称：.+[、，].+创建时间/.test(detail.replace(/\n/g, " "))) df.push("column_aggregate");
  console.log(df.length ? `FAIL ${df.join(",")}` : "PASS detail");

  console.log("\n>>> BANK", bankQ);
  const bank = await ask(bankQ);
  console.log(String(bank).slice(0, 400));
  const bf = [];
  if (!/测试题库/.test(bank)) bf.push("missing_banks");
  if (/课程名称\s*[:：].*测试题库/.test(bank)) bf.push("wrong_label");
  console.log(bf.length ? `FAIL ${bf.join(",")}` : "PASS bank");

  const ok = !df.length && !bf.length;
  console.log(`\n=== SUMMARY ${ok ? "OK" : "FAIL"} ===`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
