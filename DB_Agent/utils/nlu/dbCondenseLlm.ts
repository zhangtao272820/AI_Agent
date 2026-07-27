/**
 * 追问是否需要改写为独立问句：结构性指代 + 可选 LLM 判定。
 */
import { z } from "zod";
import type { ChatOpenAI } from "@langchain/openai";
import { incrementLlmCallCount } from "../llm_call_counter";
import { isDbNluFeatureEnabled } from "../db_nlu_mode";

const CondenseSchema = z.object({
  needs_condense: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});

const REFER_WORDS = [
  "这里", "那里", "上述", "同上", "上面", "前面", "刚才", "上次", "继续", "他", "她", "这个", "那个",
] as const;

const SHORT_FOLLOWUPS = [
  "年龄", "住址", "地址", "电话", "手机号", "紧急联系人", "居住情况", "自理情况", "生活情况",
  "人群分类", "基本信息", "信息", "情况", "资料",
] as const;

function safeJsonParse(text: string): unknown {
  const s = String(text ?? "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function isDbCondenseLlmEnabled(): boolean {
  return isDbNluFeatureEnabled("condense");
}

/** 结构性：指代词 / 极短续问 / 槽位词表（非业务正则分类） */
export function needsCondenseStructural(question: string): boolean {
  const q = String(question ?? "").trim();
  if (!q) return false;
  const t = q.replace(/\s+/g, "");
  if (REFER_WORDS.some((w) => t.includes(w))) return true;
  const bare = t.replace(/[？?呢]/g, "");
  if (SHORT_FOLLOWUPS.includes(bare as (typeof SHORT_FOLLOWUPS)[number])) return true;
  if (SHORT_FOLLOWUPS.includes(t as (typeof SHORT_FOLLOWUPS)[number])) return true;
  return t.length <= 6;
}

export async function needsCondenseByLlm(model: ChatOpenAI | null, question: string): Promise<boolean | null> {
  if (!model) return null;
  const q = String(question ?? "").trim();
  if (!q || q.length < 2) return null;
  try {
    incrementLlmCallCount(1);
    const res = await model.invoke([
      [
        "system",
        [
          "你是数据库对话追问判定器。判断当前用户句是否依赖上文指代、必须结合历史才能独立查库。",
          "needs_condense=true：含指代/续问/省略主语（如「那年龄呢」「继续」「上面那个人的地址」）。",
          "needs_condense=false：已是完整独立问句。",
          '只输出 JSON：{"needs_condense":boolean,"confidence":number}',
        ].join("\n"),
      ],
      ["human", q.slice(0, 600)],
    ]);
    const parsed = CondenseSchema.safeParse(safeJsonParse(String((res as { content?: string })?.content ?? "")));
    if (!parsed.success || Number(parsed.data.confidence ?? 0) < 0.5) return null;
    return parsed.data.needs_condense;
  } catch {
    return null;
  }
}

export async function resolveNeedsCondense(model: ChatOpenAI | null, question: string): Promise<boolean> {
  const structural = needsCondenseStructural(question);
  if (!isDbCondenseLlmEnabled()) return structural;
  if (structural && question.replace(/\s+/g, "").length <= 4) return true;
  const llm = await needsCondenseByLlm(model, question);
  if (llm != null) return llm;
  return structural;
}
