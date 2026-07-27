import { loadPolicyRules } from '#agent-shared/toolCallPolicyEngine'

export default defineEventHandler(async () => {
  const rules = await loadPolicyRules()
  return { ok: true, count: rules.length, rules }
})
