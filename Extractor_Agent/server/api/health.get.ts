/** Docker healthcheck 与总管 live probe 使用 */
export default defineEventHandler(() => ({
  ok: true,
  service: 'extractor_agent',
  ts: new Date().toISOString()
}))
