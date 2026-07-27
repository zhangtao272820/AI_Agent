import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function verifyInternalToken(event: any): void {
  const expected = String(process.env.CLAWHIVE_INTERNAL_TOKEN || process.env.MANAGER_OPS_TOKEN || '').trim()
  if (!expected) {
    throw createError({ statusCode: 503, statusMessage: 'CLAWHIVE_INTERNAL_TOKEN 未配置' })
  }
  const got = String(getHeader(event, 'x-clawhive-internal-token') || '').trim()
  if (!got || got !== expected) {
    throw createError({ statusCode: 401, statusMessage: '无效的内部服务令牌' })
  }
}

function parseVersion(raw: string): string {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return ''
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') break
    const m = lines[i]?.match(/^version:\s*(.+)\s*$/i)
    if (m) return String(m[1] || '').trim()
  }
  return ''
}

/** GET /api/internal/skills — 已落盘 playbook 列表 */
export default defineEventHandler((event) => {
  verifyInternalToken(event)
  const root = join(process.cwd(), 'skills')
  if (!existsSync(root)) {
    return { ok: true, skills: [] }
  }
  const skills = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const md = join(root, d.name, 'skill.md')
      if (!existsSync(md)) return null
      const raw = readFileSync(md, 'utf8')
      return { skill_id: d.name, version: parseVersion(raw) || 'unknown', kind: 'playbook' }
    })
    .filter(Boolean)
  return { ok: true, skills }
})
