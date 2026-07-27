import { buildDownstreamAgentContext, type ExtractPayloadFn } from '#agent-shared/codeFirstAuthority'
import { resolveCrawlerTableMarkdown } from '../../../utils/crawler/crawlerItemsParse'

/** report 内置 Agent：放宽上游上下文，爬虫优先注入表格 Markdown */
export function buildReportAgentContext(
  results: Record<string, unknown>,
  extractPayload: ExtractPayloadFn
): string {
  return buildDownstreamAgentContext(results, extractPayload, {
    maxCodeChars: 3200,
    maxRefChars: 1400,
    perAgentMaxChars: { crawler: 3200, db: 1800, rag: 1600, clean: 1200 },
    enrichAgentBody: (agent, raw) => {
      if (agent !== 'crawler') return ''
      const table = resolveCrawlerTableMarkdown(raw)
      return table ? table.trim() : ''
    }
  })
}

/** visualize 内置 Agent */
export function buildVisualizeAgentContext(
  results: Record<string, unknown>,
  extractPayload: ExtractPayloadFn
): string {
  return buildDownstreamAgentContext(results, extractPayload, {
    maxCodeChars: 2800,
    maxRefChars: 1200,
    perAgentMaxChars: { crawler: 2400, db: 1400, rag: 1200, clean: 1000 },
    enrichAgentBody: (agent, raw) => {
      if (agent !== 'crawler') return ''
      const table = resolveCrawlerTableMarkdown(raw)
      return table ? table.trim() : ''
    }
  })
}

/** multi 内 report/visualize 协作 */
export function buildInternalCollabContext(
  results: Record<string, unknown>,
  extractPayload: ExtractPayloadFn,
  kind: 'report' | 'visualize' | 'clean'
): string {
  if (kind === 'report') return buildReportAgentContext(results, extractPayload)
  if (kind === 'visualize') return buildVisualizeAgentContext(results, extractPayload)
  return buildDownstreamAgentContext(results, extractPayload, {
    maxCodeChars: 2600,
    maxRefChars: 1000,
    perAgentMaxChars: { crawler: 2000, db: 1200, rag: 1000, clean: 800 }
  })
}
