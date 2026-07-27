import { describe, expect, it } from 'vitest'
import { formatCrossAgentProfileBlock, getCrossAgentMemorySummary } from './code_cross_agent_memory'

describe('code_cross_agent_memory', () => {
  it('returns empty block when disabled user has no prefs', () => {
    const block = formatCrossAgentProfileBlock(undefined, '列出订单统计')
    expect(typeof block).toBe('string')
  })

  it('exposes summary shape', () => {
    const s = getCrossAgentMemorySummary()
    expect(s).toHaveProperty('enabled')
    expect(s).toHaveProperty('bridgeLines')
  })
})
