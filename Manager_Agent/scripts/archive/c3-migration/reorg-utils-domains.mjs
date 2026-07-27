/**
 * B6: Categorize flat server/utils/* (non-managerGraph) into domain subdirs + shims.
 * Behavior-neutral: old import paths preserved via re-export shims.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const utilsDir = path.join(root, 'server/utils')

const CATEGORIES = {
  db: [
    'managerDbExecutionShapeHint.ts',
    'managerDbHintsLlm.ts',
    'managerDbPrefetchAlignLlm.ts',
    'managerDbPrefetchReuse.ts',
    'managerDbQuestionLlm.ts',
    'managerDbSchemaHintsPolicy.ts',
    'managerDbTaskPayload.ts'
  ],
  code: [
    'managerCodeAuthorityLlm.ts',
    'managerCodeAuthorityNormalize.ts',
    'managerCodeDownstream.ts',
    'managerCodeFinanceLlm.ts',
    'managerCodeFinanceNormalize.ts',
    'managerCodeMeta.ts',
    'managerCodeTaskPayload.ts',
    'managerInlineCodeRun.ts'
  ],
  crawler: [
    'managerCrawlerExecutionPolicyLlm.ts',
    'managerCrawlerLeanTaskLlm.ts',
    'managerCrawlerSerpEnhance.ts',
    'managerCrawlerSerpNeedLlm.ts',
    'managerCrawlerSerpOnlyLlm.ts',
    'managerCrawlerTaskLlm.ts',
    'managerCrawlerTaskPayload.ts',
    'crawlerItemsParse.ts',
    'crawlSeedRisk.ts'
  ],
  search: [
    'managerWebSearch.ts',
    'managerWebSearchLlm.ts',
    'managerWebSearchMode.ts',
    'managerWebSearchProfile.ts',
    'managerWebDirectSynth.ts',
    'managerWebDirectSynthLlm.ts',
    'managerWebExecutionModeLlm.ts',
    'managerSearchConfig.ts',
    'managerSearchLlmTokens.ts',
    'managerSearchLoop.ts',
    'managerSearchMetrics.ts',
    'managerSearchPlanner.ts',
    'managerSearchPlannerLlm.ts',
    'managerSearchVerifier.ts',
    'managerSearchVerifierLlm.ts',
    'webSearchTool.ts'
  ],
  admin: ['managerAdminReadinessProbe.ts', 'managerAdminTaskPayload.ts'],
  rag: ['managerRagEvidenceFilter.ts', 'managerRagRelevance.ts'],
  session: [
    'managerSessionMeta.ts',
    'managerSessionStore.ts',
    'managerSessionSummaryStore.ts',
    'managerMemoryClear.ts',
    'managerMemoryEmbeddingsStore.ts',
    'managerMemoryStore.ts',
    'managerConversationLlmSummary.ts'
  ],
  route: [
    'managerRouteFeedbackStore.ts',
    'managerRouteMatrixVerify.ts',
    'managerCompositeRouteGuardLlm.ts',
    'managerTurnScopePayload.ts',
    'managerSubAgentHelpers.ts',
    'managerSubAgentScopeLlm.ts'
  ],
  platform: [
    'managerEnvModes.ts',
    'managerInteractionMode.ts',
    'platformConfigRuntime.ts',
    'agentPlatformSync.ts',
    'agentEndpoints.ts',
    'agentClients.ts',
    'evolutionHub.ts'
  ],
  chat: ['managerChatOpenAI.ts', 'managerChatWeb.ts', 'managerCleanLlm.ts', 'managerCleanPipeline.ts'],
  gui: ['managerGuiAgentAvailability.ts', 'guiConfirmBridge.ts'],
  media: ['mediaAttachment.ts', 'mediaProxyUrls.ts', 'managerVisionSanitize.ts'],
  skills: [
    'skillDraftAuto.ts',
    'skillDraftBackfillJob.ts',
    'skillDraftBatchPromote.ts',
    'skillDraftFromSuccess.ts'
  ],
  shared: [
    'taskPlan.ts',
    'taskStackStore.ts',
    'outputMarkers.ts',
    'traceLog.ts',
    'planConfirmBridge.ts',
    'managerReportGate.ts'
  ]
}

const fileToRel = new Map()
for (const [cat, files] of Object.entries(CATEGORIES)) {
  for (const f of files) {
    fileToRel.set(f, `server/utils/${cat}/${f}`)
  }
}

function rewriteRelativeImports(content, fromRel) {
  const fromDir = path.dirname(path.join(root, fromRel))
  return content.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (full, quote, spec) => {
    if (spec.startsWith('../') && !spec.startsWith('../managerGraph')) {
      return full
    }
    if (spec.startsWith('./managerGraph')) {
      return `from ${quote}../${spec.slice(2)}${quote}`
    }
    if (spec.startsWith('./skills/')) {
      return `from ${quote}./${spec.slice('./skills/'.length)}${quote}`
    }
    if (spec.startsWith('../../shared/')) {
      return `from ${quote}../../../shared/${spec.slice('../../shared/'.length)}${quote}`
    }
    if (spec.startsWith('./agents/')) {
      return `from ${quote}../agents/${spec.slice('./agents/'.length)}${quote}`
    }
    if (!spec.startsWith('./')) return full
    const base = spec.slice(2).replace(/\.ts$/, '')
    const targetFile = `${base}.ts`
    const targetRel = fileToRel.get(targetFile)
    if (!targetRel) {
      const agentsPath = path.join(utilsDir, 'agents', targetFile)
      if (fs.existsSync(agentsPath)) {
        const rel = path.relative(fromDir, path.join(utilsDir, 'agents', base)).replace(/\\/g, '/')
        const normalized = rel.startsWith('.') ? rel : `./${rel}`
        return `from ${quote}${normalized}${quote}`
      }
      const skillsPath = path.join(utilsDir, 'skills', targetFile)
      if (fs.existsSync(skillsPath)) {
        const rel = path.relative(fromDir, path.join(utilsDir, 'skills', base)).replace(/\\/g, '/')
        const normalized = rel.startsWith('.') ? rel : `./${rel}`
        return `from ${quote}${normalized}${quote}`
      }
      return full
    }
    const toPath = path.join(root, targetRel.replace(/\.ts$/, ''))
    let rel = path.relative(fromDir, toPath).replace(/\\/g, '/')
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `from ${quote}${rel}${quote}`
  })
}

let moved = 0
for (const [cat, files] of Object.entries(CATEGORIES)) {
  fs.mkdirSync(path.join(utilsDir, cat), { recursive: true })
  for (const basename of files) {
    const src = path.join(utilsDir, basename)
    if (!fs.existsSync(src)) {
      console.warn(`skip missing: ${basename}`)
      continue
    }
    const destRel = fileToRel.get(basename)
    const dest = path.join(root, destRel)
    let content = fs.readFileSync(src, 'utf8')
    content = rewriteRelativeImports(content, destRel)
    fs.writeFileSync(dest, content, 'utf8')
    fs.unlinkSync(src)
    const shim = `/** B6: utils domain reorg — re-export shim */\nexport * from './${cat}/${basename.replace(/\.ts$/, '')}'\n`
    fs.writeFileSync(path.join(utilsDir, basename), shim, 'utf8')
    moved++
  }
}

console.log(`reorg-utils-domains: moved ${moved} files into ${Object.keys(CATEGORIES).length} categories`)
