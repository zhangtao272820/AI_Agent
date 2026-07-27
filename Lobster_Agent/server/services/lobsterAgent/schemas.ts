import { z } from 'zod'

export type Action =
  | { type: 'goto'; url: string; reason?: string }
  | { type: 'click'; selector: string; reason?: string }
  | { type: 'click_candidate'; index: number; reason?: string }
  | { type: 'click_by_bbox'; index: number; reason?: string }
  | { type: 'click_by_text'; text: string; reason?: string }
  | { type: 'type'; selector?: string; text: string; reason?: string }
  | { type: 'type_candidate'; index: number; text: string; reason?: string }
  | { type: 'scroll'; dy?: number; reason?: string }
  | { type: 'wait'; ms?: number; reason?: string }
  | { type: 'ensure_play'; reason?: string }
  | { type: 'extract'; fields?: string[]; limit?: number; reason?: string }
  | { type: 'dismiss_overlays'; reason?: string }
  | { type: 'reload'; reason?: string }
  | { type: 'back'; reason?: string }
  | { type: 'need_crawl'; reason?: string }
  | { type: 'done'; reason?: string }

export type Skill =
  | { skill: 'web.search'; query: string; reason?: string }
  | { skill: 'navigate.by_label'; label: string; reason?: string }
  | { skill: 'extract.items'; limit?: number; reason?: string }
  | { skill: 'interact.click_by_intent'; intent: string; reason?: string }
  | { skill: 'paginate.next'; reason?: string }

export type IntentCall =
  | { intent: 'goto'; args: { url: string }; reason?: string }
  | { intent: 'search'; args: { query: string }; reason?: string }
  | { intent: 'open_first_result'; reason?: string }
  | { intent: 'click_candidate'; args: { cid: string }; reason?: string }
  | { intent: 'type_into'; args: { cid: string; text: string }; reason?: string }
  | { intent: 'scroll'; args?: { dy?: number }; reason?: string }
  | { intent: 'wait'; args: { ms: number }; reason?: string }
  | { intent: 'paginate_next'; reason?: string }
  | { intent: 'extract_items'; args?: { limit?: number }; reason?: string }
  | { intent: 'play'; reason?: string }
  | { intent: 'like'; reason?: string }
  | { intent: 'coin'; reason?: string }
  | { intent: 'follow'; reason?: string }
  | { intent: 'favorite'; reason?: string }
  | { intent: 'click_by_bbox'; args: { index: number }; reason?: string }
  | { intent: 'click_by_text'; args: { text: string }; reason?: string }
  | { intent: 'dismiss_overlays'; reason?: string }
  | { intent: 'reload'; reason?: string }
  | { intent: 'back'; reason?: string }
  | { intent: 'need_crawl'; reason?: string }
  | { intent: 'perform'; args: { goal: string }; reason?: string }
  | { intent: 'done'; reason?: string }

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), url: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal('click'), selector: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal('click_candidate'), index: z.number().int().nonnegative(), reason: z.string().optional() }),
  z.object({ type: z.literal('click_by_bbox'), index: z.number().int().nonnegative(), reason: z.string().optional() }),
  z.object({ type: z.literal('click_by_text'), text: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal('type'), selector: z.string().min(1).optional(), text: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal('type_candidate'), index: z.number().int().nonnegative(), text: z.string().min(1), reason: z.string().optional() }),
  z.object({ type: z.literal('scroll'), dy: z.number().optional(), reason: z.string().optional() }),
  z.object({ type: z.literal('wait'), ms: z.number().int().positive().max(120000).optional(), reason: z.string().optional() }),
  z.object({ type: z.literal('ensure_play'), reason: z.string().optional() }),
  z.object({ type: z.literal('extract'), fields: z.array(z.string()).optional(), limit: z.number().int().positive().max(20).optional(), reason: z.string().optional() }),
  z.object({ type: z.literal('dismiss_overlays'), reason: z.string().optional() }),
  z.object({ type: z.literal('reload'), reason: z.string().optional() }),
  z.object({ type: z.literal('back'), reason: z.string().optional() }),
  z.object({ type: z.literal('need_crawl'), reason: z.string().optional() }),
  z.object({ type: z.literal('done'), reason: z.string().optional() })
])

export const skillSchema = z.discriminatedUnion('skill', [
  z.object({ skill: z.literal('web.search'), query: z.string().min(1), reason: z.string().optional() }),
  z.object({ skill: z.literal('navigate.by_label'), label: z.string().min(1), reason: z.string().optional() }),
  z.object({ skill: z.literal('extract.items'), limit: z.number().int().positive().max(20).optional(), reason: z.string().optional() }),
  z.object({ skill: z.literal('interact.click_by_intent'), intent: z.string().min(1), reason: z.string().optional() }),
  z.object({ skill: z.literal('paginate.next'), reason: z.string().optional() })
])

export const intentSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('goto'), args: z.object({ url: z.string().min(1) }), reason: z.string().optional() }),
  z.object({ intent: z.literal('search'), args: z.object({ query: z.string().min(1) }), reason: z.string().optional() }),
  z.object({ intent: z.literal('open_first_result'), reason: z.string().optional() }),
  z.object({ intent: z.literal('click_candidate'), args: z.object({ cid: z.string().min(1) }), reason: z.string().optional() }),
  z.object({
    intent: z.literal('type_into'),
    args: z.object({ cid: z.string().min(1), text: z.string().min(1) }),
    reason: z.string().optional()
  }),
  z.object({ intent: z.literal('scroll'), args: z.object({ dy: z.number().optional() }).optional(), reason: z.string().optional() }),
  z.object({ intent: z.literal('wait'), args: z.object({ ms: z.number().int().positive().max(120000) }), reason: z.string().optional() }),
  z.object({ intent: z.literal('paginate_next'), reason: z.string().optional() }),
  z.object({ intent: z.literal('extract_items'), args: z.object({ limit: z.number().int().positive().max(20).optional() }).optional(), reason: z.string().optional() }),
  z.object({ intent: z.literal('play'), reason: z.string().optional() }),
  z.object({ intent: z.literal('like'), reason: z.string().optional() }),
  z.object({ intent: z.literal('coin'), reason: z.string().optional() }),
  z.object({ intent: z.literal('follow'), reason: z.string().optional() }),
  z.object({ intent: z.literal('favorite'), reason: z.string().optional() }),
  z.object({ intent: z.literal('click_by_bbox'), args: z.object({ index: z.number().int().nonnegative() }), reason: z.string().optional() }),
  z.object({ intent: z.literal('click_by_text'), args: z.object({ text: z.string().min(1) }), reason: z.string().optional() }),
  z.object({ intent: z.literal('dismiss_overlays'), reason: z.string().optional() }),
  z.object({ intent: z.literal('reload'), reason: z.string().optional() }),
  z.object({ intent: z.literal('back'), reason: z.string().optional() }),
  z.object({ intent: z.literal('need_crawl'), reason: z.string().optional() }),
  z.object({ intent: z.literal('perform'), args: z.object({ goal: z.string().min(1) }), reason: z.string().optional() }),
  z.object({ intent: z.literal('done'), reason: z.string().optional() })
])

const visionJsonSchema = z
  .object({
    pageType: z.enum(['home', 'list', 'detail', 'login', 'captcha', 'unknown']).optional(),
    hasOverlay: z.boolean().optional(),
    hasPlayer: z.boolean().optional(),
    primaryCtas: z.array(z.string()).optional(),
    searchQuery: z.string().optional(),
    summary: z.string().optional()
  })
  .passthrough()

export function normalizeVisionJson(v: any) {
  const parsed = visionJsonSchema.safeParse(v)
  if (!parsed.success) return null
  const x = parsed.data as any
  const pageTypeRaw = String(x.pageType || '').trim().toLowerCase()
  const pageType = (['home', 'list', 'detail', 'login', 'captcha', 'unknown'] as const).includes(pageTypeRaw as any)
    ? (pageTypeRaw as any)
    : 'unknown'
  const primaryCtas = Array.isArray(x.primaryCtas)
    ? x.primaryCtas
        .map((s: any) => String(s || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 6)
    : []
  const searchQuery = String(x.searchQuery || '').replace(/\s+/g, ' ').trim()
  const summary = String(x.summary || '').replace(/\s+\n/g, '\n').trim()
  return {
    pageType,
    hasOverlay: !!x.hasOverlay,
    hasPlayer: !!x.hasPlayer,
    primaryCtas,
    searchQuery: searchQuery.length > 120 ? searchQuery.slice(0, 120) : searchQuery,
    summary: summary.length > 400 ? summary.slice(0, 400) : summary
  }
}
