import { clearRoutePreferences } from '../../utils/crawl_route_policy'
import { signalsFile } from '../../utils/crawl_learning'
import { clearExperience } from '../../utils/crawl_experience'
import { clearPromptPatches } from '../../utils/prompt_evolution'
import { clearUserPreferences } from '../../utils/user_preferences'
import { clearExperienceVectors } from '../../utils/experience_vectors'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ scope?: string }>(event).catch(() => ({}))
  const scope = String(body?.scope ?? 'all').trim().toLowerCase()

  const cleared: string[] = []

  if (scope === 'route' || scope === 'all') {
    clearRoutePreferences()
    cleared.push('route')
  }

  if (scope === 'learning' || scope === 'all') {
    try {
      writeFileSync(signalsFile(), '', 'utf8')
      cleared.push('learning')
    } catch {
      /* ignore */
    }
  }

  if (scope === 'templates' || scope === 'all') {
    const file = signalsFile().replace('extractor-learning-signals.jsonl', 'extractor-extract-templates.jsonl')
    try {
      if (existsSync(file)) writeFileSync(file, '', 'utf8')
      cleared.push('templates')
    } catch {
      /* ignore */
    }
  }

  if (scope === 'experience' || scope === 'all') {
    clearExperience()
    cleared.push('experience')
  }

  if (scope === 'prompts' || scope === 'all') {
    clearPromptPatches()
    cleared.push('prompts')
  }

  if (scope === 'evolved' || scope === 'all') {
    const file = join(process.cwd(), '.data', 'extractor-blueprint.evolved.json')
    try {
      if (existsSync(file)) writeFileSync(file, JSON.stringify({ updatedAt: '', hints: [] }, null, 2), 'utf8')
      cleared.push('evolved')
    } catch {
      /* ignore */
    }
  }

  if (scope === 'preferences' || scope === 'all') {
    clearUserPreferences()
    cleared.push('preferences')
  }

  if (scope === 'vectors' || scope === 'all') {
    clearExperienceVectors()
    cleared.push('vectors')
  }

  return { ok: true, scope, cleared }
})
