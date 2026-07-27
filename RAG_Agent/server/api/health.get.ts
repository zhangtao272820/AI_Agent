import { getUploadedDocuments, getVectorBackend } from '../utils/vectorStore'
import { getRagAgentEnv } from '../utils/rag_agent_env'

/** 总管 tool_health / live probe 标准健康检查 */
export default defineEventHandler(async () => {
  let vectorBackend: string | undefined
  let docCount: number | undefined
  let corpusTier: string | null = null
  let corpusTierLabel: string | null = null
  try {
    vectorBackend = await getVectorBackend()
    docCount = (await getUploadedDocuments()).length
    const env = getRagAgentEnv({ docCount })
    corpusTier = env.corpusTier
    corpusTierLabel = env.corpusTierLabel
  } catch {
    /* process up; ready endpoint carries deep check */
  }
  return {
    ok: true,
    service: 'rag_agent',
    vectorBackend,
    docCount,
    corpusTier,
    corpusTierLabel,
    ts: new Date().toISOString()
  }
})
