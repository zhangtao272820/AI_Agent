/**
 * 离线回归：结构推断 Schema Link（无 HTTP/LLM）
 */
import "dotenv/config";
import { getDataSource } from "../utils/db";
import { loadTableColumnMeta, expandMetasForJsonArrayJoins } from "../utils/nlu/dbSchemaLinkLlm";
import { resolveStructuralScalarSpec } from "../utils/nlu/dbSchemaLinkStructural";
import { compileSchemaLinkToSql } from "../utils/scalar_sql_builder";
import type { QueryPlan } from "../utils/nlu/query_plan";

type Case = {
  id: string;
  plan: QueryPlan;
  tables: string[];
  expectSqlIncludes: string[];
  expectRowCheck: (rows: Record<string, unknown>[]) => boolean;
};

const CASES: Case[] = [
  {
    id: "test_course_banks",
    plan: {
      intent: "aggregation",
      subject: "record",
      data_domain: "general",
      entities: { names: [], locations: [], orgs: [], ids: [] },
      metrics: ["题库名称"],
      dimensions: [],
      filters: {
        where: ["课程名称=测试课程"],
        slots: [{ field_hint: "课程名称", value: "测试课程", sql_match_value: "测试课程" }],
        time_range: { start: "", end: "", relative: "" },
      },
      sort: [],
      limit: 10,
      confidence: 0.8,
      missing_slots: [],
      needs_clarification: false,
      clarification_question: "",
    },
    tables: ["teaching_course_info", "teaching_problem_info"],
    expectSqlIncludes: ["json_table", "problem_name", "course_name"],
    expectRowCheck: (rows) => rows.some((r) => /测试题库/.test(String(r.problem_name ?? ""))),
  },
  {
    id: "nongna_exam_banks",
    plan: {
      intent: "aggregation",
      subject: "record",
      data_domain: "general",
      entities: { names: ["农娜"], locations: [], orgs: [], ids: [] },
      metrics: ["绑定题库名称"],
      dimensions: [],
      filters: {
        where: ["考试组卷名称=农娜"],
        slots: [{ field_hint: "考试组卷名称", value: "农娜的试卷", sql_match_value: "农娜" }],
        time_range: { start: "", end: "", relative: "" },
      },
      sort: [],
      limit: 10,
      confidence: 0.8,
      missing_slots: [],
      needs_clarification: false,
      clarification_question: "",
    },
    tables: ["teaching_exam_info", "teaching_problem_info"],
    expectSqlIncludes: ["json_table", "problem_name", "exam_name"],
    expectRowCheck: (rows) => rows.some((r) => /测试题库/.test(String(r.problem_name ?? ""))),
  },
  {
    id: "nongna_total_score",
    plan: {
      intent: "aggregation",
      subject: "record",
      data_domain: "general",
      entities: { names: ["农娜"], locations: [], orgs: [], ids: [] },
      metrics: ["试卷总分"],
      dimensions: [],
      filters: {
        where: ["试卷=农娜"],
        slots: [{ field_hint: "考试组卷名称", value: "农娜", sql_match_value: "农娜" }],
        time_range: { start: "", end: "", relative: "" },
      },
      sort: [],
      limit: 3,
      confidence: 0.8,
      missing_slots: [],
      needs_clarification: false,
      clarification_question: "",
    },
    tables: ["teaching_exam_info"],
    expectSqlIncludes: ["total_score", "exam_name"],
    expectRowCheck: (rows) => rows.some((r) => /152/.test(String(Object.values(r)[0] ?? ""))),
  },
  {
    id: "test_title_options",
    plan: {
      intent: "aggregation",
      subject: "record",
      data_domain: "general",
      entities: { names: [], locations: [], orgs: [], ids: [] },
      metrics: ["选项内容"],
      dimensions: [],
      filters: {
        where: ["题目名称=测试题目"],
        slots: [{ field_hint: "题目名称", value: "测试题目", sql_match_value: "测试题目" }],
        time_range: { start: "", end: "", relative: "" },
      },
      sort: [],
      limit: 15,
      confidence: 0.85,
      missing_slots: [],
      needs_clarification: false,
      clarification_question: "",
    },
    tables: ["teaching_problem_title", "teaching_problem_title_option", "teaching_problem_info"],
    expectSqlIncludes: ["problem_title_name", "problem_title_option_content", "join"],
    expectRowCheck: (rows) =>
      rows.length >= 2 &&
      rows.some((r) => /圆礼帽|血淋淋|意识|算盘/.test(String(r.problem_title_option_content ?? Object.values(r)[0] ?? ""))),
  },
];

async function main() {
  const ds = await getDataSource({
    mysql: {
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "p2026",
    },
  });

  let failed = 0;
  for (const c of CASES) {
    process.stdout.write(`[RUN] ${c.id}\n`);
    let metas = await loadTableColumnMeta(ds, c.tables);
    metas = await expandMetasForJsonArrayJoins(ds, metas);
    const spec = resolveStructuralScalarSpec(metas, c.plan, null);
    if (!spec) {
      console.log(`[FAIL] ${c.id}: no structural spec\n`);
      failed += 1;
      continue;
    }
    const compiled = compileSchemaLinkToSql(spec);
    if (!compiled.ok) {
      console.log(`[FAIL] ${c.id}: compile ${compiled.reason}\n`);
      failed += 1;
      continue;
    }
    const sqlLower = compiled.sql.toLowerCase();
    if (!c.expectSqlIncludes.every((p) => sqlLower.includes(p.toLowerCase()))) {
      console.log(`[FAIL] ${c.id}: sql missing pattern`);
      console.log(`  sql: ${compiled.sql}\n`);
      failed += 1;
      continue;
    }
    const rows = (await ds.query(compiled.sql)) as Record<string, unknown>[];
    if (!c.expectRowCheck(rows)) {
      console.log(`[FAIL] ${c.id}: rows ${JSON.stringify(rows.slice(0, 3))}\n`);
      failed += 1;
      continue;
    }
    console.log(`[PASS] ${c.id} mode=${spec.mode} reason=${spec.reason}`);
    console.log(`  sql: ${compiled.sql.slice(0, 160)}…\n`);
  }

  await ds.destroy();
  if (failed) {
    console.error(`${failed}/${CASES.length} failed`);
    process.exit(1);
  }
  console.log(`all ${CASES.length} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
