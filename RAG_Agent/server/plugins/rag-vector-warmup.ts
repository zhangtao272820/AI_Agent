import { auditVectorStoreHealth, getUploadedDocuments, getVectorStore } from '../utils/vectorStore'

/** Docker 重启后预热向量库，避免首条 /api/probe、/api/retrieve 卡在冷启动 */
export default defineNitroPlugin(() => {
  void (async () => {
    try {
      await getVectorStore()
      const docs = await getUploadedDocuments()
      const audit = await auditVectorStoreHealth({ reconcile: true })
      console.log(
        `[rag-warmup] ready backend=${audit.backend} docs=${docs.length} vectors=${audit.vectorRowCount ?? audit.memoryVectorCount ?? 0} consistent=${audit.consistent}`
      )
      if (audit.warnings.length) {
        console.warn(`[rag-warmup] warnings: ${audit.warnings.join(', ')}`)
      }
    } catch (e) {
      console.error('[rag-warmup] vector init failed:', e instanceof Error ? e.message : e)
    }
  })()
})
