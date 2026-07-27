import {
  autoPromoteEligiblePatches,
  autoPromoteEligiblePatchesVerified,
  promotePromptPatch,
  promotePromptPatchVerified,
} from '../../utils/prompt_evolution'
import { getExtractorAgentEnv } from '../../utils/extractor_agent_env'
import { isPromoteVerifyRequired } from '#agent-shared/evolutionPromotePolicy'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) as {
    patchId?: string
    auto?: boolean
    minHits?: number
  } | null

  if (body?.auto) {
    const minHits = Number.isFinite(body.minHits) ? Number(body.minHits) : getExtractorAgentEnv().promptPromoteMinHits
    if (isPromoteVerifyRequired()) {
      const verified = await autoPromoteEligiblePatchesVerified(minHits)
      return { ok: true, promoted: verified.promoted, count: verified.promoted.length, verify: verified.verify }
    }
    const promoted = autoPromoteEligiblePatches(minHits)
    return { ok: true, promoted, count: promoted.length }
  }

  const patchId = String(body?.patchId ?? '').trim()
  if (!patchId) {
    throw createError({ statusCode: 400, statusMessage: '请提供 patchId 或 auto=true' })
  }

  const res = isPromoteVerifyRequired() ? await promotePromptPatchVerified(patchId) : promotePromptPatch(patchId)
  if (!res.ok) {
    throw createError({ statusCode: 400, statusMessage: res.reason })
  }
  return { ok: true, hintId: res.hintId }
})
