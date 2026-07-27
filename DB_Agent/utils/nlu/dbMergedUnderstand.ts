/**
 * DB Stage-4 合并理解：多轮 condense + intent + 槽位拆解编排入口。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { QueryPlan } from "./query_plan";
import { buildQueryPlanViaDecomposition } from "./dbQueryDecompose";
import { resolveNeedsCondense, needsCondenseStructural } from "./dbCondenseLlm";
import { mergeFollowupQuestionWithHistory } from "./followup";
import { getMessageRole } from "./memory";
import { recallDbIntentPlaybook } from "./dbIntentRag";
import { sanitizeCondensedQuestion } from "./text";
import { createCondenseQuestionPrompt } from "./prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { incrementLlmCallCount } from "../llm_call_counter";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

export type DbMergedUnderstandResult = {
  standaloneQuestion: string;
  planQuestion: string;
  needsCondense: boolean;
  multiTurn: boolean;
  intentRecallId?: string;
  decomposed: Awaited<ReturnType<typeof buildQueryPlanViaDecomposition>> | null;
};

function humanTexts(messages: BaseMessage[]): string[] {
  return messages
    .filter((m) => getMessageRole(m as any) === "human")
    .map((m) => String((m as any).content ?? "").trim())
    .filter(Boolean);
}

export function shouldRunDbMultiTurnMerge(messages: BaseMessage[], lastUser: string): boolean {
  const texts = humanTexts(messages);
  if (texts.length < 2) return false;
  const last = String(lastUser || "").trim();
  const prev = texts[texts.length - 2]!;
  if (!last || !prev) return false;
  if (last.length > 200) return false;
  if (needsCondenseStructural(last)) return true;
  if (last.length <= Math.max(40, Math.floor(prev.length * 0.55))) return true;
  return false;
}

export function isDbMergedUnderstandEnabled(): boolean {
  return isDbNluFeatureEnabled("merged");
}

/**
 * DB Stage-4：多轮合并 → 独立问句 → 意图 RAG hint → 解耦 plan。
 */
export async function understandDbQueryMerged(input: {
  question: string;
  chatHistory?: BaseMessage[];
  model: BaseLanguageModel | null;
  condenseModel?: BaseLanguageModel | null;
  monolithicPlan?: QueryPlan | null;
  skipCondense?: boolean;
}): Promise<DbMergedUnderstandResult> {
  const raw = String(input.question ?? "").trim();
  const hist = input.chatHistory ?? [];
  const multiTurn = shouldRunDbMultiTurnMerge(hist, raw);
  let standalone = raw;

  if (!input.skipCondense && isDbMergedUnderstandEnabled()) {
    const condenseModel = (input.condenseModel ?? input.model) as import("@langchain/openai").ChatOpenAI | null;
    const needsCondense = await resolveNeedsCondense(condenseModel, raw);
    if (needsCondense && hist.length > 0 && condenseModel) {
      try {
        const chain = RunnableSequence.from([
          createCondenseQuestionPrompt(),
          condenseModel,
          new StringOutputParser(),
        ]);
        const out = await chain.invoke({ chat_history: hist, question: raw });
        incrementLlmCallCount(1);
        standalone = sanitizeCondensedQuestion(out) || raw;
      } catch {
        standalone = raw;
      }
    }
  }

  const planQuestion = mergeFollowupQuestionWithHistory(standalone, hist, getMessageRole);
  const recall = recallDbIntentPlaybook(planQuestion);

  let decomposed: Awaited<ReturnType<typeof buildQueryPlanViaDecomposition>> = null;
  if (isDbMergedUnderstandEnabled() && input.model) {
    decomposed = await buildQueryPlanViaDecomposition(input.model, planQuestion, input.monolithicPlan ?? null);
    if (recall && decomposed && decomposed.intentSource !== "llm") {
      decomposed = { ...decomposed, dbIntent: recall.intent, intentSource: "playbook_rag" };
    }
  }

  return {
    standaloneQuestion: standalone,
    planQuestion,
    needsCondense: standalone !== raw,
    multiTurn,
    intentRecallId: recall?.id,
    decomposed,
  };
}
