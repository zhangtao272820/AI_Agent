import { loadTaskStack, setTaskStackStatus, type TaskStackItem } from './taskStack'

export function isTaskStackAutoCompleteEnabled() {
  return String(process.env.MANAGER_TASK_STACK_AUTO_COMPLETE ?? '1').trim() !== '0'
}

function tokenSet(text: string): Set<string> {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  const out = new Set<string>()
  for (const w of t.split(/\s+/)) {
    if (w.length >= 2) out.add(w)
  }
  return out
}

function overlapScore(a: string, b: string): number {
  const ta = tokenSet(a)
  const tb = tokenSet(b)
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const x of ta) {
    if (tb.has(x)) hit += 1
  }
  return hit / Math.max(ta.size, tb.size)
}

function pickCompletableTask(
  items: TaskStackItem[],
  userQuery: string,
  intent: string,
  successScore: number
): TaskStackItem | null {
  const active = items.filter((t) => t.status === 'active')
  if (!active.length || successScore < 0.72) return null
  if (Boolean(intent) && /clarify/i.test(intent)) return null

  const q = String(userQuery || '').trim()
  let best: TaskStackItem | null = null
  let bestScore = 0
  for (const task of active) {
    let score = overlapScore(q, task.title)
    if (task.note) score = Math.max(score, overlapScore(q, task.note) * 0.85)
    if (score >= 0.28 && score > bestScore) {
      best = task
      bestScore = score
    }
  }
  if (best) return best

  if (active.length === 1 && successScore >= 0.82 && q.length >= 8) {
    return active[0]
  }
  return null
}

/** run 成功且与任务栈 active 项语义对齐时自动标完成 */
export async function maybeCompleteTaskStackFromRun(
  policyDir: string,
  sessionId: string | undefined,
  input: {
    userQuery: string
    intent: string
    successScore: number
    needsClarify?: boolean
  }
): Promise<{ completed: boolean; taskId?: string; title?: string }> {
  const sid = String(sessionId || '').trim()
  if (!sid || !isTaskStackAutoCompleteEnabled()) return { completed: false }
  if (input.needsClarify) return { completed: false }

  const stack = await loadTaskStack(policyDir, sid)
  const task = pickCompletableTask(stack.items, input.userQuery, input.intent, input.successScore)
  if (!task) return { completed: false }

  await setTaskStackStatus(policyDir, sid, task.id, 'done')
  return { completed: true, taskId: task.id, title: task.title }
}
