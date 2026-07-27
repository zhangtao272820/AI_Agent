import { defineStore } from 'pinia'

export type AgentMode = 'auto' | 'analyze' | 'bugs' | 'refactor' | 'tests'
export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  clarifyChips?: string[]
  clarifyBaseQuestion?: string
  feedbackSent?: boolean
  taskKind?: string
  abVariant?: string
}

function makeClientId() {
  const maybeCrypto = (globalThis as any)?.crypto
  if (maybeCrypto && typeof maybeCrypto.randomUUID === 'function') {
    return maybeCrypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type ToolTimelineEntry = {
  id: string
  kind: 'start' | 'end' | 'phase'
  tool?: string
  phase?: string
  status?: string
  ms?: number
  at: number
}

export const useSessionStore = defineStore('session', () => {
  const input = ref('')
  const sending = ref(false)
  const snippetSending = ref(false)
  const mode = ref<AgentMode>('auto')
  const lastResult = ref('')
  const streamingAssistantId = ref<string | null>(null)
  const toolTimeline = ref<ToolTimelineEntry[]>([])

  const threadId = ref<string>('default')
  const messages = ref<ChatMessage[]>([
    {
      id: makeClientId(),
      role: 'assistant',
      content:
        'Agent-first Workbench：Ask 只读 / Edit 改码+validate / Agent 多步自动。可用 @file:path 或 @folder:dir 注入上下文，工具时间线与 Diff 审阅会显示在下方。',
    },
  ])

  function initFromStorage() {
    const existing = localStorage.getItem('agentThreadId')
    threadId.value = existing || makeClientId()
    localStorage.setItem('agentThreadId', threadId.value)
  }

  function resetThread() {
    threadId.value = makeClientId()
    localStorage.setItem('agentThreadId', threadId.value)
    messages.value = [
      {
        id: makeClientId(),
        role: 'assistant',
        content: '已开始新会话。Ask / Edit / Agent 模式与 @file · @folder 上下文仍然可用。',
      },
    ]
    streamingAssistantId.value = null
    toolTimeline.value = []
    input.value = ''
  }

  function formatAnalyzeResponse(res: any) {
    const srcLabel = res?.source === 'file' ? `文件：${res?.path || ''}` : '代码片段'
    const parts: string[] = []
    parts.push(`分析结果（${srcLabel}）`)

    const m = res?.metrics
    if (m) {
      parts.push('')
      parts.push('指标概览：')
      parts.push(`- 代码行数（LOC）：${m.loc ?? 0}`)
      parts.push(`- 函数数量：${m.functions ?? 0}`)
      parts.push(`- 类数量：${m.classes ?? 0}`)
      parts.push(`- 分支/循环估算：${m.branches ?? 0}`)
      parts.push(`- 逻辑运算（&&/||）次数：${m.logicalOps ?? 0}`)
      parts.push(`- import/require 次数：${m.importCount ?? 0}`)
      parts.push(`- any 类型标注次数：${m.anyType ?? 0}`)
      parts.push(`- TODO/FIXME 数量：${m.todos ?? 0}`)
    }

    const smells = Array.isArray(res?.smells) ? res.smells : null
    if (smells) {
      parts.push('')
      if (smells.length) {
        parts.push('代码异味：')
        for (const s of smells) {
          parts.push(`- ${s.kind}: ${s.detail}${s.hint ? `（建议：${s.hint}）` : ''}`)
        }
      } else {
        parts.push('代码异味：未发现明显问题')
      }
    }

    const issues = Array.isArray(res?.issues) ? res.issues : null
    if (issues) {
      parts.push('')
      if (issues.length) {
        parts.push('潜在问题：')
        for (const it of issues) {
          const sev = it.severity ? `（${it.severity}）` : ''
          parts.push(`- ${it.rule}${sev}: ${it.detail}`)
        }
      } else {
        parts.push('潜在问题：未发现')
      }
    }

    const explain = res?.explain
    if (explain) {
      parts.push('')
      parts.push('结构信息：')
      parts.push(`- exports：${Array.isArray(explain.exports) ? explain.exports.join(', ') || '无' : '无'}`)
      parts.push(`- 默认导出：${explain.hasDefault ? '是' : '否'}`)
      parts.push(`- imports：${Array.isArray(explain.imports) ? explain.imports.join(', ') || '无' : '无'}`)
    }

    const tests = res?.tests
    if (tests) {
      parts.push('')
      parts.push(`测试样板（${tests.framework || 'unknown'}）：`)
      if (tests.content) parts.push(tests.content)
    }

    return parts.join('\n')
  }

  async function analyzeSnippet(text: string) {
    if (!text.trim() || snippetSending.value) return
    snippetSending.value = true
    input.value = ''
    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('agentJwt') || '' : ''
      const res = await $fetch('/api/analyze', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: { text, actions: ['metrics', 'smells', 'bugs', 'explain'], maxChars: 200000 }
      })
      lastResult.value = formatAnalyzeResponse(res)
      messages.value = [...messages.value, { id: makeClientId(), role: 'assistant', content: lastResult.value }]
    } catch (err: any) {
      messages.value = [
        ...messages.value,
        {
          id: makeClientId(),
          role: 'assistant',
          content: `片段分析失败：${err?.data?.statusMessage || err?.message || String(err)}`
        }
      ]
    } finally {
      snippetSending.value = false
    }
  }

  function attachClarifyToAssistant(payload: {
    chips?: string[]
    baseQuestion?: string
    taskKind?: string
    abVariant?: string
  }) {
    const id = streamingAssistantId.value
    if (!id) return
    const idx = messages.value.findIndex((m) => m.id === id)
    if (idx < 0) return
    const next = messages.value.slice()
    next[idx] = {
      ...next[idx]!,
      clarifyChips: payload.chips?.length ? [...payload.chips] : undefined,
      clarifyBaseQuestion: payload.baseQuestion,
      taskKind: payload.taskKind,
      abVariant: payload.abVariant,
    }
    messages.value = next
  }

  function attachMetaToAssistant(meta: { taskKind?: string; abVariant?: string }) {
    const id = streamingAssistantId.value
    if (!id) return
    const idx = messages.value.findIndex((m) => m.id === id)
    if (idx < 0) return
    const next = messages.value.slice()
    next[idx] = {
      ...next[idx]!,
      taskKind: meta.taskKind ?? next[idx]!.taskKind,
      abVariant: meta.abVariant ?? next[idx]!.abVariant,
    }
    messages.value = next
  }

  function finishStream() {
    sending.value = false
    const id = streamingAssistantId.value
    streamingAssistantId.value = null
    if (!id) return
    const idx = messages.value.findIndex((m) => m.id === id)
    if (idx < 0) return
    const msg = messages.value[idx]
    if (msg?.role === 'assistant' && !String(msg.content || '').trim()) {
      const next = messages.value.slice()
      next[idx] = { ...msg, content: '(空响应)' }
      messages.value = next
    }
  }

  function appendDelta(delta: string) {
    const d = String(delta ?? '')
    if (!d) return
    const id = streamingAssistantId.value
    if (id) {
      const idx = messages.value.findIndex((m) => m.id === id)
      if (idx >= 0) {
        const msg = messages.value[idx]
        if (msg?.role === 'assistant') {
          const next = messages.value.slice()
          next[idx] = { ...msg, content: String(msg.content || '') + d }
          messages.value = next
          return
        }
      }
    }

    const lastIndex = messages.value.length - 1
    const last = messages.value[lastIndex]
    if (lastIndex >= 0 && last?.role === 'assistant') {
      const next = messages.value.slice()
      next[lastIndex] = { ...last, content: String(last.content || '') + d }
      messages.value = next
      return
    }
    messages.value = [...messages.value, { id: makeClientId(), role: 'assistant', content: d }]
  }

  function pushToolTimeline(entry: Omit<ToolTimelineEntry, 'id' | 'at'> & { at?: number }) {
    toolTimeline.value = [
      ...toolTimeline.value,
      {
        id: makeClientId(),
        at: entry.at ?? Date.now(),
        kind: entry.kind,
        tool: entry.tool,
        phase: entry.phase,
        status: entry.status,
        ms: entry.ms,
      },
    ]
  }

  function addEventMessage(event: any) {
    if (event.type === 'phase' && event.phase) {
      pushToolTimeline({ kind: 'phase', phase: String(event.phase) })
    } else if (event.type === 'tool_start' && event.tool) {
      pushToolTimeline({ kind: 'start', tool: String(event.tool) })
    } else if (event.type === 'tool_end' && event.tool) {
      pushToolTimeline({
        kind: 'end',
        tool: String(event.tool),
        status: event.status ? String(event.status) : undefined,
        ms: Number.isFinite(event.ms) ? Number(event.ms) : undefined,
      })
    }

    let text = ''
    if (event.type === 'phase' && event.phase) {
      text = `[phase] ${event.phase}`
    } else if (event.type === 'tool_start' && event.tool) {
      text = `[tool:start] ${event.tool}`
    } else if (event.type === 'tool_end' && event.tool) {
      const ms = Number.isFinite(event.ms) ? `${Number(event.ms)}ms` : ''
      const status = event.status ? String(event.status) : ''
      text = `[tool:end] ${event.tool}${status ? ` ${status}` : ''}${ms ? ` ${ms}` : ''}`
    }

    if (!text) return

    // Find if we should append to last event message or create new
    const lastIndex = messages.value.length - 1
    const last = messages.value[lastIndex]
    if (last && last.role === 'assistant' && (last.content.startsWith('[tool:') || last.content.startsWith('[phase]'))) {
      const next = messages.value.slice()
      next[lastIndex] = { ...last, content: `${last.content}\n${text}` }
      messages.value = next
    } else {
      messages.value = [...messages.value, { id: makeClientId(), role: 'assistant', content: text }]
    }
  }

  async function sendMessageWs(ws: WebSocket, params: {
    message: string
    root?: string
    contextPath?: string
    agentMode?: 'ask' | 'edit' | 'agent'
    hintFiles?: string[]
  }) {
    const text = params.message.trim()
    if (!text || sending.value) return

    const assistantId = makeClientId()
    streamingAssistantId.value = assistantId
    messages.value = [
      ...messages.value,
      { id: makeClientId(), role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '' }
    ]
    input.value = ''
    sending.value = true
    toolTimeline.value = []
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('agentJwt') || '' : ''

    ws.send(JSON.stringify({
      type: 'agent-chat',
      payload: {
        threadId: threadId.value,
        message: text,
        mode: mode.value,
        root: params.root,
        contextPath: params.contextPath,
        agent_mode: params.agentMode,
        hint_files: params.hintFiles?.length ? params.hintFiles : undefined,
        token: token || undefined
      }
    }))
  }

  async function sendMessage(params: {
    message: string
    root?: string
    contextPath?: string
  }) {
    const text = params.message.trim()
    if (!text || sending.value) return

    const userId = makeClientId()
    const assistantId = makeClientId()
    messages.value = [
      ...messages.value,
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '' }
    ]
    input.value = ''
    sending.value = true

    try {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('agentJwt') || '' : ''
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          threadId: threadId.value,
          message: text,
          mode: mode.value,
          root: params.root,
          contextPath: params.contextPath,
          stream: true
        })
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw new Error(errText || `HTTP ${resp.status}`)
      }
      const ctype = resp.headers.get('content-type') || ''
      // Fallback: if server didn't return SSE, read JSON/text directly and set as reply.
      if (!/text\/event-stream/i.test(ctype)) {
        const textBody = await resp.text()
        let reply = ''
        try {
          const obj = JSON.parse(textBody)
          reply = obj?.reply || textBody
        } catch {
          reply = textBody
        }
        const idx = messages.value.findIndex((m) => m.id === assistantId)
        if (idx >= 0) {
          const next = messages.value.slice()
          next[idx] = { ...next[idx]!, content: reply || '(空响应)' }
          messages.value = next
        }
        return
      }
      if (!resp.body) throw new Error('Empty stream body')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let done = false

      const eventId = `${assistantId}:events`
      const pushAgentEvent = (text: string) => {
        const idx = messages.value.findIndex((m) => m.id === assistantId)
        if (idx < 0) {
          messages.value = [...messages.value, { id: eventId, role: 'assistant', content: text }]
          return
        }
        const existingIdx = messages.value.findIndex((m) => m.id === eventId)
        if (existingIdx >= 0) {
          const next = messages.value.slice()
          const cur = next[existingIdx]!
          next[existingIdx] = { ...cur, content: `${cur.content}\n${text}` }
          messages.value = next
          return
        }
        const next = messages.value.slice()
        next.splice(idx, 0, { id: eventId, role: 'assistant', content: text })
        messages.value = next
      }

      const append = (delta: string) => {
        const idx = messages.value.findIndex((m) => m.id === assistantId)
        if (idx < 0) return
        const next = messages.value.slice()
        const cur = next[idx]!
        next[idx] = { ...cur, content: (cur.content || '') + delta }
        messages.value = next
      }

      while (!done) {
        const r = await reader.read()
        if (r.done) break
        buffer += decoder.decode(r.value, { stream: true })
        while (true) {
          const sep = buffer.indexOf('\n\n')
          if (sep < 0) break
          const raw = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const lines = raw.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice('data: '.length)
            try {
              const obj = JSON.parse(payload)
              if (obj?.type === 'delta' && obj?.delta) append(String(obj.delta))
              if (obj?.delta && !obj?.type) append(String(obj.delta))
              if (obj?.type === 'phase' && obj?.phase) {
                pushAgentEvent(`[phase] ${String(obj.phase)}`)
              }
              if (obj?.type === 'tool_start' && obj?.name) {
                pushAgentEvent(`[tool:start] ${String(obj.name)}`)
              }
              if (obj?.type === 'tool_end' && obj?.name) {
                const ms = Number.isFinite(obj?.ms) ? `${Number(obj.ms)}ms` : ''
                const status = obj?.status ? String(obj.status) : ''
                pushAgentEvent(`[tool:end] ${String(obj.name)}${status ? ` ${status}` : ''}${ms ? ` ${ms}` : ''}`)
              }
              if (obj?.error) {
                const idx = messages.value.findIndex((m) => m.id === assistantId)
                if (idx >= 0) {
                  const next = messages.value.slice()
                  next[idx] = { ...next[idx]!, content: String(obj.error) }
                  messages.value = next
                }
                done = true
              }
              if (obj?.done) done = true
            } catch {}
          }
        }
      }
      const idx = messages.value.findIndex((m) => m.id === assistantId)
      if (idx >= 0 && !messages.value[idx]!.content) {
        const next = messages.value.slice()
        next[idx] = { ...next[idx]!, content: '(空响应)' }
        messages.value = next
      }
    } catch (err: any) {
      const msg = `请求失败：${err?.data?.statusMessage || err?.message || String(err)}`
      const idx = messages.value.findIndex((m) => m.id === assistantId)
      if (idx >= 0) {
        const next = messages.value.slice()
        next[idx] = { ...next[idx]!, content: msg }
        messages.value = next
      } else {
        messages.value = [...messages.value, { id: makeClientId(), role: 'assistant', content: msg }]
      }
    } finally {
      sending.value = false
    }
  }

  return {
    input,
    sending,
    snippetSending,
    mode,
    lastResult,
    threadId,
    messages,
    initFromStorage,
    resetThread,
    analyzeSnippet,
    sendMessage,
    sendMessageWs,
    appendDelta,
    addEventMessage,
    toolTimeline,
    pushToolTimeline,
    attachClarifyToAssistant,
    attachMetaToAssistant,
    finishStream,
    formatAnalyzeResponse
  }
})
