import type { WsHandlerContext, ParsedWsMessage } from './types'
import { resolvePlanConfirm } from './wsBarrel'

export async function handlePlanConfirm(ctx: WsHandlerContext, payload: ParsedWsMessage) {
  const { send } = ctx

  const rid = String((payload as any).runId || '').trim()
  const previewId = String((payload as any).previewId || '').trim()
  const action = String((payload as any).action || 'cancel') as 'execute' | 'cancel'
  const rawSteps = Array.isArray((payload as any).steps) ? (payload as any).steps : []
  const constraints = String((payload as any).constraints || '').trim().slice(0, 500)
  const steps =
    action === 'execute'
      ? rawSteps
          .filter((s: { enabled?: boolean }) => s?.enabled !== false)
          .map(
            (s: {
              id?: string
              agent?: string
              query?: string
              dependsOn?: string[]
              parallelGroup?: string
              enabled?: boolean
            }) => ({
              id: String(s?.id || '').trim(),
              agent: String(s?.agent || '').trim(),
              query: String(s?.query || '').trim(),
              enabled: s?.enabled !== false,
              ...(Array.isArray(s?.dependsOn) ? { dependsOn: s.dependsOn } : {}),
              ...(s?.parallelGroup ? { parallelGroup: String(s.parallelGroup) } : {})
            })
          )
          .filter((s: { id: string; agent: string }) => s.id && s.agent)
      : undefined
  const resolved =
    action === 'execute'
      ? resolvePlanConfirm(rid, previewId, {
          action: 'execute',
          steps,
          ...(constraints ? { constraints } : {})
        })
      : resolvePlanConfirm(rid, previewId, { action: 'cancel' })
  send(
    'plan_confirm_ack',
    { resolved, action, previewId, runId: rid, stepCount: steps?.length ?? 0 },
    'manager',
    rid || undefined
  )
  return
}
