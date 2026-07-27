import { initManagerPostgresCheckpointer } from '../graph/core/runtime/langgraphCheckpointer'

/** 启动时初始化 PostgresSaver（MANAGER_LANGGRAPH_CHECKPOINTER=postgres） */
export default defineNitroPlugin(() => {
  initManagerPostgresCheckpointer().catch(() => undefined)
})
