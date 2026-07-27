
import type { CreateMonitorNodeDeps } from './types'


export function createMonitorNode(deps: CreateMonitorNodeDeps) {
  const { opts, mergeMeta, appendMetrics } = deps
  return async (state: any) => {
    const t0 = Date.now()
    opts.sendEvent({ event: 'phase', data: 'monitor', from: 'manager' })
    const evidence = Array.isArray(state.evidence) ? state.evidence : []
    const results = state.results && typeof state.results === 'object' ? state.results : {}
    const errorCount = evidence.filter((e: any) => String(e?.kind || '') === 'error').length
    const dataEvidenceCount = evidence.filter((e: any) => ['rag', 'db', 'crawler'].includes(String(e?.kind || ''))).length
    const resultAgents = Object.keys(results).filter((k) => String(results[k] || '').trim().length > 0)
    const clarifyCount = Array.isArray(state?.meta?.clarifyQuestions) ? state.meta.clarifyQuestions.length : 0
    const summary = `results=${resultAgents.length}, dataEvidence=${dataEvidenceCount}, errors=${errorCount}, clarifyQs=${clarifyCount}`
    opts.sendEvent({ event: 'thinking', data: `监控汇总：${summary}`, from: 'manager' })
    await appendMetrics({ runId: opts.runId, phase: 'monitor', ms: Date.now() - t0 }).catch(() => undefined)
    return {
      monitor: {
        resultAgents,
        dataEvidenceCount,
        errorCount,
        clarifyCount,
        summary,
        checkedAt: new Date().toISOString()
      },
      meta: mergeMeta(state, {
        uncertainty: errorCount > 0 ? 'medium' : state?.meta?.uncertainty ?? 'low'
      })
    }
  }
}


