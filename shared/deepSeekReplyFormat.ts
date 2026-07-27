import { isStructuralMetadataFactKey } from './structuralFactFilter'

export type ReplyFact = { key: string; value: unknown; source?: string }

const META_KEYS = new Set([
  'answer',
  'facts',
  'data',
  'confidence',
  'mode',
  'source',
  'cleaned_from',
  'fact_count',
  'agent',
  'ok',
  'error_code',
  'latency_ms',
  'structured'
])

const LARGE_SET_THRESHOLD = 10
const MAX_FACTS_PER_GROUP = 12
const MAX_TOTAL_DISPLAY = 20

function normKey(k: string): string {
  return String(k ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function fmtValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  const s = String(v).trim()
  if (!s) return '—'
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const pairs = Object.entries(parsed as Record<string, unknown>)
          .slice(0, 6)
          .map(([k, val]) => `${k}=${String(val ?? '')}`)
        return pairs.length ? pairs.join('；') : s.slice(0, 120)
      }
    } catch {
      /* keep raw */
    }
  }
  return s.length > 160 ? `${s.slice(0, 157)}…` : s
}

function isReadableAnswer(s: string): boolean {
  const t = String(s ?? '').trim()
  if (t.length < 12) return false
  if (/^[\d\s:：\-./]+$/.test(t.slice(0, 48))) return false
  if (t.startsWith('{') || t.startsWith('[')) return false
  return true
}

type FactGroup = { title: string; items: ReplyFact[] }

function structuralGroupTitle(key: string): string {
  const dash = key.indexOf('-')
  if (dash > 0 && dash < key.length - 1) return key.slice(0, dash).trim()
  const dot = key.indexOf('.')
  if (dot > 0 && dot < key.length - 1) {
    const first = key.slice(0, dot).trim()
    if (first && !/^\d+$/.test(first)) return first
  }
  return '指标'
}

/** 按 key 路径前缀分组（`-` / `.`），不做领域关键词分类 */
function groupFactsByStructuralPrefix(facts: ReplyFact[]): FactGroup[] {
  const map = new Map<string, ReplyFact[]>()
  for (const f of facts) {
    const key = String(f.key ?? '').trim()
    if (!key || META_KEYS.has(normKey(key)) || isStructuralMetadataFactKey(key)) continue
    const title = structuralGroupTitle(key)
    const arr = map.get(title) ?? []
    arr.push(f)
    map.set(title, arr)
  }
  return [...map.entries()].map(([title, items]) => ({ title, items }))
}

function buildOpening(facts: ReplyFact[], answer?: string): string {
  if (isReadableAnswer(String(answer ?? ''))) {
    const a = String(answer).trim()
    return a.length > 220 ? `${a.slice(0, 217)}…` : a
  }
  if (facts.length > LARGE_SET_THRESHOLD) {
    return `已整理 **${facts.length}** 项结构化指标，下面按字段前缀展示主要条目（未全部展开）。`
  }
  return `共 **${facts.length}** 项结构化指标，按字段前缀分组如下。`
}

function buildSummary(factCount: number, sourceHint?: string): string {
  const src = String(sourceHint ?? '子步骤').trim() || '子步骤'
  if (factCount > LARGE_SET_THRESHOLD) {
    return `以上摘自知信结构化输出（共 **${factCount}** 项）。需要对比、趋势或图表请直接说明。`
  }
  return `以上 **${factCount}** 项来自${src}的结构化结果。`
}

function capDisplayedGroups(groups: FactGroup[], totalFacts: number): FactGroup[] {
  if (totalFacts <= LARGE_SET_THRESHOLD) {
    return groups.map((g) => ({
      title: g.title,
      items: g.items.slice(0, MAX_FACTS_PER_GROUP)
    }))
  }
  let remaining = MAX_TOTAL_DISPLAY
  const out: FactGroup[] = []
  for (const g of groups) {
    if (remaining <= 0) break
    const take = Math.min(MAX_FACTS_PER_GROUP, remaining, g.items.length)
    if (take > 0) {
      out.push({ title: g.title, items: g.items.slice(0, take) })
      remaining -= take
    }
  }
  return out
}

/** 对话式汇总：结论先行 → 按结构前缀分段 → 小结（无领域关键词分支） */
export function formatFactsAsDeepSeekReply(input: {
  facts: ReplyFact[]
  answer?: string
  subjectHint?: string
  sourceHint?: string
}): string {
  const facts = (input.facts || [])
    .map((f) => ({ key: String(f.key ?? '').trim(), value: f.value, source: f.source }))
    .filter((f) => f.key && !META_KEYS.has(normKey(f.key)) && !isStructuralMetadataFactKey(f.key))
  if (facts.length < 1) return ''

  const groups = capDisplayedGroups(groupFactsByStructuralPrefix(facts), facts.length)
  const lines: string[] = [buildOpening(facts, input.answer), '']

  for (const g of groups) {
    lines.push(`### ${g.title}`)
    for (const f of g.items) {
      lines.push(`- **${f.key}**：${fmtValue(f.value)}`)
    }
    lines.push('')
  }

  if (facts.length > MAX_TOTAL_DISPLAY) {
    lines.push(`> 另有 ${facts.length - MAX_TOTAL_DISPLAY} 项未在正文中展开，完整数值见结构化 facts。`, '')
  }

  lines.push('---', '', `**小结**：${buildSummary(facts.length, input.sourceHint)}`)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 将旧版「报告体」Markdown 转为对话式（机械解析章节标记，无领域逻辑） */
export function transformFormalReportToConversational(text: string): string {
  let s = String(text ?? '').trim()
  if (!s) return s
  if (!/##\s*报告（|###\s*核心结论|###\s*关键数据依据|###\s*风险提示|###\s*下一步建议/.test(s)) {
    return s
  }

  const facts: ReplyFact[] = []
  let answer = ''
  for (const line of s.split('\n')) {
    const bullet = line.match(/^-\s+\*\*(.+?)\*\*[：:]\s*(.+)$/)
    if (bullet) {
      const key = bullet[1]!.trim()
      const val = bullet[2]!.trim()
      if (/^核心结论$/i.test(key) || key === '核心结论') {
        answer = val
      } else if (!META_KEYS.has(normKey(key))) {
        facts.push({ key, value: val })
      }
      continue
    }
    const h3 = line.match(/^###\s*核心结论\s*$/)
    if (h3) continue
  }

  if (facts.length >= 1) {
    return formatFactsAsDeepSeekReply({ facts, answer })
  }

  return s
    .replace(/^#{1,3}\s*报告（[^）]+）\s*$/gm, '')
    .replace(/^#{1,4}\s*(核心结论|关键数据依据|风险提示|下一步建议)[：:\s]*$/gim, '')
    .replace(/\*\*(核心结论|关键数据依据|风险提示|下一步建议)\*\*[：:]\s*/g, '')
    .trim()
}
