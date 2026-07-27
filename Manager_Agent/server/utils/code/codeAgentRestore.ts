import { agentHttpBaseFromWsUrl } from '../agents/agentTransport'

/** 撤销 Code Agent 写盘（调用 code-assist /api/git-restore） */
export async function restoreCodeAgentEditedFiles(input: {
  codeAgentWsUrl: string
  paths: string[]
  root?: string
  signal?: AbortSignal
}): Promise<{ ok: boolean; error?: string }> {
  const paths = input.paths.map(String).filter(Boolean)
  if (!paths.length) return { ok: true }
  const base = agentHttpBaseFromWsUrl(input.codeAgentWsUrl, '13103')
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/git-restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths,
        ...(input.root ? { root: input.root } : {}),
      }),
      signal: input.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: text || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: String((e as Error)?.message ?? e ?? 'restore failed') }
  }
}
