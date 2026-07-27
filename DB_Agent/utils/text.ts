/**
 * 文件用途：对外输出文本清洗与答案包装。
 *
 * 主要职责：
 * - sanitizeAssistantText：清除链路/框架在异常场景夹带的调试噪声
 * - formatValueAnswer：单值结果包装（优先 QueryPlan，不对问句做正则分类）
 * - humanizeAssistantText：兼容 Final Answer 格式
 */
import type { QueryPlan } from "./nlu/query_plan";
import type { QueryExecutionShape } from "./nlu/dbQueryExecutionShapeLlm";
import { formatValueWithPlan, planRequestsContactReveal } from "./nlu/dbAnswerFormat";

export function sanitizeAssistantText(input: unknown, opts?: { allowContact?: boolean }) {
  const text = typeof input === "string" ? input : String(input ?? "");
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push("");
      continue;
    }
    if (/agent\s+stopped\s+due\s+to\s+max\s+iterations/i.test(t)) continue;
    if (/^troubleshooting url\s*:/i.test(t)) continue;
    if (/js\.langchain\.com\/docs\/troubleshooting/i.test(t)) continue;
    if (/output_parsing_failure/i.test(t)) continue;
    kept.push(line);
  }
  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  out = out.replace(/`[a-z0-9]+(?:_[a-z0-9]+){2,}`/gi, "`数据表`");
  out = out.replace(/\b[a-z0-9]+(?:_[a-z0-9]+){3,}\b/gi, "数据表");
  out = out.replace(
    /\b(?:person_info|person_health_records|device_info|person_emergency_contact|person_crowd_type|person_selfcare_conditions|person_live_conditions|person_life_conditions|remote_medicine_patient_log|remote_nursing_chronic|remote_activity_foot_log|remote_activity_foot_measure_log)\b/gi,
    "数据表",
  );
  out = out.replace(/\binformation_schema\b/gi, "系统表");
  out = out.replace(/(^|\n)\s*Table:\s*[a-z0-9_]+/gi, "$1Table: 数据表");

  out = out.replace(/\b(?:id|ID)\s*[:：=]\s*\d+\b/g, "");
  out = out.replace(/\bid\s*=\s*\d+\b/gi, "");
  out = out.replace(/\b[a-z0-9_]*_id\s*[:：=]\s*\d+\b/gi, "");
  out = out.replace(/"id"\s*:\s*\d+\s*,?/gi, "");
  out = out.replace(/"[a-z0-9_]*_id"\s*:\s*\d+\s*,?/gi, "");
  out = out.replace(/"编号"\s*:\s*\d+\s*,?/gi, "");
  out = out.replace(/编号\s*[:：=]?\s*\d+\b/g, "");

  // 属性查询明确要手机号时不脱敏；概览仍遮蔽
  if (!opts?.allowContact) {
    out = out.replace(/\b1\d{10}\b/g, (m) => `${m.slice(0, 3)}****${m.slice(-4)}`);
  }
  out = out.replace(/\b\d{17}[\dXx]\b/g, (m) => `${m.slice(0, 6)}********${m.slice(-4)}`);
  out = out.replace(/\b\d{15}\b/g, (m) => `${m.slice(0, 6)}*****${m.slice(-4)}`);

  out = out.replace(/[，,]\s*(?:[，,]\s*)+/g, "，");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** 按 QueryPlan metrics 决定是否放行联系方式明文 */
export function sanitizeAssistantTextForPlan(input: unknown, plan?: QueryPlan | null) {
  return sanitizeAssistantText(input, { allowContact: planRequestsContactReveal(plan) });
}

export function formatValueAnswer(
  _question: string,
  value: unknown,
  opts?: { queryPlan?: QueryPlan | null; executionShape?: QueryExecutionShape | null },
) {
  return formatValueWithPlan(value, opts?.queryPlan, opts?.executionShape);
}

export function humanizeAssistantText(
  question: string,
  text: string,
  opts?: { queryPlan?: QueryPlan | null; executionShape?: QueryExecutionShape | null },
) {
  const t = String(text ?? "").trim();
  const m = t.match(/^(?:Final Answer|Answer)\s*:\s*([\s\S]*)$/i);
  if (m) {
    const raw = (m?.[1] ?? "").trim().replace(/^["“”]+|["“”]+$/g, "");
    return formatValueAnswer(question, raw, opts);
  }
  return t;
}

/** 在确定性列表前后加简短自然语，减轻「只吐数据」的机械感（表名仍由上游清洗）。 */
export function wrapConversationalDataReply(question: string, body: string): string {
  const q = String(question ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  const core = String(body ?? "").trim();
  if (!core) return "";
  const intro =
    q.length >= 4 ? `根据您的问题「${q}」，我整理出下面可查到的内容。\n\n` : `根据当前检索条件，整理出下面可查到的内容。\n\n`;
  const tail = `\n\n如果还想按时间、人员或指标再收窄一点，直接补充一句即可。`;
  return intro + core + tail;
}
