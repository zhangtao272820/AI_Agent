/**
 * 调试：测试课程 → 绑定题库 Schema Link 路径
 */
import "dotenv/config";
import { getDataSource } from "../utils/db";
import { loadTableColumnMeta, columnLooksLikeJsonIdArray } from "../utils/nlu/dbSchemaLinkLlm";
import { mapFilterSlotsStructural } from "../utils/nlu/dbFilterSlotMapLlm";
import { compileSchemaLinkToSql } from "../utils/scalar_sql_builder";
import type { QueryPlan } from "../utils/nlu/query_plan";
import { introspectSchemaWithComments } from "../utils/schema";

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

  const searchQ = "课程名称为测试课程绑定的题库是什么 课程 题库 课程名称=测试课程 题库名称";
  const searchResult = await introspectSchemaWithComments(ds, `search:${searchQ}`);
  console.log("=== schema search ===\n", String(searchResult).slice(0, 1200));

  const tables = ["teaching_course_info", "teaching_problem_info", "teaching_exam_info"];
  const metas = await loadTableColumnMeta(ds, tables);
  const courseMeta = metas.find((m) => m.table === "teaching_course_info");
  const arrCol = courseMeta?.columns.find((c) => c.name === "arr_problem_id");
  console.log("arr_problem_id meta:", arrCol);
  console.log("columnLooksLikeJsonIdArray:", arrCol ? columnLooksLikeJsonIdArray(arrCol) : false);

  const plan: QueryPlan = {
    intent: "aggregation",
    data_domain: "default",
    metrics: ["题库名称"],
    dimensions: [],
    filters: {
      where: ["课程名称=测试课程"],
      slots: [{ field_hint: "课程名称", value: "测试课程", sql_match_value: "测试课程" }],
    },
    entities: { names: ["测试课程"] },
    limit: 10,
  };

  const filters = mapFilterSlotsStructural(plan, metas, "teaching_course_info");
  console.log("structural filters:", filters);

  const compiled = compileSchemaLinkToSql({
    mode: "json_array_join",
    anchor_table: "teaching_course_info",
    filters,
    select: [{ table: "teaching_problem_info", column: "problem_name" }],
    json_array_join: {
      from_table: "teaching_course_info",
      json_column: "arr_problem_id",
      to_table: "teaching_problem_info",
      to_column: "id",
      select: [{ table: "teaching_problem_info", column: "problem_name" }],
    },
    use_distinct: true,
    limit: 10,
    confidence: 0.9,
  });
  console.log("SQL:", compiled);

  if (compiled.ok) {
    const rows = await ds.query(compiled.sql);
    console.log("rows:", rows);
  }

  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
