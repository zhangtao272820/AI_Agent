import type { GraphNode } from "@langchain/langgraph";
import { tryFootPressureFastPath } from "../../foot_pressure_fastpath";
import { formatManagerContextBlob, parseManagerDbTaskFromJson } from "../../manager_task_context";
import { parseQueryPlan } from "../../nlu";
import { recordQueryMetric } from "../../query_metrics";
import type { SchemaGroundResult } from "../../schema_ground";
import { safeParseSqlPreflightJson } from "../../sql_preflight";
import { runSqlDirectDetailFastPath } from "../../sql_direct";
import { sanitizeAssistantText } from "../../text";
import { parseExecutionShapeFromState } from "../helpers";
import type { DbGraphState } from "../state";
import type { DbGraphDeps } from "../types";

export function createSqlAgentNode(deps: DbGraphDeps): GraphNode<typeof DbGraphState> {
  const { ds, skillRunCtx, skills } = deps;
  return async (state) => {
    const sq = String(state.standalone_question || state.question || "").trim();
    const pre = safeParseSqlPreflightJson(String(state.sql_preflight_json || ""), sq);
    const qToAgent = (pre?.refined_question || "").trim() || sq;
    const t0 = Date.now();
    const plan = parseQueryPlan(state.query_plan_json);
    let schemaGround: SchemaGroundResult | null = null;
    try {
      const raw = String(state.schema_ground_json || "").trim();
      if (raw) schemaGround = JSON.parse(raw) as SchemaGroundResult;
    } catch {
      schemaGround = null;
    }
    const mgr = parseManagerDbTaskFromJson(String(state.manager_task_json || ""));
    const managerContextBlob = formatManagerContextBlob(mgr);
    const detailFast = await runSqlDirectDetailFastPath({
      ds,
      question: qToAgent,
      queryPlan: plan,
      schemaGround,
    });
    if (detailFast?.ok) {
      recordQueryMetric({
        path: "sql_direct",
        ok: true,
        question: qToAgent,
        data_domain: plan.data_domain,
        tables: schemaGround?.candidate_tables,
      });
      return { answer: detailFast.answer };
    }
    const executionShape = parseExecutionShapeFromState(String(state.execution_shape_json || ""));
    const footFast = await tryFootPressureFastPath(ds, {
      question: qToAgent,
      plan,
      schemaGround,
      managerContextBlob,
      executionShape,
      wantsCount: executionShape === "scalar_lookup",
    });
    if (footFast) {
      recordQueryMetric({
        path: "sql_direct",
        ok: true,
        question: qToAgent,
        data_domain: plan.data_domain,
        tables: schemaGround?.candidate_tables,
      });
      return { answer: sanitizeAssistantText(footFast.answer) };
    }
    const answer = await skills.sql_agent.run(qToAgent, skillRunCtx(state));
    const tables: string[] = schemaGround?.candidate_tables ?? [];
    recordQueryMetric({
      path: "sql_agent",
      ok: Boolean(String(answer || "").trim()),
      ms: Date.now() - t0,
      question: qToAgent,
      data_domain: plan.data_domain,
      tables,
    });
    return { answer };
  };
}
