/** 去掉 Synth 误复述的内部上下文标记（非业务 regex 路由） */
export function stripSynthPromptLeakage(text: string): string {
  let s = String(text ?? '')
  if (!s.trim()) return s

  // 整块内部 CTX（HumanMessage 注入格式）
  s = s.replace(/\[CTX:[^\]\n]+\][\s\S]*?\[\/CTX\]/gi, '')

  // 旧版「### 数据来源：」块（直到下一 ### 或空行后非列表行）
  s = s.replace(/#{1,3}\s*数据来源[：:][^\n]*[\s\S]*?(?=\n#{1,3}\s[^\n]+|\n\*\*小结\*\*|\n\*\*[^*]+\*\*|$)/gi, '')

  const dropLine = (line: string) => {
    const t = line.trim()
    if (!t) return false
    if (/^#{1,3}\s*数据来源[：:]/i.test(t)) return true
    if (/^#{1,3}\s*结构化来源/i.test(t)) return true
    if (/^【RAG\s*检索事实】/i.test(t)) return true
    if (/^【RAG\s*探测事实块】/i.test(t)) return true
    if (/^【知识库检索】/.test(t)) return true
    if (/^\[CTX:/i.test(t) || /^\[\/CTX\]/i.test(t)) return true
    if (/^\[事实\d+\]/.test(t)) return true
    if (/^\[来源\]\s/.test(t)) return true
    if (/^摘要：.*\((code|db|rag|crawler|admin)\)/i.test(t)) return true
    return false
  }

  const lines = s.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (dropLine(line)) continue
    out.push(line)
  }
  s = out.join('\n')

  s = s.replace(/\n{3,}/g, '\n\n').trim()
  return s
}
