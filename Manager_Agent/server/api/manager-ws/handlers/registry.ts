import type { WsHandlerContext, ParsedWsMessage } from './types'
import { handleResume } from './handleResume'
import { handleClearExperience } from './handleClearExperience'
import { handleRouteFeedback } from './handleRouteFeedback'
import { handleFeedback } from './handleFeedback'
import { handleWithdrawTurn } from './handleWithdrawTurn'
import { handleCancel } from './handleCancel'
import { handlePlanConfirm } from './handlePlanConfirm'
import { handleHumanConfirm } from './handleHumanConfirm'
import { handleChat } from './handleChat'

export type WsHandlerFn = (ctx: WsHandlerContext, payload: ParsedWsMessage) => Promise<void>

export const WS_MESSAGE_HANDLERS: Record<string, WsHandlerFn> = {
  resume: handleResume,
  clear_experience: handleClearExperience,
  route_feedback: handleRouteFeedback,
  feedback: handleFeedback,
  withdraw_turn: handleWithdrawTurn,
  cancel: handleCancel,
  plan_confirm: handlePlanConfirm,
  human_confirm: handleHumanConfirm
}

export async function dispatchWsByType(ctx: WsHandlerContext, type: string, payload: ParsedWsMessage) {
  const handler = WS_MESSAGE_HANDLERS[type] ?? handleChat
  await handler(ctx, payload)
}
