/** report 步骤 defer 到 Synth 时，从对话汇总正文生成 <!--REPORT--> 附属块（正文仍保留完整叙事） */
export function buildDeferredReportFromSynth(synthText: string): string {
  const t = String(synthText ?? '').trim()
  if (t.length < 60) return ''

  const sections: string[] = []
  let cur: string[] = []
  for (const line of t.split('\n')) {
    if (/^#{2,3}\s/.test(line.trim()) && cur.length) {
      sections.push(cur.join('\n').trim())
      cur = [line]
    } else {
      cur.push(line)
    }
  }
  if (cur.length) sections.push(cur.join('\n').trim())

  let body = ''
  if (sections.length >= 2) {
    body = sections.slice(1).join('\n\n').trim()
  } else if (sections.length === 1 && sections[0].length >= 120) {
    body = sections[0]
  } else {
    const h3 = t.indexOf('\n### ')
    if (h3 >= 0) body = t.slice(h3 + 1).trim()
    else if (t.length >= 160) body = t
  }
  if (body.length < 40) return ''
  if (/^##\s*分析报告/m.test(body)) return body
  return `## 分析报告\n\n${body}`
}
