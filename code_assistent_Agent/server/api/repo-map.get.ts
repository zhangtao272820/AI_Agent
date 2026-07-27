import { getQuery } from 'h3'
import { buildCodeContext } from '../utils/buildCodeContext'
import { getCodeAgentEnv } from '../utils/code_agent_env'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const env = getCodeAgentEnv()
  const question = String(q.question ?? '').trim()
  const hintFiles = String(q.hint_files ?? q.hintFiles ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const hintSymbols = String(q.hint_symbols ?? q.hintSymbols ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const root = q.root ? String(q.root) : undefined
  const tokenBudget = q.tokens ? Number(q.tokens) : env.repoMapTokenBudget
  const maxFiles = q.max_files ? Number(q.max_files) : env.repoMapMaxFiles

  if (!env.repoMapEnabled) {
    return { ok: true, enabled: false, context: '', length: 0 }
  }

  const context = await buildCodeContext({
    root,
    question: question || undefined,
    hintFiles,
    hintSymbols,
    tokenBudget: Number.isFinite(tokenBudget) ? tokenBudget : env.repoMapTokenBudget,
    maxFiles: Number.isFinite(maxFiles) ? maxFiles : env.repoMapMaxFiles,
  })

  return {
    ok: true,
    enabled: true,
    context,
    length: context.length,
    token_budget: Number.isFinite(tokenBudget) ? tokenBudget : env.repoMapTokenBudget,
    hint_files: hintFiles,
  }
})
