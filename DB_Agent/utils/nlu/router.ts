import { getRouterRuleLines } from "./policy";

export function buildRouterTemplate(
  skills: { id: string; description: string; enabled?: boolean }[],
  domainEnabled: boolean,
) {
  const lines: string[] = [];
  lines.push("你是一个“意图路由器”。");
  lines.push("你要为下面的独立问题选择最合适的处理方式（只输出一个标签，不要输出其它任何文字）：");
  lines.push("");
  lines.push("可用技能（第一层：只依据技能描述做选择）：");
  for (const s of skills) {
    if (s.enabled === false) continue;
    const id = String(s?.id ?? "").trim();
    const desc = String(s?.description ?? "").trim();
    if (!id || id === "help") continue;
    lines.push(`- ${id}：${desc || "（无描述）"}`);
  }
  lines.push("- help：输出能力清单与示例问题");
  lines.push("- out_of_scope：与当前业务数据库无关的问题（如天气、新闻、常识、娱乐等）");
  lines.push("");
  lines.push("规则补充：");
  lines.push(...getRouterRuleLines(domainEnabled));
  lines.push("");
  lines.push("<question>");
  lines.push("{standalone_question}");
  lines.push("</question>");
  lines.push("");
  const allowed = ["help", ...skills.map((s) => String(s.id ?? "").trim()).filter(Boolean), "out_of_scope"];
  const unique = Array.from(new Set(allowed.filter(Boolean)));
  lines.push(`只允许输出：${unique.join(" / ")}`);
  return lines.join("\n");
}
