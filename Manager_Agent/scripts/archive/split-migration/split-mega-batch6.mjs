/**
 * B5 batch-6: managerGraph.shared + parseBundle + proPuStack/stackImpl
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function readLines(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/)
}

function write(rel, content) {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content.endsWith('\n') ? content : content + '\n', 'utf8')
}

function sliceLines(lines, start1, end1) {
  if (end1 == null) return lines.slice(start1 - 1).join('\n')
  return lines.slice(start1 - 1, end1).join('\n')
}

// ── managerGraph.shared → core/shared/ ──
{
  const lines = readLines('server/graph/core/managerGraph.shared.ts')
  const policyBlock = sliceLines(lines, 1, 346)
  const payloadBlock = `import { z } from 'zod'
import { looksLikePromptInjectionLine, looksLikeSynthRejectingMedia } from '../../../../shared/textMarkers'
import { safeJsonParse } from '../managerGraph.llmJson'

export { safeJsonParse }

${sliceLines(lines, 348, 493)}
`
  const mediaBlock = sliceLines(lines, 495)

  write('server/graph/core/shared/policy.ts', policyBlock)
  write('server/graph/core/shared/payload.ts', payloadBlock)
  write('server/graph/core/shared/media.ts', `import { looksLikeSynthRejectingMedia } from '../../../../shared/textMarkers'

${mediaBlock}`)
  write(
    'server/graph/core/shared/index.ts',
    `export * from './policy'
export * from './payload'
export * from './media'
`
  )
  write(
    'server/graph/core/managerGraph.shared.ts',
    `/** @deprecated import from \`server/graph/core/shared/\` — B5 batch-6 */
export * from './shared/index'
`
  )
  console.log('split: managerGraph.shared → core/shared/{policy,payload,media}')
}

// ── parseBundle → parseCore + bundleBuild ──
{
  const src = 'server/graph/llm/taskOrchestrator/parseBundle.ts'
  const lines = readLines(src)
  const importBlock = sliceLines(lines, 1, 38)
  const coreBlock = sliceLines(lines, 40, 362)
  const buildBlock = sliceLines(lines, 364)

  write('server/graph/llm/taskOrchestrator/parseCore.ts', `${importBlock}

${coreBlock}
`)
  write(
    'server/graph/llm/taskOrchestrator/bundleBuild.ts',
    `${importBlock}

${buildBlock}
`
  )
  write(
    'server/graph/llm/taskOrchestrator/parseBundle.ts',
    `/** @deprecated barrel — B5 batch-6 split */
export * from './parseCore'
export * from './bundleBuild'
`
  )
  console.log('split: parseBundle → parseCore + bundleBuild')
}

// ── proPuStack/stackImpl → infer + dispatch ──
{
  const src = 'server/graph/core/proPuStack/stackImpl.ts'
  const lines = readLines(src)
  const inferBlock = sliceLines(lines, 1, 479)
  const dispatchBlock = sliceLines(lines, 480)

  write('server/graph/core/proPuStack/stackInfer.ts', inferBlock)
  write(
    'server/graph/core/proPuStack/stackDispatch.ts',
    `import type { ProPuStackResult, StepDispatchDraft } from './stackInfer'
import {
  mergeStepDispatchDraft,
  DATA_PLANE_AGENTS,
  DISPATCH_AGENTS,
  PLANE_DISPATCH_HINT
} from './stackInfer'

${dispatchBlock}
`
  )
  write(
    'server/graph/core/proPuStack/stackImpl.ts',
    `/** @deprecated barrel — B5 batch-6 split */
export * from './stackInfer'
export * from './stackDispatch'
`
  )
  const index = readLines('server/graph/core/proPuStack/index.ts').join('\n')
  if (!index.includes('stackInfer')) {
    write(
      'server/graph/core/proPuStack/index.ts',
      `${index.trim()}
export * from './stackInfer'
export * from './stackDispatch'
`
    )
  }
  console.log('split: proPuStack/stackImpl → stackInfer + stackDispatch')
}

console.log('split-mega-batch6: done')
