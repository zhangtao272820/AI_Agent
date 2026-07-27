export type DbFieldConstraintInput = {
  timeHints?: string[]
  subjectHints?: string[]
  fieldHints?: string[]
  wantsVisualize?: boolean
  wantsReport?: boolean
}

export type DbFieldConstraints = {
  mustFilters: string[]
  riskNotes: string[]
}

/** 领域维表/业务列提示（由 DB_AGENT_DOMAIN 驱动，非问句关键词路由） */
const DOMAIN_FIELD_HINTS: Record<string, string[]> = {
  elderly_care: [
    '康养/足压类：优先输出检测时间、左右脚或侧别、压力指标与参考范围；有区域/分区从表时可 LEFT JOIN',
    '人员维度：create_person 等外键须 JOIN 人员/患者表输出可读姓名'
  ]
}

/**
 * 结构性推断 DB SQL 字段约束：依赖路由阶段 taskConstraints（subjectHints 等），不用正则/关键词表做路由。
 */
export function inferDbFieldConstraintsStructural(input: {
  constraints?: DbFieldConstraintInput | null
  domain?: string
}): DbFieldConstraints {
  const c = input.constraints ?? {}
  const subjectHints = Array.isArray(c.subjectHints) ? c.subjectHints : []
  const wantsReport = Boolean(c.wantsReport)
  const must: string[] = []
  const risk: string[] = []
  const domain = String(input.domain ?? process.env.DB_AGENT_DOMAIN ?? '')
    .trim()
    .toLowerCase()

  const hasSubject = subjectHints.length > 0
  const needsRichOutput = hasSubject || wantsReport

  if (hasSubject) {
    must.push(
      `分析对象（${subjectHints.join('、')}）须在结果中以可读名称呈现；禁止仅返回 create_person/create_user 等外键 ID，须 JOIN 人员/患者/用户维表`
    )
  }

  if (needsRichOutput) {
    must.push(
      'SELECT 须包含与问题语义相关的业务列（测量值、检测时间、部位/侧别、参考范围等），禁止只返回主键或单一计数'
    )
    risk.push('若 schema 缺少某列，在结果 JSON 的 missingFields 中列出，勿编造数值')
    risk.push('优先结构化输出（Markdown 表格或 JSON 行），便于下游 report 直接引用')
  }

  const domainHints = DOMAIN_FIELD_HINTS[domain]
  if (domainHints?.length && needsRichOutput) {
    for (const h of domainHints) {
      if (!risk.includes(h)) risk.push(h)
    }
  }

  return { mustFilters: must.slice(0, 6), riskNotes: risk.slice(0, 6) }
}

/** 从 taskConstraints 汇总 DB schema 字段检索词（LLM fieldHints 优先） */
export function inferDbFieldHintsStructural(input: {
  constraints?: DbFieldConstraintInput | null
}): string[] {
  const c = input.constraints ?? {}
  const fieldHints = Array.isArray(c.fieldHints) ? c.fieldHints : []
  const subjectHints = Array.isArray(c.subjectHints) ? c.subjectHints : []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (s: string) => {
    const t = String(s ?? '').trim()
    if (t.length < 2 || seen.has(t)) return
    seen.add(t)
    out.push(t)
  }
  for (const f of fieldHints) push(f)
  for (const s of subjectHints) {
    if (/压力|检测|指标|范围|侧别|左右|时间|记录/.test(s)) push(s)
  }
  return out.slice(0, 8)
}
