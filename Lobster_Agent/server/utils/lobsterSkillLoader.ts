/**
 * Lobster 本地 Skill 加载（独立工作台 / MCP prompt 注入）
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cache = new Map<string, string>()
let manifestCache: LobsterSkillsManifest | null | undefined

export type LobsterSkillsManifest = {
  name: string
  version: string
  description?: string
  owner?: string
  stage?: string
  mcp_tools?: string[]
  skills?: string[]
  env?: Record<string, string>
}

function roots(): string[] {
  const out = new Set<string>([process.cwd()])
  try {
    out.add(join(dirname(fileURLToPath(import.meta.url)), '../..'))
  } catch {}
  return [...out]
}

function manifestCandidates(): string[] {
  const paths: string[] = []
  for (const root of roots()) {
    paths.push(join(root, 'skills', 'manifest.json'))
  }
  return paths
}

/** P3-A 对齐：skills manifest 绑 mcp_tools（Code manifest 同构） */
export function loadLobsterSkillsManifest(): LobsterSkillsManifest | null {
  if (manifestCache !== undefined) return manifestCache
  for (const p of manifestCandidates()) {
    try {
      if (!existsSync(p)) continue
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as LobsterSkillsManifest
      manifestCache = parsed && typeof parsed === 'object' ? parsed : null
      return manifestCache
    } catch {}
  }
  manifestCache = null
  return null
}

export function listLobsterSkillIds(): string[] {
  const manifest = loadLobsterSkillsManifest()
  if (Array.isArray(manifest?.skills) && manifest.skills.length) {
    return manifest.skills.map((s) => String(s).trim()).filter(Boolean)
  }
  return ['gui_standalone', 'browser-automation', 'desktop-automation', 'android-automation']
}

export function listLobsterMcpToolNames(): string[] {
  const manifest = loadLobsterSkillsManifest()
  if (Array.isArray(manifest?.mcp_tools) && manifest.mcp_tools.length) {
    return manifest.mcp_tools.map((s) => String(s).trim()).filter(Boolean)
  }
  return []
}

function candidates(skillId: string): string[] {
  const paths: string[] = []
  for (const root of roots()) {
    paths.push(join(root, 'skills', skillId, 'skill.md'))
    paths.push(join(root, 'skills', skillId, 'SKILL.md'))
  }
  return paths
}

function stripFrontmatter(raw: string): string {
  const lines = String(raw || '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return String(raw || '').trim()
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') return lines.slice(i + 1).join('\n').trim()
  }
  return String(raw || '').trim()
}

export function loadLobsterSkillBody(skillId: string): string {
  const key = `skill:${skillId}`
  if (cache.has(key)) return cache.get(key) || ''
  for (const p of candidates(skillId)) {
    try {
      if (!existsSync(p)) continue
      const body = stripFrontmatter(readFileSync(p, 'utf8'))
      cache.set(key, body)
      return body
    } catch {}
  }
  cache.set(key, '')
  return ''
}

export function loadLobsterSkillSection(skillId: string, heading: string): string {
  const body = loadLobsterSkillBody(skillId)
  if (!body) return ''
  const h = String(heading || '').trim()
  const blocks = body.split(/\r?\n(?=## )/)
  for (const block of blocks) {
    const m = block.match(/^##\s+(.+?)\s*\r?\n([\s\S]*)$/)
    if (m && m[1]?.trim() === h) return (m[2] || '').trim()
  }
  return ''
}

export function guiStandalonePromptAddon(): string {
  const rules = loadLobsterSkillSection('gui_standalone', 'McpRules')
  const complex = loadLobsterSkillSection('gui_standalone', 'ComplexPages')
  return [rules, complex].filter(Boolean).join('\n\n')
}

/** P2-C1 browser-automation skill（Profile / 验证码 / 完成标准） */
export function browserAutomationPromptAddon(): string {
  const body = loadLobsterSkillBody('browser-automation')
  if (!body) return ''
  const rulesIdx = body.indexOf('## 执行规则')
  if (rulesIdx >= 0) return body.slice(rulesIdx).trim()
  return body.slice(0, 1800)
}

/** P2-C2 desktop-automation skill（Windows UIA / 记事本等） */
export function desktopAutomationPromptAddon(): string {
  const body = loadLobsterSkillBody('desktop-automation')
  if (!body) return ''
  const rulesIdx = body.indexOf('## 执行规则')
  if (rulesIdx >= 0) return body.slice(rulesIdx).trim()
  return body.slice(0, 1800)
}

/** P2-C3 android-automation skill（ADB / Android MCP 演示） */
export function androidAutomationPromptAddon(): string {
  const body = loadLobsterSkillBody('android-automation')
  if (!body) return ''
  const rulesIdx = body.indexOf('## 执行规则')
  if (rulesIdx >= 0) return body.slice(rulesIdx).trim()
  return body.slice(0, 1800)
}
