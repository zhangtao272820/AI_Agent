/**
 * 识图回复净化：去掉未询问身份时 LLM 从历史/DB 人名「附会」的姓名。
 */

export function userAskedIdentity(userTask: string): boolean {
  const t = String(userTask ?? '')
  return ['是谁', '叫什么', '姓名', '名字', '人名', '哪个人', '哪个明星', '认出'].some((w) => t.includes(w))
}

export function sanitizeVisionAnswer(answer: string, userTask: string): string {
  let s = String(answer ?? '').trim()
  if (!s || userAskedIdentity(userTask)) return s
  s = s.replace(/，?\s*名为[^，。；\n]{2,16}/g, '')
  s = s.replace(/，?\s*叫做[^，。；\n]{2,16}/g, '')
  s = s.replace(/，?\s*名叫[^，。；\n]{2,16}/g, '')
  s = s.replace(/\s{2,}/g, ' ').replace(/，，/g, '，').trim()
  return s
}
