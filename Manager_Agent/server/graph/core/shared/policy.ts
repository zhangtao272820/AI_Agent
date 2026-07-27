import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export type ManagerPolicy = {
  version: number
  updatedAt: string
  db: {
    skipIfProbeUnmatched: boolean
    timeoutMsMatched: number
    timeoutMsUnmatched: number
  }
  multi: {
    maxParallel: number
  }
  critic: {
    maxRetriesMulti: number
    maxRetriesSingle: number
  }
  routing: {
    clarifyThresholdBase: number
    clarifyThresholdHinted: number
  }
}

export function defaultPolicy(): ManagerPolicy {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    db: { skipIfProbeUnmatched: true, timeoutMsMatched: 45_000, timeoutMsUnmatched: 18_000 },
    multi: { maxParallel: 3 },
    critic: { maxRetriesMulti: 1, maxRetriesSingle: 1 },
    routing: { clarifyThresholdBase: 0.6, clarifyThresholdHinted: 0.58 }
  }
}

export function extractTotalTokens(resp: any) {
  const u =
    resp?.usage_metadata ??
    resp?.response_metadata?.usage ??
    resp?.response_metadata?.tokenUsage ??
    resp?.response_metadata?.token_usage ??
    resp?.usage
  const total =
    typeof u?.total_tokens === 'number'
      ? u.total_tokens
      : typeof u?.totalTokens === 'number'
        ? u.totalTokens
        : typeof u?.total === 'number'
          ? u.total
          : undefined
  return typeof total === 'number' && Number.isFinite(total) ? total : undefined
}

export async function readHistoryEntries(jsonlPath: string, jsonPath: string, maxLines: number) {
  const fromJsonl = await fs.readFile(jsonlPath, 'utf8').catch(() => '')
  if (fromJsonl.trim()) {
    const lines = fromJsonl.split('\n').filter((l) => l.trim())
    const tail = lines.slice(-Math.max(1, maxLines))
    const out: any[] = []
    for (const line of tail) {
      try {
        out.push(JSON.parse(line))
      } catch {}
    }
    return out
  }
  const fromJson = await fs.readFile(jsonPath, 'utf8').catch(() => '')
  if (!fromJson.trim()) return []
  try {
    const obj = JSON.parse(fromJson)
    const history = Array.isArray(obj?.history) ? obj.history : []
    return history.slice(-Math.max(1, maxLines))
  } catch {
    return []
  }
}

export function clampNumber(n: any, min: number, max: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, v))
}

function normalizePolicy(input: any): ManagerPolicy {
  const base = defaultPolicy()
  const obj = typeof input === 'object' && input ? input : {}
  const db = typeof obj.db === 'object' && obj.db ? obj.db : {}
  const multi = typeof obj.multi === 'object' && obj.multi ? obj.multi : {}
  const critic = typeof obj.critic === 'object' && obj.critic ? obj.critic : {}
  const routing = typeof obj.routing === 'object' && obj.routing ? obj.routing : {}
  const out: ManagerPolicy = {
    version: Number.isFinite(Number(obj.version)) ? Number(obj.version) : base.version,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : base.updatedAt,
    db: {
      skipIfProbeUnmatched: typeof db.skipIfProbeUnmatched === 'boolean' ? db.skipIfProbeUnmatched : base.db.skipIfProbeUnmatched,
      timeoutMsMatched: Math.round(clampNumber(db.timeoutMsMatched ?? base.db.timeoutMsMatched, 2000, 90_000)),
      timeoutMsUnmatched: Math.round(clampNumber(db.timeoutMsUnmatched ?? base.db.timeoutMsUnmatched, 1500, 20_000))
    },
    multi: {
      maxParallel: Math.round(clampNumber(multi.maxParallel ?? base.multi.maxParallel, 1, 4))
    },
    critic: {
      maxRetriesMulti: Math.round(clampNumber(critic.maxRetriesMulti ?? base.critic.maxRetriesMulti, 0, 2)),
      maxRetriesSingle: Math.round(clampNumber(critic.maxRetriesSingle ?? base.critic.maxRetriesSingle, 0, 2))
    },
    routing: {
      clarifyThresholdBase: clampNumber(routing.clarifyThresholdBase ?? base.routing.clarifyThresholdBase, 0.5, 0.72),
      clarifyThresholdHinted: clampNumber(routing.clarifyThresholdHinted ?? base.routing.clarifyThresholdHinted, 0.5, 0.72)
    }
  }
  return out
}

export async function loadManagerPolicy(dir: string): Promise<ManagerPolicy> {
  try {
    const p = path.join(dir, 'manager-policy.json')
    const raw = await fs.readFile(p, 'utf8').catch(() => '')
    if (!raw.trim()) return defaultPolicy()
    return normalizePolicy(JSON.parse(raw))
  } catch {
    return defaultPolicy()
  }
}

/** 候选影子策略（仅观测/对比，运行时仍以 `manager-policy.json` 为准）；文件不存在则返回 null */
export async function loadManagerPolicyShadow(dir: string): Promise<ManagerPolicy | null> {
  const p = path.join(dir, 'manager-policy.shadow.json')
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  if (!raw.trim()) return null
  try {
    return normalizePolicy(JSON.parse(raw))
  } catch {
    return null
  }
}

/** 与当前生效策略的字段级差异摘要（用于 LangSmith / 运维 / 晋升前核对） */
export function summarizeManagerPolicyDiff(active: ManagerPolicy, shadow: ManagerPolicy): { diffPathCount: number; paths: string[] } {
  const paths: string[] = []
  const push = (label: string, a: unknown, b: unknown) => {
    if (a !== b) paths.push(`${label}: ${JSON.stringify(a)}→${JSON.stringify(b)}`)
  }
  push('version', active.version, shadow.version)
  push('db.skipIfProbeUnmatched', active.db.skipIfProbeUnmatched, shadow.db.skipIfProbeUnmatched)
  push('db.timeoutMsMatched', active.db.timeoutMsMatched, shadow.db.timeoutMsMatched)
  push('db.timeoutMsUnmatched', active.db.timeoutMsUnmatched, shadow.db.timeoutMsUnmatched)
  push('multi.maxParallel', active.multi.maxParallel, shadow.multi.maxParallel)
  push('critic.maxRetriesMulti', active.critic.maxRetriesMulti, shadow.critic.maxRetriesMulti)
  push('critic.maxRetriesSingle', active.critic.maxRetriesSingle, shadow.critic.maxRetriesSingle)
  push('routing.clarifyThresholdBase', active.routing.clarifyThresholdBase, shadow.routing.clarifyThresholdBase)
  push('routing.clarifyThresholdHinted', active.routing.clarifyThresholdHinted, shadow.routing.clarifyThresholdHinted)
  return { diffPathCount: paths.length, paths }
}

/** 设为 `0` / `false` / `off` 时关闭 finalize 后的策略自学习写入（仍加载现有 `manager-policy.json`） */
export function isManagerPolicyAutoUpdateEnabled() {
  const v = String(process.env.MANAGER_POLICY_AUTO_UPDATE ?? '1').trim().toLowerCase()
  if (!v || v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  return false
}

/**
 * 在覆盖 `manager-policy.json` 前备份当前文件，便于回滚与审计。
 * - `manager-policy.previous.json`：最近一次被替换前的完整内容
 * - `.data/policy-snapshots/`：按版本号留档（仅在有旧文件时写入）
 */
export async function backupManagerPolicyFile(dir: string) {
  const p = path.join(dir, 'manager-policy.json')
  const raw = await fs.readFile(p, 'utf8').catch(() => '')
  if (!raw.trim()) return
  const prevPath = path.join(dir, 'manager-policy.previous.json')
  await fs.writeFile(prevPath, raw, 'utf8').catch(() => undefined)
  let version = 1
  try {
    version = Number(JSON.parse(raw)?.version) || 1
  } catch {
    version = 1
  }
  const snapDir = path.join(dir, 'policy-snapshots')
  await fs.mkdir(snapDir, { recursive: true }).catch(() => undefined)
  const safeTs = new Date().toISOString().replace(/[:.]/g, '-')
  const snapPath = path.join(snapDir, `manager-policy-v${version}-${safeTs}.json`)
  await fs.writeFile(snapPath, raw, 'utf8').catch(() => undefined)
}

/** 用 `manager-policy.previous.json` 覆盖当前策略；成功后可立即生效于新请求 */
export async function restoreManagerPolicyFromPrevious(dir: string): Promise<{ ok: boolean; message: string }> {
  const prevPath = path.join(dir, 'manager-policy.previous.json')
  const curPath = path.join(dir, 'manager-policy.json')
  const prev = await fs.readFile(prevPath, 'utf8').catch(() => '')
  if (!prev.trim()) {
    return { ok: false, message: 'manager-policy.previous.json 不存在或为空' }
  }
  try {
    normalizePolicy(JSON.parse(prev))
  } catch {
    return { ok: false, message: 'previous 文件不是合法策略 JSON' }
  }
  await fs.writeFile(curPath, prev, 'utf8')
  let v = 0
  try {
    v = Number(JSON.parse(prev)?.version) || 0
  } catch {
    v = 0
  }
  return { ok: true, message: `已回滚到上一版策略（version≈${v}）` }
}

/** finalize 策略统计是否更偏近期经验：`0` 关闭（每条权重 1） */
function policyLearnRecencyEnabled() {
  const v = String(process.env.MANAGER_POLICY_LEARN_RECENCY ?? '1').trim().toLowerCase()
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no')
}

function policyLearnRecencyWeight(entryTs: unknown): number {
  if (!policyLearnRecencyEnabled()) return 1
  const raw = process.env.MANAGER_POLICY_LEARN_RECENCY_HALF_LIFE_DAYS
  const n = raw == null || String(raw).trim() === '' ? 14 : Number(raw)
  const halfLifeDays = Number.isFinite(n) && n >= 0.5 && n <= 120 ? n : 14
  const t = Date.parse(String(entryTs || ''))
  if (!Number.isFinite(t)) return 1
  const days = Math.max(0, (Date.now() - t) / 86_400_000)
  return Math.exp((-Math.LN2 * days) / halfLifeDays)
}

export async function maybeUpdateManagerPolicy(dir: string): Promise<{ updated: boolean; fromVersion?: number; toVersion?: number; reason?: string }> {
  if (!isManagerPolicyAutoUpdateEnabled()) return { updated: false, reason: 'disabled' }

  const current = await loadManagerPolicy(dir)
  const updatedAtMs = Number.isFinite(Date.parse(current.updatedAt)) ? Date.parse(current.updatedAt) : 0
  if (Date.now() - updatedAtMs < 10_000) return { updated: false, reason: 'cooldown' }

  const memJsonlPath = path.join(dir, 'manager-memory.jsonl')
  const memJsonPath = path.join(dir, 'manager-memory.json')
  const history = await readHistoryEntries(memJsonlPath, memJsonPath, 420)
  const exps = (Array.isArray(history) ? history : []).filter((h) => h?.type === 'experience').slice(-90)
  if (exps.length < 12) return { updated: false, reason: 'insufficient_samples' }

  let noClarifyBad = 0
  let noClarifyTotal = 0
  let clarifyButGood = 0
  let clarifyTotal = 0

  let dbUnmatchedTotal = 0
  let dbUnmatchedUsedDb = 0

  let multiCount = 0
  let multiScoreSum = 0
  let multiDurSum = 0

  for (const e of exps) {
    const w = policyLearnRecencyWeight(e?.ts)
    const score = Number(e?.successScore ?? 0)
    const needsClarify = Boolean(e?.needsClarify)
    if (needsClarify) {
      clarifyTotal += w
      if (score >= 0.75) clarifyButGood += w
    } else {
      noClarifyTotal += w
      if (score < 0.6) noClarifyBad += w
    }

    const probeDbMatched = e?.probeDbMatched
    const pathArr = Array.isArray(e?.path) ? e.path.map((x: any) => String(x)) : []
    const usedDb = pathArr.includes('db')
    if (probeDbMatched === false) {
      dbUnmatchedTotal += w
      if (usedDb) dbUnmatchedUsedDb += w
    }

    if (pathArr.length > 1) {
      multiCount += w
      multiScoreSum += (Number.isFinite(score) ? score : 0) * w
      const dur = Number(e?.durationMs ?? 0)
      multiDurSum += (Number.isFinite(dur) ? dur : 0) * w
    }
  }

  const next: ManagerPolicy = normalizePolicy({
    ...current,
    updatedAt: current.updatedAt
  })

  const learnStep = (() => {
    const raw = process.env.MANAGER_POLICY_LEARN_STEP
    const n = raw == null || String(raw).trim() === '' ? 0.02 : Number(raw)
    return Number.isFinite(n) ? clampNumber(n, 0.005, 0.08) : 0.02
  })()

  const noClarifyBadRate = noClarifyTotal ? noClarifyBad / noClarifyTotal : 0
  const clarifyButGoodRate = clarifyTotal ? clarifyButGood / clarifyTotal : 0
  if (noClarifyBadRate > 0.25) {
    next.routing.clarifyThresholdBase = clampNumber(next.routing.clarifyThresholdBase + learnStep, 0.5, 0.72)
    next.routing.clarifyThresholdHinted = clampNumber(next.routing.clarifyThresholdHinted + learnStep, 0.5, 0.72)
  } else if (clarifyButGoodRate > 0.25) {
    next.routing.clarifyThresholdBase = clampNumber(next.routing.clarifyThresholdBase - learnStep, 0.5, 0.72)
    next.routing.clarifyThresholdHinted = clampNumber(next.routing.clarifyThresholdHinted - learnStep, 0.5, 0.72)
  }

  const dbWasteRate = dbUnmatchedTotal ? dbUnmatchedUsedDb / dbUnmatchedTotal : 0
  if (dbUnmatchedTotal >= 6 && dbWasteRate > 0.2) {
    next.db.skipIfProbeUnmatched = true
    next.db.timeoutMsUnmatched = Math.round(clampNumber(Math.min(next.db.timeoutMsUnmatched, 4000), 1500, 20_000))
  }

  if (multiCount >= 8) {
    const avgScore = multiScoreSum / Math.max(1e-6, multiCount)
    const avgDur = multiDurSum / Math.max(1e-6, multiCount)
    next.critic.maxRetriesMulti = avgScore < 0.62 && avgDur < 25_000 ? 2 : 1
    next.multi.maxParallel = avgDur > 45_000 ? 2 : 3
  }

  const planOutcomes = (Array.isArray(history) ? history : []).filter((h) => h?.type === 'plan_outcome').slice(-40)
  if (planOutcomes.length >= 10) {
    let ruleN = 0
    let llmN = 0
    for (const p of planOutcomes) {
      if (p?.source === 'rule' || p?.ruleFallback) ruleN += 1
      else if (p?.source === 'llm') llmN += 1
    }
    const ruleRate = ruleN / planOutcomes.length
    if (ruleRate > 0.5) {
      next.routing.clarifyThresholdBase = clampNumber(next.routing.clarifyThresholdBase + learnStep * 0.5, 0.5, 0.72)
      next.multi.maxParallel = Math.min(next.multi.maxParallel, 2)
    } else if (llmN / planOutcomes.length > 0.65) {
      next.routing.clarifyThresholdHinted = clampNumber(next.routing.clarifyThresholdHinted - learnStep * 0.35, 0.5, 0.72)
    }
  }

  const changed =
    JSON.stringify({ ...current, updatedAt: '' }) !== JSON.stringify({ ...next, updatedAt: '' }) ||
    current.db.skipIfProbeUnmatched !== next.db.skipIfProbeUnmatched

  if (!changed) return { updated: false, reason: 'no_change' }
  next.updatedAt = new Date().toISOString()
  next.version = Number(current.version || 1) + 1
  const fromVersion = Number(current.version || 1)
  const toVersion = Number(next.version || fromVersion + 1)

  await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
  const p = path.join(dir, 'manager-policy.json')
  await backupManagerPolicyFile(dir).catch(() => undefined)
  await fs.writeFile(p, JSON.stringify(next, null, 2), 'utf8')
  return { updated: true, fromVersion, toVersion, reason: 'updated' }
}
