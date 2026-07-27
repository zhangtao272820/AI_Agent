/**
 * Trim unused imports + createExecContext destructuring in exec/*Node.ts.
 * Usage: node scripts/trim-exec-node-imports.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const execDir = path.join(process.cwd(), 'server/graph/nodes/exec')
const contextKeys = new Set([
  'ensureNotAborted', 'opts', 'policyPromise', 'defaultPolicy', 'lastUserText',
  'hasStrongDbAnchor', 'callDbAgent', 'appendMetrics', 'isDbNoData', 'emitTrace',
  'summarize', 'deriveScenarioKey', 'callRagAgent', 'ragEvidenceFromProbe',
  'probeRagEvidence', 'parseRagClarifyPayload', 'mergeTaskPlan', 'getEffectivePlanSteps',
  'mergeMeta', 'callCodeAgent', 'callAiAdminAgent', 'callCrawlerAgent', 'callLobsterAgent',
  'parseCrawlerClarifyPayload', 'crawlerTaskPlanPatch', 'runInternalAgent',
  'filterCrawlerResultDomestic', 'callMultimodalAgent', 'callMusicAgent', 'callVideoAgent',
  'ragRelevanceJudge', 'ragEvidenceMatchJudge', 'ragScopeHintJudge', 'llmInvoke',
  'notifyAgentFailure'
])

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function parseImportBlocks(src) {
  const blocks = []
  const re = /^import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  for (const m of src.matchAll(re)) {
    const isTypeOnly = m[0].startsWith('import type')
    const names = m[1]
      ? m[1].split(',').map((x) => {
          const t = x.trim()
          const parts = t.split(/\s+as\s+/)
          return { imported: parts[0].trim(), local: (parts[1] || parts[0]).trim(), isType: isTypeOnly || t.startsWith('type ') }
        })
      : [{ imported: m[2], local: m[2], isType: isTypeOnly }]
    blocks.push({ raw: m[0], module: m[3], names, start: m.index, end: m.index + m[0].length })
  }
  return blocks
}

function groupImports(blocks) {
  const byModule = new Map()
  for (const b of blocks) {
    const key = `${b.module}|${b.names.every((n) => n.isType) ? 'type' : 'value'}`
    if (!byModule.has(key)) byModule.set(key, { module: b.module, typeOnly: b.names.every((n) => n.isType), names: [] })
    byModule.get(key).names.push(...b.names)
  }
  return byModule
}

function renderImports(byModule, keepLocals) {
  const lines = []
  const sorted = [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module))
  for (const g of sorted) {
    const kept = g.names.filter((n) => keepLocals.has(n.local))
    if (!kept.length) continue
    const uniq = []
    const seen = new Set()
    for (const n of kept) {
      if (seen.has(n.local)) continue
      seen.add(n.local)
      uniq.push(n)
    }
    if (g.typeOnly || uniq.every((n) => n.isType)) {
      const parts = uniq.map((n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`))
      lines.push(`import type { ${parts.join(', ')} } from '${g.module}'`)
    } else {
      const valueParts = uniq.filter((n) => !n.isType).map((n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`))
      const typeParts = uniq.filter((n) => n.isType).map((n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`))
      if (valueParts.length) lines.push(`import { ${valueParts.join(', ')} } from '${g.module}'`)
      if (typeParts.length) lines.push(`import type { ${typeParts.join(', ')} } from '${g.module}'`)
    }
  }
  return lines.join('\n')
}

function parseDestructureKeys(src) {
  const m = src.match(/const\s*\{([^}]+)\}\s*=\s*createExecContext\(deps\)/s)
  if (!m) return []
  return m[1].split(',').map((x) => x.trim()).filter(Boolean)
}

function usedIdentifiers(code) {
  const used = new Set()
  const re = /\b([A-Za-z_$][\w$]*)\b/g
  for (const m of code.matchAll(re)) used.add(m[1])
  return used
}

function normalizeNewlines(s) {
  return s.replace(/\r\n/g, '\n')
}

function trimFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const src = normalizeNewlines(raw)
  const importEnd = src.indexOf('\n\nexport function')
  if (importEnd < 0) {
    console.warn('skip (no export function):', filePath)
    return false
  }
  const importSection = src.slice(0, importEnd)
  const rest = src.slice(importEnd + 2)
  const blocks = parseImportBlocks(importSection)
  const destructureMatch = rest.match(/^(export function[\s\S]*?const\s*\{)([^}]+)(\}\s*=\s*createExecContext\(deps\))/s)
  if (!destructureMatch) {
    console.warn('skip (no createExecContext destructure):', filePath)
    return false
  }
  const fnHead = destructureMatch[1]
  const destructureKeys = destructureMatch[2].split(',').map((x) => x.trim()).filter(Boolean)
  const destructureTail = destructureMatch[3]
  const body = rest.slice(destructureMatch[0].length)
  const bodyUsed = usedIdentifiers(stripComments(body))

  const keptDestructure = destructureKeys.filter((k) => bodyUsed.has(k))
  const neededFromImport = new Set()
  for (const name of bodyUsed) {
    if (contextKeys.has(name) && keptDestructure.includes(name)) continue
    neededFromImport.add(name)
  }
  // Always keep CreateExecutionNodesDeps if exported fn uses deps param type indirectly
  neededFromImport.add('CreateExecutionNodesDeps')
  neededFromImport.add('createExecContext')
  neededFromImport.delete('deps')
  neededFromImport.delete('state')
  neededFromImport.delete('any')
  neededFromImport.delete('async')
  neededFromImport.delete('return')
  neededFromImport.delete('const')
  neededFromImport.delete('let')
  neededFromImport.delete('await')
  neededFromImport.delete('try')
  neededFromImport.delete('catch')
  neededFromImport.delete('if')
  neededFromImport.delete('else')
  neededFromImport.delete('new')
  neededFromImport.delete('Date')
  neededFromImport.delete('String')
  neededFromImport.delete('Number')
  neededFromImport.delete('Boolean')
  neededFromImport.delete('Math')
  neededFromImport.delete('JSON')
  neededFromImport.delete('Object')
  neededFromImport.delete('Array')
  neededFromImport.delete('Record')
  neededFromImport.delete('undefined')
  neededFromImport.delete('null')
  neededFromImport.delete('true')
  neededFromImport.delete('false')
  neededFromImport.delete('Error')

  const allImportLocals = new Map()
  for (const b of blocks) {
    for (const n of b.names) allImportLocals.set(n.local, n)
  }
  const keepLocals = new Set()
  for (const [local] of allImportLocals) {
    if (neededFromImport.has(local)) keepLocals.add(local)
  }

  const newImports = renderImports(groupImports(blocks), keepLocals)
  const newDestructure = keptDestructure.join(',\n    ')
  const newRest = `${fnHead}${newDestructure ? `\n    ${newDestructure}\n  ` : ' '}${destructureTail}${body}`
  const out = `${newImports}\n\n\n${newRest}`
  const outRaw = raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out

  if (out === src) return false
  const before = importSection.split('\n').filter((l) => l.startsWith('import')).length
  const after = newImports.split('\n').filter((l) => l.startsWith('import')).length
  console.log(`${path.basename(filePath)}: imports ${before}→${after}, destructure ${destructureKeys.length}→${keptDestructure.length}`)
  if (!dryRun) fs.writeFileSync(filePath, outRaw, 'utf8')
  return true
}

const files = fs.readdirSync(execDir).filter((f) => f.endsWith('Node.ts')).map((f) => path.join(execDir, f))
let changed = 0
for (const f of files) {
  if (trimFile(f)) changed++
}
console.log(`Done. ${changed}/${files.length} files updated${dryRun ? ' (dry-run)' : ''}.`)
