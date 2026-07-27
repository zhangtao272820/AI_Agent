/**
 * 合并 Repo Map + @mention 上下文（P2-B1 扩展）
 */
import { buildRepoMapPrompt } from '../services/repoMap'

export type BuildCodeContextInput = {
  root?: string
  question?: string
  hintFiles?: string[]
  hintSymbols?: string[]
  hintFolders?: string[]
  tokenBudget?: number
  maxFiles?: number
}

export async function buildCodeContext(input: BuildCodeContextInput = {}): Promise<string> {
  const hintFiles = [...(input.hintFiles ?? [])]
  for (const folder of input.hintFolders ?? []) {
    const f = String(folder || '').trim().replace(/\\/g, '/').replace(/\/$/, '')
    if (f && !hintFiles.includes(f)) hintFiles.push(f)
  }

  const parts: string[] = []
  const map = await buildRepoMapPrompt({
    root: input.root,
    question: input.question,
    hintFiles,
    hintSymbols: input.hintSymbols,
    tokenBudget: input.tokenBudget,
    maxFiles: input.maxFiles,
  })
  if (map) parts.push(map)

  if (hintFiles.length) {
    parts.push(`### 用户 @ 上下文\n${hintFiles.map((f) => `- ${f}`).join('\n')}`)
  }
  if (input.hintSymbols?.length) {
    parts.push(`### 关注符号\n${input.hintSymbols.map((s) => `- ${s}`).join('\n')}`)
  }

  return parts.filter(Boolean).join('\n\n')
}
