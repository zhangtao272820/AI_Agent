/**
 * 多文件 edit 子任务拆分（P3 subagent MVP）
 */
export type FileSubtask = {
  subId: string
  question: string
  hintFiles: string[]
}

export function isCodeSubagentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.CODE_SUBAGENT_ENABLED ?? '0').trim() === '1'
}

export function resolveSubagentMinFiles(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CODE_SUBAGENT_MIN_FILES ?? 3)
  return Number.isFinite(n) && n >= 2 ? Math.floor(n) : 3
}

export function shouldUseFileSubagents(input: {
  taskKind: string
  hintFiles?: string[]
  enabled?: boolean
  minFiles?: number
}): boolean {
  if (!input.enabled || input.taskKind !== 'edit') return false
  const files = (input.hintFiles ?? []).filter(Boolean)
  return files.length >= (input.minFiles ?? 3)
}

export function planFileSubagents(input: {
  question: string
  hintFiles: string[]
}): FileSubtask[] {
  const files = [...new Set(input.hintFiles.map((f) => String(f).trim()).filter(Boolean))]
  const baseQ = String(input.question || '').trim()
  return files.map((file, idx) => ({
    subId: String(idx + 1),
    question: `${baseQ}\n\n本子任务仅修改：${file}`,
    hintFiles: [file],
  }))
}
