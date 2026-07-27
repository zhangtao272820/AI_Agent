/**
 * 单文件符号提取（TS/JS/Vue/Python）
 */
import path from 'node:path'
import { readText } from '../../utils/files'
import { explainWithTsAst, extractScriptFromVue } from '../analysis'

export type FileSymbols = {
  file: string
  exports: string[]
  imports: string[]
}

const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.mjs', '.cjs', '.py'])

export function isCodeFileForRepoMap(file: string): boolean {
  return CODE_EXTS.has(path.extname(file).toLowerCase())
}

function extractPythonSymbols(file: string, text: string): FileSymbols {
  const exports: string[] = []
  const imports: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const def = line.match(/^\s*(?:async\s+)?def\s+(\w+)/)
    if (def?.[1]) exports.push(def[1])
    const cls = line.match(/^\s*class\s+(\w+)/)
    if (cls?.[1]) exports.push(cls[1])
    const imp = line.match(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/)
    const mod = imp?.[1] || imp?.[2]
    if (mod) imports.push(mod.replace(/,$/, ''))
  }
  return { file, exports: unique(exports), imports: unique(imports) }
}

function unique(xs: string[]) {
  return Array.from(new Set(xs.filter(Boolean))).sort()
}

export async function extractFileSymbols(file: string, root?: string): Promise<FileSymbols | null> {
  if (!isCodeFileForRepoMap(file)) return null
  const ext = path.extname(file).toLowerCase()
  try {
    const text = await readText(file, 120_000, root)
    if (ext === '.py') return extractPythonSymbols(file, text)
    const info = await explainWithTsAst({ text: extractScriptFromVue(text), fileName: file })
    return { file, exports: info.exports, imports: info.imports }
  } catch {
    return null
  }
}

/** 将 import 说明符解析为仓库内相对路径（尽力而为） */
export function resolveImportToRepoPath(fromFile: string, spec: string): string | null {
  const s = String(spec || '').trim()
  if (!s || (!s.startsWith('.') && !s.startsWith('#'))) return null
  const base = path.dirname(fromFile.replace(/\\/g, '/'))
  let candidate = path.posix.normalize(path.posix.join(base, s))
  if (!candidate.endsWith('.ts') && !candidate.endsWith('.js') && !candidate.endsWith('.vue')) {
    const candidates = [`${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}/index.ts`, `${candidate}/index.js`]
    return candidates[0] ?? null
  }
  return candidate
}
