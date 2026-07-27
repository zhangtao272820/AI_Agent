import { describe, expect, it } from 'vitest'
import { resolvePromptAbVariant, formatInspectStrategyHint } from './code_prompt_ab_router'

describe('code_prompt_ab_router', () => {
  it('returns stable variant for same seed', () => {
    const a = resolvePromptAbVariant('thread-1', '分析 agent.ts')
    const b = resolvePromptAbVariant('thread-1', '分析 agent.ts')
    expect(a).toBe(b)
  })

  it('formats inspect hints per variant', () => {
    expect(formatInspectStrategyHint('control', 'inspect')).toContain('快速')
    expect(formatInspectStrategyHint('treatment', 'inspect')).toContain('深度')
    expect(formatInspectStrategyHint('treatment', 'compute')).toBe('')
  })
})
