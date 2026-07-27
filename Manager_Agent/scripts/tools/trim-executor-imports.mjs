/**
 * C6: trim unused imports in server/graph/core/executors/*.ts
 * Usage: node scripts/tools/trim-executor-imports.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const execDir = path.join(process.cwd(), 'server/graph/core/executors')
const TARGETS = fs
  .readdirSync(execDir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'types.ts' && f !== 'bundle.ts' && f !== 'dispatchExecutor.ts')

const TS_KEYWORDS = new Set([
  'async', 'await', 'return', 'const', 'let', 'var', 'if', 'else', 'try', 'catch', 'throw', 'new', 'typeof',
  'instanceof', 'as', 'from', 'import', 'export', 'type', 'interface', 'true', 'false', 'null', 'undefined',
  'void', 'never', 'any', 'string', 'number', 'boolean', 'object', 'unknown', 'readonly', 'satisfies',
  'String', 'Number', 'Boolean', 'Math', 'JSON', 'Object', 'Array', 'Date', 'Error', 'Promise', 'Record',
  'Map', 'Set', 'process', 'crypto'
])

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function parseImportBlocks(src) {
  const blocks = []
  const re = /^import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_$][\w$]*)(?:\s*,\s*\{([^}]+)\})?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  for (const m of src.matchAll(re)) {
    const isTypeOnly = m[0].startsWith('import type')
    const parseNames = (chunk, typeOnly) =>
      chunk
        ? chunk.split(',').map((x) => {
            const t = x.trim().replace(/^type\s+/, '')
            const parts = t.split(/\s+as\s+/)
            return { imported: parts[0].trim(), local: (parts[1] || parts[0]).trim(), isType: typeOnly || x.trim().startsWith('type ') }
          })
        : []
    const names = [
      ...(m[2] ? [{ imported: m[2], local: m[2], isType: isTypeOnly }] : []),
      ...parseNames(m[1], isTypeOnly),
      ...parseNames(m[3], isTypeOnly)
    ]
    blocks.push({ raw: m[0], module: m[4], names, start: m.index, end: m.index + m[0].length })
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
  for (const g of [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module))) {
    const kept = g.names.filter((n) => keepLocals.has(n.local))
    if (!kept.length) continue
    const uniq = []
    const seen = new Set()
    for (const n of kept) {
      if (seen.has(n.local)) continue
      seen.add(n.local)
      uniq.push(n)
    }
    const fmt = (n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`)
    const valueParts = uniq.filter((n) => !n.isType)
    const typeParts = uniq.filter((n) => n.isType)
    if (valueParts.length) lines.push(`import { ${valueParts.map(fmt).join(', ')} } from '${g.module}'`)
    if (typeParts.length) lines.push(`import type { ${typeParts.map(fmt).join(', ')} } from '${g.module}'`)
  }
  return lines.join('\n')
}

function usedIdentifiers(code) {
  const used = new Set()
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) used.add(m[1])
  return used
}

function trimFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const src = raw.replace(/\r\n/g, '\n')
  const exportIdx = src.search(/^export\s/m)
  if (exportIdx < 0) {
    console.warn('skip:', filePath)
    return false
  }
  const importSection = src.slice(0, exportIdx)
  const rest = src.slice(exportIdx)
  const blocks = parseImportBlocks(importSection)
  if (!blocks.length) return false
  const bodyUsed = usedIdentifiers(stripComments(rest))
  const keepLocals = new Set()
  for (const b of blocks) {
    for (const n of b.names) {
      if (bodyUsed.has(n.local) && !TS_KEYWORDS.has(n.local)) keepLocals.add(n.local)
    }
  }
  const newImports = renderImports(groupImports(blocks), keepLocals)
  const out = `${newImports}${newImports ? '\n\n' : ''}${rest}`
  if (out === src) return false
  const before = importSection.split('\n').filter((l) => l.startsWith('import')).length
  const after = newImports.split('\n').filter((l) => l.startsWith('import')).length
  console.log(`${path.basename(filePath)}: ${before}→${after} imports`)
  if (!dryRun) fs.writeFileSync(filePath, raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out, 'utf8')
  return true
}

let changed = 0
for (const f of TARGETS) {
  if (trimFile(path.join(execDir, f))) changed++
}
console.log(`Done C6: ${changed}/${TARGETS.length}${dryRun ? ' (dry-run)' : ''}`)
