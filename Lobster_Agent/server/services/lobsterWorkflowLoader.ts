/**
 * 加载 workflows/*.json（相对 Lobster_Agent 根或 cwd）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLobsterWorkflowDef, type LobsterWorkflowDef } from './lobsterWorkflowSchema'

const cache = new Map<string, LobsterWorkflowDef>()

function workflowsDir(): string {
  const fromEnv = String(process.env.LOBSTER_WORKFLOWS_DIR || '').trim()
  if (fromEnv) return path.resolve(fromEnv)
  // server/services → ../../workflows
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidate = path.resolve(here, '../../workflows')
  if (fs.existsSync(candidate)) return candidate
  return path.resolve(process.cwd(), 'workflows')
}

export function listLobsterWorkflowIds(): string[] {
  const dir = workflowsDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/i, ''))
    .sort()
}

export function loadLobsterWorkflow(workflowId: string): LobsterWorkflowDef {
  const id = String(workflowId || '').trim()
  if (!id) throw new Error('lobster_workflow_id_empty')
  const cached = cache.get(id)
  if (cached) return cached

  const file = path.join(workflowsDir(), `${id}.json`)
  if (!fs.existsSync(file)) {
    throw new Error(`lobster_workflow_not_found: ${id}`)
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const def = parseLobsterWorkflowDef(raw)
  if (def.id !== id) {
    throw new Error(`lobster_workflow_id_mismatch: file=${id} def.id=${def.id}`)
  }
  cache.set(id, def)
  return def
}

/** 测试用：清缓存 */
export function clearLobsterWorkflowCache() {
  cache.clear()
}

export function resolveWorkflowArgs(
  def: LobsterWorkflowDef,
  input: Record<string, unknown> | null | undefined,
  defaults?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...(defaults || {}) }
  const src = input && typeof input === 'object' ? input : {}
  for (const key of def.args) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      out[key] = String((src as any)[key] ?? '').trim()
    }
  }
  // 允许额外键（finish/extract assign）
  for (const [k, v] of Object.entries(src)) {
    if (!(k in out)) out[k] = String(v ?? '').trim()
  }
  return out
}

/** 声明的 args 必须非空；缺失则明确失败（禁止站点硬编码静默补全） */
export function assertRequiredWorkflowArgs(
  def: LobsterWorkflowDef,
  vars: Record<string, string>,
): void {
  const missing = (def.args || []).filter((k) => !String(vars[k] ?? '').trim())
  if (missing.length) {
    throw new Error(`lobster_workflow_args_missing: ${missing.join(',')}`)
  }
}
