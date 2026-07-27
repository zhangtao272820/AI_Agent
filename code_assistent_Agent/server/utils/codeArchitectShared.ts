/**
 * Architect 模式共享类型与格式化（无 LLM 依赖，供 smoke/配置使用）
 */
export type CodeEditPlan = {
  summary: string
  steps: string[]
  target_files: string[]
  risks?: string[]
}

export function isCodeArchitectModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.CODE_ARCHITECT_MODE ?? '0').trim() === '1'
}

export function formatEditPlanBlock(plan: CodeEditPlan): string {
  const lines = [
    '## Architect 执行计划（先按计划小步 patch，再 validate）',
    plan.summary,
    ...(plan.target_files.length ? [`目标文件：${plan.target_files.join(', ')}`] : []),
    ...(plan.steps.length ? ['步骤：', ...plan.steps.map((s, i) => `${i + 1}. ${s}`)] : []),
    ...(plan.risks?.length ? [`风险：${plan.risks.join('；')}`] : []),
  ]
  return lines.filter(Boolean).join('\n')
}
