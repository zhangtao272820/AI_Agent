/**
 * Repo Map：符号图 + PageRank 裁剪（Aider 类，P2-B1）
 */
import path from 'node:path'
import { walkFiles } from '../fileSystem'
import { extractFileSymbols, resolveImportToRepoPath, type FileSymbols } from './symbolExtract'

export type RepoMapEntry = {
  file: string
  score: number
  symbols: string[]
}

export type BuildRepoMapInput = {
  root?: string
  maxFiles?: number
  tokenBudget?: number
  hintFiles?: string[]
  hintSymbols?: string[]
  question?: string
}

const DEFAULT_MAX_FILES = 600
const DEFAULT_TOKEN_BUDGET = 1024

function tokenEstimate(text: string): number {
  return Math.ceil(String(text).length / 3.5)
}

function normalizeHintPath(p: string): string {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim()
}

function questionTokens(question?: string): string[] {
  const q = String(question || '').toLowerCase()
  return q.split(/[^\w\u4e00-\u9fff]+/).filter((t) => t.length >= 3)
}

/** 简化 PageRank：从 hint 文件沿 import 边传播 */
function rankFiles(
  graph: Map<string, FileSymbols>,
  hintFiles: string[],
  hintSymbols: string[],
  question?: string,
): Map<string, number> {
  const scores = new Map<string, number>()
  const qTokens = questionTokens(question)

  for (const [file, sym] of graph) {
    let base = 0.01
    const norm = normalizeHintPath(file)
    if (hintFiles.some((h) => norm === normalizeHintPath(h) || norm.endsWith(normalizeHintPath(h)))) {
      base += 3
    }
    for (const name of sym.exports) {
      if (hintSymbols.some((h) => h === name || name.includes(h))) base += 2
      if (qTokens.some((t) => name.toLowerCase().includes(t))) base += 0.5
    }
    scores.set(file, base)
  }

  // 沿 import 边传播 2 跳
  for (let hop = 0; hop < 2; hop++) {
    const delta = new Map<string, number>()
    for (const [file, sym] of graph) {
      const srcScore = scores.get(file) ?? 0
      if (srcScore < 0.05) continue
      for (const imp of sym.imports) {
        const target = resolveImportToRepoPath(file, imp)
        if (!target || !graph.has(target)) continue
        delta.set(target, (delta.get(target) ?? 0) + srcScore * 0.35)
      }
    }
    for (const [f, d] of delta) {
      scores.set(f, (scores.get(f) ?? 0) + d)
    }
  }

  return scores
}

export async function buildRepoMap(input: BuildRepoMapInput = {}): Promise<RepoMapEntry[]> {
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES
  const files = await walkFiles({
    root: input.root,
    maxFiles,
    includeExtensions: ['ts', 'tsx', 'js', 'jsx', 'vue', 'py', 'mjs', 'cjs'],
  })

  const graph = new Map<string, FileSymbols>()
  for (const file of files) {
    const sym = await extractFileSymbols(file, input.root)
    if (sym && (sym.exports.length || sym.imports.length)) {
      graph.set(file.replace(/\\/g, '/'), sym)
    }
  }

  const hintFiles = (input.hintFiles ?? []).map(normalizeHintPath).filter(Boolean)
  const hintSymbols = (input.hintSymbols ?? []).filter(Boolean)
  const scores = rankFiles(graph, hintFiles, hintSymbols, input.question)

  const entries: RepoMapEntry[] = []
  for (const [file, sym] of graph) {
    entries.push({
      file,
      score: scores.get(file) ?? 0,
      symbols: sym.exports.slice(0, 12),
    })
  }

  entries.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  return entries
}

export function formatRepoMap(entries: RepoMapEntry[], tokenBudget = DEFAULT_TOKEN_BUDGET): string {
  const lines: string[] = ['### Repo Map（符号摘要，按相关度排序）']
  let used = tokenEstimate(lines[0]!)

  for (const e of entries) {
    if (e.score < 0.02 && lines.length > 3) continue
    const symPart = e.symbols.length ? `: ${e.symbols.slice(0, 8).join(', ')}` : ''
    const line = `- ${e.file}${symPart}`
    const cost = tokenEstimate(line)
    if (used + cost > tokenBudget) break
    lines.push(line)
    used += cost
  }

  if (lines.length <= 1) return ''
  return lines.join('\n')
}

export async function buildRepoMapPrompt(input: BuildRepoMapInput = {}): Promise<string> {
  const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET
  if (budget <= 0) return ''
  const entries = await buildRepoMap(input)
  return formatRepoMap(entries, budget)
}
