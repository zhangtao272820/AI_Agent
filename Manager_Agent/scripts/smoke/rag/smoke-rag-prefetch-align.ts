/**
 * RAG 模型证据裁判 smoke（无正则硬编码；自包含，避免 Nuxt 路径依赖）
 */

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

type Row = { source?: string; content?: string }
type Verdict = {
  relevant: boolean
  evidenceIndices?: number[]
  useAllEvidence?: boolean
  useAllProbeSnippets?: boolean
  snippetIndices?: number[]
}

function applyEvidenceMatchToRows(rows: Row[], verdict: Verdict): Row[] {
  if (!rows.length || verdict.relevant === false) return []
  if (verdict.useAllEvidence) return rows
  const idx = verdict.evidenceIndices
  if (Array.isArray(idx) && idx.length) {
    return idx.filter((i) => i >= 0 && i < rows.length).map((i) => rows[i]!)
  }
  return rows
}

async function judgeFilterRagEvidence(
  judge: (input: { stepQuery: string; evidence: Row[]; mode: 'retrieve_evidence' }) => Promise<Verdict>,
  stepQuery: string,
  rows: Row[]
) {
  if (!rows.length) return { rows: [], relevant: false }
  const v = await judge({ stepQuery, evidence: rows, mode: 'retrieve_evidence' })
  if (v.relevant === false) return { rows: [], relevant: false }
  const filtered = applyEvidenceMatchToRows(rows, v)
  return { rows: filtered.length ? filtered : rows, relevant: true }
}

const financeQ = '查询我的月度财务状况'

const mockJudge = async (input: {
  stepQuery: string
  evidence?: Row[]
  probeSnippets?: string[]
  mode: 'retrieve_evidence' | 'probe_snippets'
}): Promise<Verdict> => {
  if (input.mode === 'retrieve_evidence') {
    const blob = (input.evidence || [])
      .map((e, i) => `${i}:${String(e.source ?? '')}:${String(e.content ?? '')}`)
      .join('|')
    const financeHit = /个人月收入|6000|5000|财务|收入/.test(blob)
    const elderlyOnly = /养老|高龄|补贴/.test(blob) && !financeHit
    if (elderlyOnly) return { relevant: false }
    return { relevant: true, useAllEvidence: true }
  }
  const blob = (input.probeSnippets || []).join('|')
  if (/养老|高龄/.test(blob) && !/个人月收入|6000/.test(blob)) return { relevant: false }
  return { relevant: true, useAllProbeSnippets: true }
}

const elderlyEvidence = [
  { source: '养老机构服务规范.docx', content: '第二十一条 高龄老人补贴…' },
  { source: '养老服务补贴管理办法.docx', content: '失能老人补贴标准…' }
]
;(async () => {
  const elderlyJudged = await judgeFilterRagEvidence(mockJudge, financeQ, elderlyEvidence)
  assert(!elderlyJudged.relevant && elderlyJudged.rows.length === 0, 'model judge filters off-topic evidence')

  const financeEvidence = [{ source: '个人月收入.txt', content: '月收入6000 月支出5000' }]
  const financeJudged = await judgeFilterRagEvidence(mockJudge, financeQ, financeEvidence)
  assert(financeJudged.relevant && financeJudged.rows.length === 1, 'finance evidence kept')

  const mixed = [...financeEvidence, ...elderlyEvidence]
  const partial = applyEvidenceMatchToRows(mixed, { relevant: true, evidenceIndices: [0] })
  assert(partial.length === 1 && partial[0]!.source.includes('个人月收入'), 'evidenceIndices pick')

  console.log('smoke: rag prefetch align ok')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
