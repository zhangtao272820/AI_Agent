import type { Intent } from '../../utils/shared/taskPlan'
import type { TaskConstraints } from '../core/plan'
import { buildClarifyQuestionsFromContext } from '../core/plan/clarifyContext'

export type SendEvent = (event: { event: string; data?: any; from?: string }) => void

type ExperienceIndex = Record<
  string,
  {
    intent: Intent
    count: number
    successRate: number
    lastTs?: string
  }
>

function readEnvNumber(key: string, fallback?: number) {
  const raw = String(process.env[key] ?? '').trim()
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function readEnvString(key: string, fallback = '') {
  const raw = String(process.env[key] ?? '').trim()
  return raw || fallback
}

function buildClarifyQuestions(
  text: string,
  intent?: Intent,
  probe?: any,
  options?: { planIssues?: string[]; entityNames?: string[]; constraints?: TaskConstraints }
) {
  const c = options?.constraints ?? { timeHints: [], subjectHints: [], wantsVisualize: false, wantsReport: false }
  return buildClarifyQuestionsFromContext({
    text,
    timeHints: c.timeHints,
    subjectHints: c.subjectHints,
    entityNames: [...(options?.entityNames || []), ...c.subjectHints],
    planIssues: options?.planIssues,
    intent,
    probeDbMatched: Boolean(probe?.db?.matched)
  })
}

export { readEnvNumber, readEnvString, buildClarifyQuestions }
export type { ExperienceIndex }
