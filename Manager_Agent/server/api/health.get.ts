/** 总管 tool_health / Docker HEALTHCHECK */
export default defineEventHandler(() => ({
  ok: true,
  service: 'manager_agent',
  ts: new Date().toISOString()
}))
