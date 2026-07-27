/**
 * 成功 edit 案例写入 playbook（P2-B4 hint_files 召回）
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export type EditPlaybookEntry = {
  ts: string
  question: string
  task_kind: string
  hint_files: string[]
  files_touched: string[]
  validate_ok?: boolean
  completion_criteria?: string[]
}

const PLAYBOOK_PATH = path.join(process.cwd(), '.data', 'code-task-playbook', 'success.jsonl')

export async function recordEditPlaybookEntry(entry: EditPlaybookEntry): Promise<void> {
  await fs.mkdir(path.dirname(PLAYBOOK_PATH), { recursive: true }).catch(() => undefined)
  const line = JSON.stringify(entry)
  await fs.appendFile(PLAYBOOK_PATH, `${line}\n`, 'utf8').catch(() => undefined)
}

export async function recallEditPlaybookHints(input: {
  question: string
  limit?: number
}): Promise<string[]> {
  const limit = Math.min(8, Math.max(1, Number(input.limit ?? 4)))
  const q = String(input.question || '').toLowerCase()
  if (!q.trim()) return []

  let raw = ''
  try {
    raw = await fs.readFile(PLAYBOOK_PATH, 'utf8')
  } catch {
    return []
  }

  const hints = new Set<string>()
  const lines = raw.split(/\r?\n/).filter(Boolean).reverse()
  for (const line of lines) {
    if (hints.size >= limit) break
    try {
      const row = JSON.parse(line) as EditPlaybookEntry
      const blob = `${row.question} ${(row.hint_files || []).join(' ')}`.toLowerCase()
      const overlap = q.split(/\s+/).some((t) => t.length >= 3 && blob.includes(t))
      if (!overlap && hints.size > 0) continue
      for (const f of row.hint_files || []) {
        if (f) hints.add(f)
        if (hints.size >= limit) break
      }
      for (const f of row.files_touched || []) {
        if (f) hints.add(f)
        if (hints.size >= limit) break
      }
    } catch {
      continue
    }
  }
  return [...hints]
}
