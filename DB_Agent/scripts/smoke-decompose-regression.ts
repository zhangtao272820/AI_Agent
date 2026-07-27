/**
 * 回归：两阶段拆解 + scalar 属性查询
 * 用法：npx tsx scripts/smoke-decompose-regression.ts
 */
const BASE = String(process.env.DB_AGENT_HTTP_URL || "http://localhost:13101").replace(/\/$/, "");

type Case = {
  id: string;
  question: string;
  expect: (answer: string) => boolean;
  hint: string;
};

const CASES: Case[] = [
  {
    id: "test_course_bank_names",
    question: "课程名称为测试课程绑定的题库是什么",
    hint: "应列出测试题库名称，不应返回「未返回可展示字段」",
    expect: (a) => {
      const t = a.trim();
      if (/未返回可展示字段/.test(t)) return false;
      if (/测试题库\d*/.test(t)) return true;
      return /题库/.test(t) && !/找到\s*\d+\s*条相关记录/.test(t);
    },
  },
  {
    id: "nongna_bank_names",
    question: "考试组卷名称是农娜的试卷，它绑定题库的名称是什么",
    hint: "应去重列出题库名（测试题库），不应只返回试卷名",
    expect: (a) => {
      const t = a.trim();
      if (/找到\s*20\s*条相关记录/.test(t)) return false;
      if (/记录\s*\d+/.test(t) && (t.match(/记录\s*\d+/g)?.length ?? 0) > 3) return false;
      if (/测试题库\d*/.test(t)) return true;
      if (/problem_name/i.test(t) && /测试题库/.test(t)) return true;
      return false;
    },
  },
  {
    id: "nongna_total_score",
    question: "农娜的试卷总分是多少",
    hint: "应含 152 或 152.00",
    expect: (a) => /152(\.0+)?/.test(a),
  },
  {
    id: "gender_distribution",
    question: "按性别分布",
    hint: "应含男/女分布",
    expect: (a) => /男/.test(a) && /女/.test(a),
  },
];

async function askChat(question: string): Promise<{ answer: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const raw = await res.text();
  let answer = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      const chunk = JSON.parse(line.slice(6));
      if (typeof chunk === "string") answer += chunk;
    } catch {
      /* ignore */
    }
  }
  return { answer: answer.trim(), ms: Date.now() - started };
}

async function waitReady(maxSec = 120): Promise<void> {
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/ready`, { signal: AbortSignal.timeout(5_000) });
      const j = (await res.json()) as { ready?: boolean };
      if (j.ready) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("db_agent not ready");
}

async function main() {
  console.log(`smoke-decompose-regression @ ${BASE}\n`);
  await waitReady();
  console.log("ready: ok\n");

  let failed = 0;
  for (const c of CASES) {
    process.stdout.write(`[RUN] ${c.id}: ${c.question}\n`);
    try {
      const { answer, ms } = await askChat(c.question);
      const ok = c.expect(answer);
      const mark = ok ? "PASS" : "FAIL";
      if (!ok) failed += 1;
      console.log(`[${mark}] ${c.id} (${(ms / 1000).toFixed(1)}s)`);
      console.log(`  hint: ${c.hint}`);
      console.log(`  answer: ${answer.slice(0, 400)}${answer.length > 400 ? "…" : ""}\n`);
    } catch (e) {
      failed += 1;
      console.log(`[FAIL] ${c.id}: ${String((e as Error).message || e)}\n`);
    }
  }

  if (failed) {
    console.error(`\n${failed}/${CASES.length} failed`);
    process.exit(1);
  }
  console.log(`\nall ${CASES.length} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
