/**
 * 预取 table_judge 权威性纯函数测试（tsx/node --import 或 vitest 皆可按项目习惯跑）。
 */
import {
  isAuthoritativeLlmTableJudge,
  isFakePrefetchTableJudge,
  stampLlmTableJudge,
} from "./prefetch_table_judge";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const fake = {
  ranked_tables: ["a", "b", "c"],
  primary_tables: ["a", "b", "c"],
  auxiliary_tables: [],
  reasoning: "manager_prefetch_plan",
  sql_hint: "",
};
assert(isFakePrefetchTableJudge(fake), "manager_prefetch_plan is fake");
assert(!isAuthoritativeLlmTableJudge(fake), "fake not authoritative");

const reuse = { ...fake, reasoning: "manager_prefetch_reuse" };
assert(isFakePrefetchTableJudge(reuse), "manager_prefetch_reuse is fake");
assert(!isAuthoritativeLlmTableJudge(reuse), "reuse fake not authoritative");

const stamped = stampLlmTableJudge({
  ranked_tables: ["mood", "foot"],
  primary_tables: ["mood"],
  auxiliary_tables: ["foot"],
  reasoning: "情绪仪检测记录对应该业务表",
  sql_hint: "主查 mood",
});
assert(stamped.judge_source === "llm", "stamp sets llm");
assert(isAuthoritativeLlmTableJudge(stamped), "stamped is authoritative");
assert(!isFakePrefetchTableJudge(stamped), "stamped not fake even if mixed candidates");

const llmButFakeReasoning = stampLlmTableJudge({
  ...fake,
  primary_tables: ["a"],
});
assert(
  isAuthoritativeLlmTableJudge(llmButFakeReasoning),
  "judge_source=llm wins over legacy fake reasoning string after stamp",
);

console.log("ok: prefetch_table_judge");
