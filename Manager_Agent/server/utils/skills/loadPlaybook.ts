/**
 * Manager Playbook Skill 加载器：skills/<id>/skill.md
 * 供 router_playbook / planner_playbook / failure_recovery 等注入 contextComposer。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cache = new Map<string, string>()

function skillFileCandidates(skillId: string): string[] {
  const roots = new Set<string>()
  roots.add(process.cwd())
  try {
    roots.add(join(dirname(fileURLToPath(import.meta.url)), '../..'))
  } catch {
    /* cjs or test env */
  }
  const paths: string[] = []
  for (const root of roots) {
    paths.push(join(root, 'skills', skillId, 'skill.md'))
  }
  paths.push(join(process.cwd(), 'Manager_Agent', 'skills', skillId, 'skill.md'))
  return paths
}

function readSkillRaw(skillId: string): string {
  for (const p of skillFileCandidates(skillId)) {
    try {
      if (existsSync(p)) return readFileSync(p, 'utf8')
    } catch {
      /* try next */
    }
  }
  return ''
}

export function stripPlaybookFrontmatter(raw: string): string {
  const text = String(raw ?? '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return text.trim()
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      return lines.slice(i + 1).join('\n').trim()
    }
  }
  return text.trim()
}

export function loadPlaybookBody(skillId: string): string {
  const key = `body:${skillId}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const p = join(process.cwd(), 'skills', skillId, 'skill.md')
  try {
    const raw = readSkillRaw(skillId)
    if (!raw) {
      cache.set(key, '')
      return ''
    }
    const body = stripPlaybookFrontmatter(raw)
    cache.set(key, body)
    return body
  } catch {
    cache.set(key, '')
    return ''
  }
}

export function loadPlaybookSection(skillId: string, heading: string): string {
  const key = `section:${skillId}:${heading}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const body = loadPlaybookBody(skillId)
  if (!body) {
    cache.set(key, '')
    return ''
  }

  const h = String(heading ?? '').trim().replace(/^#+\s*/, '')
  // 按行首 `## ` 分节（`###` 不会误切）
  const blocks = body.split(/\r?\n(?=## )/)
  for (const block of blocks) {
    const m = block.match(/^##\s+(.+?)\s*\r?\n([\s\S]*)$/)
    if (m && m[1]?.trim() === h) {
      const section = (m[2] ?? '').trim()
      cache.set(key, section)
      return section
    }
  }

  cache.set(key, '')
  return ''
}

export function resolvePlaybookSectionOrFallback(
  skillId: string,
  heading: string,
  fallback: string
): string {
  const fromSkill = loadPlaybookSection(skillId, heading)
  return fromSkill.trim() ? fromSkill.trim() : fallback
}

export function resolvePlaybookOrFallback(skillId: string, fallback: string): string {
  const fromSkill = loadPlaybookBody(skillId)
  return fromSkill.trim() ? fromSkill.trim() : fallback
}

export function clearPlaybookCache(): void {
  cache.clear()
}
