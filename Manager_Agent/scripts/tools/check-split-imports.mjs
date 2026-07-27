import fs from 'node:fs'
import path from 'node:path'

const root = path.join(process.cwd(), 'server/graph')
const files = []

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.ts')) files.push(p)
  }
}
walk(root)

const builtins = new Set([
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Promise',
  'Set', 'Map', 'Error', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'process',
  'Buffer', 'globalThis', 'Intl', 'Symbol', 'BigInt', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet',
  'AbortController', 'AbortSignal', 'structuredClone', 'crypto', 'fetch', 'Response', 'Request',
  'Headers', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'queueMicrotask', 'performance'
])

const keywords = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'instanceof', 'await',
  'async', 'function', 'class', 'const', 'let', 'var', 'import', 'export', 'from', 'default', 'case',
  'break', 'continue', 'try', 'finally', 'else', 'do', 'void', 'delete', 'in', 'of', 'super', 'this',
  'yield', 'with', 'debugger', 'enum', 'extends', 'implements', 'interface', 'package', 'private',
  'protected', 'public', 'static', 'get', 'set', 'as', 'satisfies', 'keyof', 'infer', 'never',
  'unknown', 'any', 'boolean', 'number', 'string', 'symbol', 'bigint', 'object', 'undefined', 'true', 'false'
])

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function parseImports(src) {
  const imported = new Set()
  const re = /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]/g
  for (const m of src.matchAll(re)) {
    const names = m[1]
      ? m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      : [m[2]]
    for (const n of names) imported.add(n)
  }
  return imported
}

function parseLocalFns(src) {
  const localFns = new Set()
  for (const m of src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) localFns.add(m[1])
  for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) localFns.add(m[1])
  return localFns
}

function parseDestructured(src) {
  const names = new Set()
  const patterns = [
    /const\s*\{([^}]+)\}\s*=\s*deps\b/g,
    /const\s*\{([^}]+)\}\s*=\s*input\b/g,
    /function\s+[A-Za-z_$][\w$]*\s*\(\s*\{([^}]+)\}\s*:\s*[A-Za-z_$]/g
  ]
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s*:\s*/)[0].split(/\s*=\s*/)[0].trim()
        if (n && /^[A-Za-z_$]/.test(n)) names.add(n)
      }
    }
  }
  return names
}

function parseCalls(src) {
  const callNames = new Set()
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) callNames.add(m[1])
  return callNames
}

const exported = new Map()
for (const file of files) {
  const src = stripComments(fs.readFileSync(file, 'utf8'))
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exported.has(m[1])) exported.set(m[1], new Set())
    exported.get(m[1]).add(file)
  }
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exported.has(m[1])) exported.set(m[1], new Set())
    exported.get(m[1]).add(file)
  }
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim()
      if (n && /^[A-Za-z_$]/.test(n)) {
        if (!exported.has(n)) exported.set(n, new Set())
        exported.get(n).add(file)
      }
    }
  }
}

const suspects = []
for (const file of files) {
  const src = stripComments(fs.readFileSync(file, 'utf8'))
  const imported = parseImports(src)
  const localFns = parseLocalFns(src)
  const destructured = parseDestructured(src)
  const calls = parseCalls(src)
  for (const name of calls) {
    if (builtins.has(name) || keywords.has(name)) continue
    if (/^[A-Z]/.test(name)) continue
    if (localFns.has(name) || imported.has(name) || destructured.has(name)) continue
    if (!exported.has(name)) continue
    const expFiles = [...exported.get(name)]
    if (expFiles.every((e) => path.resolve(e) === path.resolve(file))) continue
    suspects.push({ name, file: path.relative(process.cwd(), file), definedIn: expFiles.map((f) => path.relative(process.cwd(), f)).join(', ') })
  }
}

const seen = new Set()
let count = 0
for (const s of suspects.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))) {
  const key = `${s.name}|${s.file}`
  if (seen.has(key)) continue
  seen.add(key)
  count++
  console.log(`${s.name} used in ${s.file} (exported from ${s.definedIn})`)
}
console.log(`TOTAL ${count}`)
process.exit(count > 0 ? 1 : 0)
