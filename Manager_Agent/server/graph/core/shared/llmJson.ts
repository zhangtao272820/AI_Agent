import { RouteSchema, PlanSchema } from '../../../utils/shared/taskPlan'
import { isManagerDockerRuntime } from '../../../utils/platform/managerEnvModes'

const ROUTE_INTENTS = [
  'db',
  'rag',
  'code',
  'crawler',
  'gui',
  'admin',
  'visualize',
  'report',
  'clean',
  'multimodal',
  'music',
  'video',
  'multi'
] as const

const ROUTE_ALLOWED = [
  'db',
  'rag',
  'code',
  'crawler',
  'gui',
  'admin',
  'visualize',
  'report',
  'clean',
  'multimodal',
  'music',
  'video'
] as const

/** 给 LLM 看的干净 JSON 示例（禁止 JSON.stringify(ZodSchema.shape)，会输出 _def 误导模型） */
export const ROUTE_JSON_EXAMPLE = `{
  "intent": "multi",
  "confidence": 0.85,
  "rationale": "（必填：用一句话概括用户本轮真实诉求，勿复制本示例文字）",
  "query": "保留用户原始任务表述",
  "entities": { "names": [], "records": [], "locations": [], "dates": [] },
  "allowedAgents": ["db", "crawler", "report"],
  "needsClarify": false,
  "needsWebSearch": true,
  "clarifyQuestions": [],
  "taskStackOp": "none",
  "taskStackTitle": ""
}`

/** 路由 rationale 是否为示例/模板复读（精确匹配，非关键词表） */
export function isRouteRationaleBoilerplate(rationale: unknown): boolean {
  const r = String(rationale ?? '').trim()
  if (!r) return true
  const samples = new Set([
    '（必填：用一句话概括用户本轮真实诉求，勿复制本示例文字）',
    '用户需要分别检索两源公开信息并生成对比报告',
    '（必填）根据用户本轮实际诉求用一句话说明，勿复制本示例'
  ])
  return samples.has(r)
}

export function sanitizeRouteRationaleForDisplay(rationale: unknown, userTask: string): string {
  const r = String(rationale ?? '').trim()
  if (isRouteRationaleBoilerplate(r)) {
    const t = String(userTask ?? '').trim()
    return t.length >= 6 ? t.slice(0, 160) : '见下方 Agent 编排'
  }
  return r
}

export const PLAN_JSON_EXAMPLE = `{
  "steps": [
    { "id": "s1", "agent": "rag", "query": "从知识库检索月度财务原始数据", "clauseIds": ["c1"] },
    { "id": "s2", "agent": "code", "query": "计算结余与对比指标", "dependsOn": ["s1"], "clauseIds": ["c2"] },
    { "id": "s3", "agent": "visualize", "query": "生成对比图 ECharts 配置", "dependsOn": ["s2"], "clauseIds": ["c2"] },
    { "id": "s4", "agent": "admin", "query": "创建明天10点项目周会并设提醒", "clauseIds": ["c3"] }
  ]
}`

function stripCodeFences(text: string): string {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

/** Qwen3/3.5 偶发在 content 中夹带思考块，路由/规划 JSON 解析前剥离 */
function stripThinkingBlocks(text: string): string {
  return String(text || '')
    .replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, '')
    .trim()
}

/** qwen3.5 等模型常自创 single/simple，需映射到合法 intent */
const INVALID_ROUTE_INTENT_ALIASES = new Set(['single', 'simple', 'one', 'direct', 'solo', 'individual'])

function normalizeAllowedAgents(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((a) => String(a ?? '').trim())
    .filter((a) => (ROUTE_ALLOWED as readonly string[]).includes(a))
}

/** 将非法 intent 映射为 schema 合法值（优先依据 allowedAgents） */
export function resolveRouteIntentFromPayload(obj: Record<string, unknown>): string | undefined {
  const raw = String(obj.intent ?? '').trim().toLowerCase()
  if ((ROUTE_INTENTS as readonly string[]).includes(raw)) return raw

  const allowed = normalizeAllowedAgents(obj.allowedAgents)
  if (INVALID_ROUTE_INTENT_ALIASES.has(raw)) {
    if (allowed.length >= 2) return 'multi'
    if (allowed.length === 1) return allowed[0]
    return 'multi'
  }

  if (allowed.length === 1) return allowed[0]
  if (allowed.length >= 2) return 'multi'
  return undefined
}

function normalizeRouteLlmPayload(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj
  const o = { ...(obj as Record<string, unknown>) }
  const resolved = resolveRouteIntentFromPayload(o)
  if (resolved) o.intent = resolved
  return o
}

export function safeJsonParse(text: string): unknown | null {
  const t = stripCodeFences(text)
  if (!t) return null
  let cleaned = t
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1)
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

export function parseFirstBalancedJsonObject(raw: string): unknown | null {
  const s = stripCodeFences(raw)
  if (!s) return null
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function looksLikeZodInternalPayload(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as Record<string, unknown>
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object' && '_def' in (v as object)) return true
  }
  return String(JSON.stringify(obj)).includes('"_def"')
}

function extractZodEnumValue(raw: string, field: string): string | null {
  const s = String(raw || '')
  const nested = s.match(new RegExp(`"${field}"\\s*:\\s*\\{[\\s\\S]*?"value"\\s*:\\s*"([^"]+)"`, 'i'))
  if (nested?.[1]) return nested[1]
  const plain = s.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'i'))
  return plain?.[1] ?? null
}

function extractNumberField(raw: string, field: string, fallback: number): number {
  const nested = String(raw || '').match(new RegExp(`"${field}"\\s*:\\s*\\{[\\s\\S]*?"value"\\s*:\\s*([\\d.]+)`, 'i'))
  if (nested?.[1]) {
    const n = Number(nested[1])
    if (Number.isFinite(n)) return n
  }
  const plain = String(raw || '').match(new RegExp(`"${field}"\\s*:\\s*([\\d.]+)`, 'i'))
  if (plain?.[1]) {
    const n = Number(plain[1])
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** 从误输出的 Zod 内部结构或残缺 JSON 中恢复路由字段 */
export function recoverRouteFromMalformedLlm(raw: string): Record<string, unknown> | null {
  const text = stripThinkingBlocks(stripCodeFences(raw))
  if (!text) return null

  const allowed: string[] = []
  const allowedBlock = text.match(/"allowedAgents"\s*:\s*\[([\s\S]*?)\]/)
  if (allowedBlock?.[1]) {
    const inner = allowedBlock[1]
    for (const a of ROUTE_ALLOWED) {
      if (new RegExp(`"${a}"`).test(inner)) allowed.push(a)
    }
  }

  const intentRaw = extractZodEnumValue(text, 'intent')
  let intent =
    intentRaw && (ROUTE_INTENTS as readonly string[]).includes(intentRaw) ? intentRaw : null
  if (!intent && intentRaw) {
    const resolved = resolveRouteIntentFromPayload({ intent: intentRaw, allowedAgents: allowed })
    if (resolved && (ROUTE_INTENTS as readonly string[]).includes(resolved)) intent = resolved
  }
  if (!intent) return null

  const confidence = Math.min(1, Math.max(0, extractNumberField(text, 'confidence', 0.72)))
  const queryMatch = text.match(/"query"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const rationaleMatch = text.match(/"rationale"\s*:\s*"((?:\\.|[^"\\])*)"/)

  const needsClarify = /"needsClarify"\s*:\s*true/i.test(text)
  const clarifyQuestions: string[] = []
  const cqBlock = text.match(/"clarifyQuestions"\s*:\s*\[([\s\S]*?)\]/)
  if (cqBlock?.[1]) {
    const re = /"((?:\\.|[^"\\])*)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(cqBlock[1])) && clarifyQuestions.length < 6) {
      const q = m[1].replace(/\\"/g, '"').trim()
      if (q) clarifyQuestions.push(q)
    }
  }

  let taskStackOp: string | undefined
  const tso = extractZodEnumValue(text, 'taskStackOp')
  if (tso && ['none', 'add', 'done', 'delete'].includes(tso)) taskStackOp = tso

  const taskStackTitleMatch = text.match(/"taskStackTitle"\s*:\s*"((?:\\.|[^"\\])*)"/)

  return {
    intent,
    confidence,
    rationale: rationaleMatch?.[1]?.replace(/\\"/g, '"') || undefined,
    query: queryMatch?.[1]?.replace(/\\"/g, '"') || undefined,
    entities: { names: [], records: [], locations: [], dates: [] },
    allowedAgents: allowed.length ? allowed : undefined,
    needsClarify: needsClarify || clarifyQuestions.length > 0,
    clarifyQuestions: clarifyQuestions.length ? clarifyQuestions : undefined,
    taskStackOp,
    taskStackTitle: taskStackTitleMatch?.[1]?.replace(/\\"/g, '"') || undefined
  }
}

export function parseRouteLlmJson(raw: string) {
  const text = stripThinkingBlocks(stripCodeFences(raw))
  let obj = safeJsonParse(text) ?? parseFirstBalancedJsonObject(text)
  if (!obj || looksLikeZodInternalPayload(obj)) {
    const recovered = recoverRouteFromMalformedLlm(text)
    if (recovered) obj = recovered
  }
  obj = normalizeRouteLlmPayload(obj)
  return RouteSchema.safeParse(obj)
}

export function parsePlanLlmJson(raw: string) {
  const text = stripThinkingBlocks(stripCodeFences(raw))
  let obj = safeJsonParse(text) ?? parseFirstBalancedJsonObject(text)
  if (obj && typeof obj === 'object' && (obj as any).steps?._def) {
    const stepsVal = extractZodEnumValue(text, 'steps')
    void stepsVal
    obj = safeJsonParse(text.replace(/"_def"[\s\S]*?"value"/g, '"value"')) ?? obj
  }
  return PlanSchema.safeParse(obj)
}

export function effectiveAgentTimeoutMs(configuredMs: number): number {
  const base = Math.max(60_000, Number(configuredMs) || 120_000)
  if (isManagerDockerRuntime(process.env)) {
    const dockerFloor = Number(process.env.MANAGER_DOCKER_TIMEOUT_MS ?? 300_000)
    return Math.max(base, Number.isFinite(dockerFloor) ? dockerFloor : 300_000)
  }
  return base
}
