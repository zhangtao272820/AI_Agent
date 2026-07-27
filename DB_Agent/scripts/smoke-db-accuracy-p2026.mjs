/**
 * 对照 p2026 真实 MySQL 验收 DB chat 准确率（无幻觉 / 不错表 / 分布不作明细）。
 * 用法: node scripts/smoke-db-accuracy-p2026.mjs
 * 环境: DB_AGENT_URL=http://127.0.0.1:13101
 */
const BASE = process.env.DB_AGENT_URL || "http://127.0.0.1:13101";

const CASES = [
  {
    id: "hexi_70_79_gender",
    q: "查询河西区70-79岁老人性别分布",
    expect: {
      mustIncludeAny: ["男", "女"],
      mustMatchNumbers: { 男: 5, 女: 2 },
      forbid: ["找到 7 条相关记录", "sys_user", "Gender", "性别;0未知"],
    },
  },
  {
    id: "hexi_count",
    q: "河西区有多少老人",
    // 真库：河西区 age>=60 → 9；「老人」语义接受 9
    expect: {
      mustMatchAnyCount: [9],
      forbid: ["找到 9 条相关记录", "sys_user"],
    },
  },
  {
    id: "person_total",
    q: "人员档案总共有多少人",
    expect: {
      mustMatchAnyCount: [18],
      forbid: ["sys_user"],
    },
  },
  {
    id: "long_nainai_phone",
    q: "龙奶奶的手机号是多少",
    expect: {
      mustIncludeAny: ["13887228382"],
      forbid: ["sys_user", "找不到"],
    },
  },
  {
    id: "mood_count",
    q: "情绪识别仪检测记录有多少条",
    expect: {
      mustMatchAnyCount: [10],
      forbid: ["足底", "foot", "sys_user"],
    },
  },
];

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
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return extractAnswer(text);
}

function score(answer, expect) {
  const a = String(answer || "");
  const fails = [];
  for (const f of expect.forbid || []) {
    if (a.includes(f)) fails.push(`forbid:${f}`);
  }
  if (expect.mustIncludeAny?.length && !expect.mustIncludeAny.some((x) => a.includes(x))) {
    fails.push(`mustIncludeAny:${expect.mustIncludeAny.join("|")}`);
  }
  if (expect.mustMatchAnyCount?.length) {
    const ok = expect.mustMatchAnyCount.some((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(a));
    if (!ok) fails.push(`count_any:${expect.mustMatchAnyCount.join("|")}`);
  }
  if (expect.mustMatchNumbers) {
    for (const [k, n] of Object.entries(expect.mustMatchNumbers)) {
      const re = new RegExp(`${k}\\s*[:：]?\\s*${n}`);
      if (!re.test(a) && !(a.includes(k) && a.includes(String(n)))) {
        fails.push(`pair:${k}=${n}`);
      }
    }
  }
  return fails;
}

async function main() {
  console.log("ready check...", BASE);
  const ready = await fetch(`${BASE}/api/ready`).then((r) => r.json());
  console.log(ready);

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`\n>>> [${c.id}] ${c.q}\n`);
    const t0 = Date.now();
    let answer = "";
    let err = null;
    try {
      answer = await ask(c.q);
    } catch (e) {
      err = e.message || String(e);
    }
    const ms = Date.now() - t0;
    const fails = err ? [`error:${err}`] : score(answer, c.expect);
    const pass = fails.length === 0;
    results.push({ id: c.id, pass, fails, ms, answer: answer.slice(0, 500) });
    console.log(pass ? "PASS" : "FAIL", `(${ms}ms)`);
    if (!pass) console.log("fails:", fails);
    console.log("answer:\n", answer.slice(0, 800));
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== SUMMARY ${passed}/${results.length} PASS ===`);
  for (const r of results) {
    console.log(`${r.pass ? "OK" : "NG"} ${r.id} ${r.ms}ms ${r.fails.join("; ")}`);
  }
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
