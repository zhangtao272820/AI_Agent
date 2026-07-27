/** Timed e2e for course→bank JSON join A/B phrasings. */
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
    const text = await res.text();
    return { ok: res.ok, status: res.status, answer: extractAnswer(text) };
  } finally {
    clearTimeout(t);
  }
}

const cases = [
  {
    id: "A_exact_course",
    q: "课程中课程名称是测试课程的课程，绑定的题库列表是什么",
  },
  {
    id: "B_like_course",
    q: "查询名字包含测试这两个字的课程，里面的题库是什么",
  },
];

function score(answer) {
  const a = String(answer || "");
  const fails = [];
  if (/暂时没能从库里跑出有效查询/.test(a)) fails.push("empty_agent");
  if (/课程名称\s*[:：]/.test(a) && /测试题库/.test(a)) fails.push("wrong_label_course_name");
  const banks = ["测试题库1", "测试题库2", "测试题库3", "测试题库4", "测试题库5"];
  const hit = banks.filter((b) => a.includes(b)).length;
  if (hit < 3) fails.push(`banks_hit_${hit}<3`);
  return fails;
}

(async () => {
  let pass = 0;
  for (const c of cases) {
    console.log("\n>>>", c.id, c.q);
    try {
      const r = await ask(c.q);
      const fails = score(r.answer);
      console.log(fails.length ? "FAIL" : "PASS", fails.join(",") || "");
      console.log(String(r.answer || "").slice(0, 500));
      if (!fails.length) pass += 1;
    } catch (e) {
      console.log("FAIL", e.name || e.message);
    }
  }
  console.log(`\n=== SUMMARY ${pass}/${cases.length} ===`);
  process.exit(pass === cases.length ? 0 : 1);
})();
