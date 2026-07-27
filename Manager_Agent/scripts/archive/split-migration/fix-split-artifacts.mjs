/**
 * Fix paths and early returns after split-ws-handlers.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const handlersDir = path.join(process.cwd(), 'server/api/manager-ws/handlers')

const DEPS_DESTRUCT = `  const {
    ensureNotAborted,
    opts,
    llmInvoke,
    lastUserText,
    runAlwaysInternalCollaborators,
    extractStructuredPayload,
    sanitizeUntrustedText,
    formatReferences,
    stripLatexMath,
    summarize,
    mergeMeta,
    getEffectivePlanSteps,
    timeLeftMs,
    policyPromise,
    defaultPolicy,
    appendMemory,
    appendNluMetrics,
    maybeUpdateManagerPolicy,
    policyDir,
    readFeedbackForRun,
    clampNumber,
    deriveScenarioKey,
    uncertaintyFromConfidence,
    normalizeFinalUserText,
    redactSecrets,
    safeJsonParse,
    IntentSchema
  } = deps
`

for (const file of fs.readdirSync(handlersDir)) {
  if (!file.endsWith('.ts')) continue
  let content = fs.readFileSync(path.join(handlersDir, file), 'utf8')
  content = content
    .replaceAll("from './schemas'", "from '../schemas'")
    .replaceAll("from './runtimeState'", "from '../runtimeState'")
    .replaceAll("from './wsSessionHelpers'", "from '../wsSessionHelpers'")
  if (file === 'setup.ts') {
    content = content.replace(
      /send\('error',[^)]+\)\s*\n\s*return\s*(?!{)/g,
      (m) => m.replace(/return\s*$/, 'return { ok: false, send }')
    )
  }
  fs.writeFileSync(path.join(handlersDir, file), content)
}

const dispatch = path.join(process.cwd(), 'server/api/manager-ws/dispatchIncomingMessage.ts')
fs.writeFileSync(
  dispatch,
  `import { setupWsMessage } from './handlers/setup'
import { dispatchWsByType } from './handlers/registry'

export async function dispatchIncomingMessage(peer: any, message: any) {
  const setup = await setupWsMessage(peer, message)
  if (!setup.ok) return
  await dispatchWsByType(setup.ctx, setup.type, setup.payload)
}
`
)

// Fix final node builders: deps destructuring + return inner fn
const finalDir = path.join(process.cwd(), 'server/graph/nodes/final')
for (const name of ['synthNode.ts', 'criticNode.ts', 'verifierNode.ts', 'finalizeNode.ts']) {
  const p = path.join(finalDir, name)
  let c = fs.readFileSync(p, 'utf8')
  c = c.replace(/export function build(\w+)\(deps: CreateFinalNodesDeps\) \{\n\s+const (\w+) = async/, (full, cap, varName) => {
    return `export function build${cap}(deps: CreateFinalNodesDeps) {\n${DEPS_DESTRUCT}\n  return async`
  })
  fs.writeFileSync(p, c)
}

let types = fs.readFileSync(path.join(finalDir, 'types.ts'), 'utf8')
types = types.replace('type CreateFinalNodesDeps', 'export type CreateFinalNodesDeps')
// strip duplicate imports from types - keep only type definition
const typeStart = types.indexOf('export type CreateFinalNodesDeps')
if (typeStart > 0) {
  types = `import type { LlmInvokeOptions } from '../core/managerGraph.modelTier'\n\n${types.slice(typeStart)}`
}
fs.writeFileSync(path.join(finalDir, 'types.ts'), types)

console.log('fix-split-artifacts: done')
