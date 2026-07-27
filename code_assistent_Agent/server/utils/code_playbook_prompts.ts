/**
 * Code Playbook prompt 块（SSOT：skills/<id>/skill.md）
 */
import { resolvePlaybookSectionOrFallback, loadPlaybookBody } from "./playbook_skills";

export type CodeAgentMode = "auto" | "analyze" | "bugs" | "refactor" | "tests";

const CORE_FALLBACK = [
  "你是一个面向本仓库的代码助手 Agent。",
  "要求：",
  "- 先用工具获取事实（文件列表/读取文件/搜索）再下结论；不要臆测仓库内容。",
  "- 只要需要「读/写文件、生成文档、运行脚本、检索」等操作，必须通过工具调用完成；不要用自然语言描述「我将调用某工具」。",
  "- 输出尽量给出可执行的修改建议：明确文件路径、行范围或 diff 补丁。",
  "- 一旦完成代码修改，优先调用 validate_project 做质量校验（至少 quick；需要完整验收时使用 full）。",
  "- 根据用户提问选择输出：Bug 检测只输出潜在问题；分析输出指标/异味；重构输出可执行建议；测试输出测试样板；避免无关信息。",
  "- 做语义检索时优先用 vector_search（向量检索），必要时再用 semantic_search/ repo_search 兜底。",
  "- 发现不确定的点要说明假设与验证方法（例如如何运行脚本）。",
  "- 不要泄露任何环境变量或密钥。",
].join("\n");

const MODE_SECTION: Record<CodeAgentMode, string> = {
  auto: "ModeAuto",
  analyze: "ModeAnalyze",
  bugs: "ModeBugs",
  refactor: "ModeRefactor",
  tests: "ModeTests",
};

const MODE_FALLBACK: Record<CodeAgentMode, string> = {
  auto: "自动判断用户意图：代码分析 / Bug 检测 / 重构建议 / 测试生成。",
  analyze: "本轮优先目标：analyze。",
  bugs: "本轮优先目标：bugs。",
  refactor: "本轮优先目标：refactor。",
  tests: "本轮优先目标：tests。",
};

const FORCE_WRITE_FALLBACK = [
  "这是一个明确的代码修改请求。本轮必须至少调用一次 write_file、apply_search_replace 或 apply_diff 才能结束。",
  "如权限或配置限制导致无法写入，请先调用 list_files/read_file 收集事实，并明确返回具体阻塞原因。",
].join("\n");

const COMPUTE_SYSTEM_FALLBACK = [
  "你是总管协作链路上的计算与整理助手。",
  "只基于用户给出的上下文进行推理、计算、汇总与结构化整理。",
  "不要调用工具，不要臆测上下文中未出现的数据。",
  "当「已知上下文」列出多条结构化事实时，必须在 JSON 的 facts 中逐项收录（不得只写其中一项）。",
  "若结果适合下游图表：在 data 中输出 chart_plan（chart_title、panels[{panel_title,visual_role,chart_type,unit_kind,comparable_group,series[]}]）；配比 a:b 写 unit_kind=ratio、value=冒号后数字、display_value 保留原文；table_rows 须覆盖全部 facts；不可比指标分 panel。",
  "输出合法 JSON（含 answer、facts、可选 data）；answer 用 2～4 句概括全部关键数字与计算口径。",
].join("\n");

const COMPUTE_OUTPUT_HINT_FALLBACK =
  "请基于以上上下文做计算/整理/推导。输出 JSON，facts 覆盖上下文中全部可核对数字字段。";

export function getModeWorkflowCore(): string {
  return resolvePlaybookSectionOrFallback("mode_workflows", "Core", CORE_FALLBACK);
}

export function getModeWorkflowLine(mode: CodeAgentMode): string {
  const section = MODE_SECTION[mode] ?? "ModeAuto";
  return resolvePlaybookSectionOrFallback("mode_workflows", section, MODE_FALLBACK[mode]);
}

export function getForceWriteRetryLines(): string {
  return resolvePlaybookSectionOrFallback("mode_workflows", "ForceWrite", FORCE_WRITE_FALLBACK);
}

export function buildAgentSystemPrompt(
  mode: CodeAgentMode,
  focusPath?: string,
  memory?: { preferences?: string[]; background?: string },
): string {
  const focusLine = focusPath
    ? `当前用户选中文件：${focusPath}（相对仓库根目录）。当用户提出「分析/检测/重构/生成测试/解释代码」等请求但未提供路径时，默认使用该文件作为目标，并主动调用工具获取文件内容后再回答。`
    : "";

  const memoryLine = memory?.preferences?.length
    ? `\n### 用户长期记忆与偏好：\n${memory.preferences.map((p) => `- ${p}`).join("\n")}\n在执行任务时请务必参考以上偏好。`
    : "";

  return [getModeWorkflowCore(), getModeWorkflowLine(mode), focusLine, memoryLine]
    .filter(Boolean)
    .join("\n");
}

export function buildComputeSystemPrompt(opts: {
  mustOutputs?: string[];
  experienceContext?: string;
  inspectStrategyHint?: string;
}): string {
  const outputHint = opts.mustOutputs?.length
    ? `\n输出格式偏好：${opts.mustOutputs.join("、")}`
    : "";

  return [
    resolvePlaybookSectionOrFallback("compute_assistant", "System", COMPUTE_SYSTEM_FALLBACK),
    outputHint,
    opts.experienceContext ? `\n${opts.experienceContext}` : "",
    opts.inspectStrategyHint ? `\n${opts.inspectStrategyHint}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getCodeEditLoopPrompt(): string {
  return loadPlaybookBody('code_edit_loop')
}

export function getEditTaskPlaybookBlock(): string {
  const body = getCodeEditLoopPrompt()
  if (!body.trim()) return ''
  return body.slice(0, 4000)
}

export function getComputeUserTail(): string {
  return resolvePlaybookSectionOrFallback(
    "compute_assistant",
    "UserTail",
    COMPUTE_OUTPUT_HINT_FALLBACK,
  );
}
