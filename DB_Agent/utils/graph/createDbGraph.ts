import { StateGraph, START, END } from "@langchain/langgraph";
import { DbGraphState } from "./state";
import { createRepeatNode } from "./nodes/repeat";
import { createCondenseNode } from "./nodes/condense";
import { createPlanNode } from "./nodes/plan";
import { createClarifyNode } from "./nodes/clarify";
import { createSchemaGroundNode } from "./nodes/schemaGround";
import { createRouteNode } from "./nodes/route";
import {
  createHelpNode,
  createPersonInfoNode,
  createPersonHealthNode,
  createStatisticsNode,
} from "./nodes/skills";
import { createSqlPreflightNode } from "./nodes/sqlPreflight";
import { createSqlDirectNode } from "./nodes/sqlDirect";
import { createSqlAgentNode } from "./nodes/sqlAgent";
import { createOutOfScopeNode } from "./nodes/outOfScope";
import { createTaskStackNode } from "./nodes/taskStack";
import { afterRepeat, afterPlan, afterSqlDirect, buildAfterRoute } from "./routing";
import type { DbGraphCompileRefs, DbGraphDeps, DbGraphEarlyDeps } from "./types";

export type CreateDbGraphInput = {
  earlyDeps: DbGraphEarlyDeps;
  graphDeps: DbGraphDeps;
  compileRefs: DbGraphCompileRefs;
};

export function createDbGraph({ earlyDeps, graphDeps, compileRefs }: CreateDbGraphInput) {
  const nodeRepeat = createRepeatNode();
  const nodeCondense = createCondenseNode(earlyDeps);
  const nodePlan = createPlanNode(earlyDeps);
  const nodeClarify = createClarifyNode(earlyDeps);
  const nodeSchemaGround = createSchemaGroundNode(graphDeps);
  const nodeRoute = createRouteNode(graphDeps);
  const nodeHelp = createHelpNode(graphDeps);
  const nodePersonInfo = createPersonInfoNode(graphDeps);
  const nodePersonHealth = createPersonHealthNode(graphDeps);
  const nodeStatistics = createStatisticsNode(graphDeps);
  const nodeSqlPreflight = createSqlPreflightNode(graphDeps);
  const nodeSqlDirect = createSqlDirectNode(graphDeps);
  const nodeSqlAgent = createSqlAgentNode(graphDeps);
  const nodeOutOfScope = createOutOfScopeNode(graphDeps);
  const nodeTaskStack = createTaskStackNode(earlyDeps, compileRefs);
  const afterRoute = buildAfterRoute(graphDeps.skills);

  const graph = new StateGraph(DbGraphState)
    .addNode("repeat", nodeRepeat)
    .addNode("condense", nodeCondense)
    .addNode("plan", nodePlan)
    .addNode("clarify", nodeClarify)
    .addNode("task_stack", nodeTaskStack)
    .addNode("route", nodeRoute)
    .addNode("help", nodeHelp)
    .addNode("person_info", nodePersonInfo)
    .addNode("person_health", nodePersonHealth)
    .addNode("statistics", nodeStatistics)
    .addNode("sql_preflight", nodeSqlPreflight)
    .addNode("sql_direct", nodeSqlDirect)
    .addNode("sql_agent", nodeSqlAgent)
    .addNode("out_of_scope", nodeOutOfScope)
    .addNode("schema_ground", nodeSchemaGround)
    .addEdge(START, "repeat")
    .addConditionalEdges("repeat", afterRepeat, ["condense", END])
    .addEdge("condense", "plan")
    .addConditionalEdges("plan", afterPlan, ["clarify", "task_stack", "schema_ground", "out_of_scope"])
    .addEdge("clarify", END)
    .addEdge("task_stack", END)
    .addEdge("schema_ground", "route")
    .addConditionalEdges("route", afterRoute, [
      "help",
      "person_info",
      "person_health",
      "statistics",
      "sql_preflight",
      "sql_direct",
      "sql_agent",
      "out_of_scope",
    ])
    .addEdge("help", END)
    .addEdge("person_info", END)
    .addEdge("person_health", END)
    .addEdge("statistics", END)
    .addEdge("sql_preflight", "sql_direct")
    .addConditionalEdges("sql_direct", afterSqlDirect, [END, "sql_agent"])
    .addEdge("sql_agent", END)
    .addEdge("out_of_scope", END)
    .compile();

  compileRefs.compiledGraph = graph;
  return graph;
}
