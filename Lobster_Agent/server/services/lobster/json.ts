function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function extractFirstJsonValue(text: string) {
  const s = String(text ?? '')
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const j = safeJson(String(fenced[1]).trim())
    if (j !== null) return j
  }

  const firstObj = s.indexOf('{')
  const firstArr = s.indexOf('[')
  const first =
    firstObj < 0 ? firstArr : firstArr < 0 ? firstObj : Math.min(firstObj, firstArr)
  if (first < 0) return null

  const open = s[first]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false
  let start = -1

  for (let i = first; i < s.length; i++) {
    const ch = s[i]!
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === open) {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === close) {
      if (depth > 0) depth--
      if (depth === 0 && start >= 0) {
        const candidate = s.slice(start, i + 1)
        const j = safeJson(candidate)
        if (j !== null) return j
        start = -1
      }
    }
  }
  return null
}

export function extractFirstJsonObject(text: string) {
  const s = String(text ?? '')
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const j = safeJson(String(fenced[1]).trim())
    if (j && typeof j === 'object') return j
  }

  const firstBrace = s.indexOf('{')
  if (firstBrace < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  let start = -1

  for (let i = firstBrace; i < s.length; i++) {
    const ch = s[i]!
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start >= 0) {
        const candidate = s.slice(start, i + 1)
        const j = safeJson(candidate)
        if (j && typeof j === 'object') return j
        start = -1
      }
    }
  }
  return null
}
