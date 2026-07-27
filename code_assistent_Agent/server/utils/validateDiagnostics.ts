/**
 * validate 输出结构化诊断（P3 · LSP 诊断回灌 MVP）
 */
export type ValidateDiagnostic = {
  file?: string
  line?: number
  col?: number
  code?: string
  message: string
  source?: string
}

const TSC_LINE =
  /^(?<file>[^\s(]+)\((?<line>\d+),(?<col>\d+)\):\s*error\s+(?<code>TS\d+):\s*(?<message>.+)$/i
const ESLINT_LINE =
  /^(?<line>\d+):(?<col>\d+)\s+error\s+(?<message>.+?)(?:\s{2,}(?<code>[\w@/-]+))?\s*$/i

export function parseTypecheckDiagnostics(output: string): ValidateDiagnostic[] {
  const out: ValidateDiagnostic[] = []
  for (const raw of String(output || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(TSC_LINE)
    if (m?.groups) {
      out.push({
        file: m.groups.file,
        line: Number(m.groups.line),
        col: Number(m.groups.col),
        code: m.groups.code,
        message: m.groups.message.trim(),
        source: 'typecheck',
      })
    }
  }
  return out
}

export function parseEslintDiagnostics(output: string, fileHint?: string): ValidateDiagnostic[] {
  const out: ValidateDiagnostic[] = []
  let currentFile = fileHint
  for (const raw of String(output || '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) continue
    if (!line.startsWith(' ') && !/^\d+:\d+/.test(line) && line.includes('/')) {
      currentFile = line.trim()
      continue
    }
    const m = line.trim().match(ESLINT_LINE)
    if (m?.groups) {
      out.push({
        file: currentFile,
        line: Number(m.groups.line),
        col: Number(m.groups.col),
        code: m.groups.code,
        message: m.groups.message.trim(),
        source: 'lint',
      })
    }
  }
  return out
}

export function parseDiagnostics(output: string, script?: string): ValidateDiagnostic[] {
  const s = String(script || '').toLowerCase()
  if (s.includes('lint')) return parseEslintDiagnostics(output)
  return parseTypecheckDiagnostics(output)
}

export function formatDiagnosticsForRecover(diagnostics: ValidateDiagnostic[], limit = 24): string {
  if (!diagnostics.length) return ''
  const rows = diagnostics.slice(0, limit).map((d) => {
    const loc =
      d.file && d.line
        ? `${d.file}:${d.line}${d.col ? `:${d.col}` : ''}`
        : d.file || 'unknown'
    const code = d.code ? `[${d.code}] ` : ''
    return `- ${loc} ${code}${d.message}`
  })
  return ['## 结构化校验错误（优先修复）', ...rows].join('\n')
}

export function buildValidateRecoverHint(suite: {
  ok?: boolean
  results?: Array<{ script?: string; ok?: boolean; output?: string; error?: string }>
}): string {
  const failed = (suite.results ?? []).filter((r) => r && r.ok === false)
  const diags = failed.flatMap((r) =>
    parseDiagnostics(String(r.output || r.error || ''), String(r.script || '')),
  )
  const structured = formatDiagnosticsForRecover(diags)
  if (structured) return structured
  const raw = failed
    .map((r) => `### ${r.script}\n${String(r.output || r.error || '').slice(0, 1500)}`)
    .join('\n\n')
  return raw ? `## validate 原始输出\n${raw}` : ''
}

export function collectValidationDiagnostics(suite: {
  results?: Array<{ script?: string; ok?: boolean; output?: string; error?: string }>
}): ValidateDiagnostic[] {
  const failed = (suite.results ?? []).filter((r) => r && r.ok === false)
  return failed.flatMap((r) =>
    parseDiagnostics(String(r.output || r.error || ''), String(r.script || '')),
  )
}
