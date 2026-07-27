import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  buildWorldModelSnapshot,
  isPredictiveWorldModelEnabled,
  isWorldModelEnabled,
  loadWorldModelSnapshot
} from '../../graph/core/task/worldModel'
import { resolveUserId } from '../../graph/core/task/userIdentity'

const SessionIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/)

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const policyDir = path.join(process.cwd(), '.data')

  if (!isWorldModelEnabled()) {
    return { ok: true, enabled: false, snapshot: null }
  }

  const sessionId = query.sessionId ? SessionIdSchema.parse(String(query.sessionId)) : null
  if (!sessionId) {
    return { ok: true, enabled: true, snapshot: null, hint: 'pass sessionId' }
  }

  const userId = query.userId
    ? await resolveUserId(policyDir, sessionId, String(query.userId))
    : await resolveUserId(policyDir, sessionId)

  if (query.refresh === '1' || query.refresh === 'true') {
    let toolHealth: unknown = null
    try {
      const raw = await fs.readFile(path.join(policyDir, 'manager-tool-health.json'), 'utf8')
      toolHealth = JSON.parse(raw)
    } catch {}
    const snapshot = await buildWorldModelSnapshot(policyDir, sessionId, { toolHealth, userId: userId || undefined })
    return {
      ok: true,
      enabled: true,
      predictive: isPredictiveWorldModelEnabled(),
      snapshot,
      source: 'live'
    }
  }

  const snapshot = await loadWorldModelSnapshot(policyDir, sessionId)
  return {
    ok: true,
    enabled: true,
    predictive: isPredictiveWorldModelEnabled(),
    snapshot,
    source: snapshot ? 'cache' : 'none'
  }
})
