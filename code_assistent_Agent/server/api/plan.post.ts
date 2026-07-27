import { buildCodePlan } from '../utils/code_plan'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    query?: string
    message?: string
    managerTask?: Record<string, unknown>
    manager_task_json?: Record<string, unknown> | string
  }>(event).catch(() => ({}))

  const raw = String(body?.query ?? body?.message ?? '').trim()
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: 'query 或 message 不能为空' })
  }

  return buildCodePlan({
    message: raw,
    managerTask: body?.managerTask,
    manager_task_json: body?.manager_task_json,
  })
})
