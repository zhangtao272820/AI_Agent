import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

/** LangGraph 主链状态（D-P0-2 batch-1 抽出）。 */
export const DbGraphState = new StateSchema({
  question: z.string(),
  chat_history: z.any().default(() => []),
  manager_task_json: z.string().default(""),
  standalone_question: z.string().default(""),
  query_plan_json: z.string().default(""),
  schema_ground_json: z.string().default(""),
  clarification_question: z.string().default(""),
  task_stack_json: z.string().default(""),
  bypass_task_stack: z.boolean().default(false),
  structural_plan_used: z.boolean().default(false),
  decompose_plan_used: z.boolean().default(false),
  manager_plan_used: z.boolean().default(false),
  execution_shape_json: z.string().default(""),
  plan_completeness_json: z.string().default(""),
  session_id: z.string().default(""),
  sql_preflight_json: z.string().default(""),
  route_policy_json: z.string().default(""),
  route_skip_sql_direct: z.boolean().default(false),
  sql_direct_fail_reason: z.string().default(""),
  intent: z.string().default(""),
  answer: z.string().default(""),
});
