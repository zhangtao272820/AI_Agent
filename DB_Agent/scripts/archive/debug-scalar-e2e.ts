/**
 * 端到端调试：拆解 → Schema Ground → Scalar Link
 */
import "dotenv/config";
import { getDataSource } from "../utils/db";
import { getOrchestrationChatModel, getAgentChatModel } from "../utils/agent";
import { resolveAgentRuntimeConfig } from "../utils/runtime";
import { buildQueryPlanViaDecomposition } from "../utils/nlu/dbQueryDecompose";
import { runSchemaGround } from "../utils/schema_ground";
import { resolveQueryExecutionShape } from "../utils/nlu/dbQueryExecutionShapeLlm";
import { tryScalarSchemaLinkedQuery } from "../utils/scalar_sql_builder";
import { runScalarLookupDirect } from "../utils/sql_direct";
import { resetLlmCallCount, getLlmCallCount } from "../utils/llm_call_counter";
import { loadDomainPatch } from "../utils/domain_patch";
import { getDbAgentBlueprintEnv } from "../utils/db_agent_env";

const QUESTION = process.argv[2] || "课程名称为测试课程绑定的题库是什么";

async function main() {
  resetLlmCallCount();
  const config = resolveAgentRuntimeConfig({} as any);
  const ds = await getDataSource(config);
  const orch = getOrchestrationChatModel(config);
  const agent = getAgentChatModel(config);
  const domain = getDbAgentBlueprintEnv().domain;
  console.log("domain:", domain, "patch:", loadDomainPatch(domain).id);

  const decomposed = await buildQueryPlanViaDecomposition(orch, QUESTION, null);
  console.log("\n=== QueryPlan ===");
  console.log(JSON.stringify(decomposed?.plan, null, 2));

  const ground = await runSchemaGround(ds, {
    question: QUESTION,
    queryPlan: decomposed?.plan ?? null,
    judgeModel: orch,
  });
  console.log("\n=== Schema Ground ===");
  console.log("primary:", ground?.table_judge?.primary_tables);
  console.log("candidates:", ground?.candidate_tables?.slice(0, 6));

  const shape = await resolveQueryExecutionShape(orch, {
    question: QUESTION,
    queryPlan: decomposed?.plan ?? null,
    schemaGround: ground,
  });
  console.log("\nexecution_shape:", shape);

  const linked = await tryScalarSchemaLinkedQuery({
    model: agent,
    ds,
    question: QUESTION,
    queryPlan: decomposed?.plan ?? null,
    schemaGround: ground,
    executionShape: shape,
  });
  console.log("\n=== Scalar Link (tryScalar) ===");
  console.log("ok:", linked.ok, "reason:", linked.ok ? linked.spec_reason : (linked as any).reason);
  if (linked.ok) {
    console.log("sql:", linked.sql);
    console.log("rows:", linked.rows?.slice(0, 5));
  }

  const scalar = await runScalarLookupDirect({
    model: agent,
    ds,
    question: QUESTION,
    queryPlan: decomposed?.plan ?? null,
    schemaGround: ground,
    executionShape: shape,
  });
  console.log("\n=== runScalarLookupDirect ===");
  console.log("ok:", scalar.ok, "answer:", scalar.ok ? scalar.answer : scalar.reason);

  console.log("\nllm_calls:", getLlmCallCount());
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
