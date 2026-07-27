import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { queryPlanToUnifiedTaskPlan } from "../../../DB_Agent/utils/nlu/task_plan";
import { inferQueryIntentType } from "../../../RAG_Agent/server/utils/queryIntent";
import { needsCrawlerClarifyStructural } from "../../../Extractor_Agent/server/services/crawlerAgent";
import { parseRagClarifyPayload } from "../../../Manager_Agent/server/utils/managerGraph";

type RegressionCases = {
  rag_intent_cases: { query: string; expected: string }[];
  extractor_slot_cases: { task: string; expectNeedsClarify: boolean }[];
  manager_rag_clarify_cases: { text: string; expectNeedsClarify: boolean; expectQuestion?: string }[];
};

const casesPath = path.resolve(process.cwd(), "server/services/nlu-regression-cases.json");
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")) as RegressionCases;

describe("Cross-agent NLU smoke tests", () => {
  it("maps DB query plan to unified task plan", () => {
    const out = queryPlanToUnifiedTaskPlan({
      intent: "detail",
      subject: "person",
      entities: { names: ["林婉清"], locations: ["上海"], orgs: [], ids: [] },
      metrics: ["足底压力测试记录"],
      dimensions: [],
      filters: { time_range: { start: "", end: "", relative: "最近7天" }, where: ["状态=有效"] },
      sort: [{ field: "created_at", direction: "desc" }],
      limit: 20,
      confidence: 0.9,
      missing_slots: [],
      needs_clarification: false,
      clarification_question: "",
    });
    expect(out.intent).toBe("db");
    expect(out.entities.names).toContain("林婉清");
    expect(out.entities.records).toContain("足底压力测试记录");
    expect(out.constraints.timeRange.relative).toBe("最近7天");
  });

  it("classifies RAG query intent types", () => {
    for (const c of cases.rag_intent_cases) {
      expect(inferQueryIntentType(c.query)).toBe(c.expected);
    }
  });

  it("detects extractor missing slots (structural)", () => {
    for (const c of cases.extractor_slot_cases) {
      expect(needsCrawlerClarifyStructural(c.task)).toBe(c.expectNeedsClarify);
    }
  });

  it("parses manager rag clarify payload", () => {
    for (const c of cases.manager_rag_clarify_cases) {
      const parsed = parseRagClarifyPayload(c.text);
      expect(parsed.needsClarify).toBe(c.expectNeedsClarify);
      if (c.expectQuestion) expect(parsed.questions).toContain(c.expectQuestion);
    }
  });
});

