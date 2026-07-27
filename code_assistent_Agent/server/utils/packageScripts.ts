/**
 * package.json scripts 读取（Workbench / MCP / script 模式共用）
 */
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { safeResolve } from '../services/fileSystem'

export type PackageScriptEntry = {
  name: string
  command: string
}

export async function listPackageScripts(rootOverride?: string): Promise<PackageScriptEntry[]> {
  const pkgPath = safeResolve('package.json', rootOverride)
  const text = await fs.readFile(pkgPath, 'utf8').catch(() => '')
  if (!text.trim()) return []
  try {
    const pkg = JSON.parse(text) as { scripts?: Record<string, string> }
    const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
    return Object.keys(scripts)
      .filter((k) => typeof k === 'string' && k.trim())
      .sort()
      .map((name) => ({ name, command: String(scripts[name] ?? '').trim() }))
  } catch {
    return []
  }
}

export function formatPackageScriptsBlock(entries: PackageScriptEntry[]): string {
  if (!entries.length) return '- （未在 package.json 中声明 scripts）'
  return entries.map((e) => `- \`${e.name}\`: ${e.command || '(empty)'}`).join('\n')
}

export function resolvePackageManager(rootOverride?: string): 'pnpm' | 'npm' {
  const root = path.dirname(safeResolve('package.json', rootOverride))
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  return 'npm'
}
