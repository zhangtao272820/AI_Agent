/** 总管 tool_health / live probe 标准健康检查 */
export default defineEventHandler(() => ({
  ok: true,
  service: 'db_agent',
  ts: new Date().toISOString()
}))
