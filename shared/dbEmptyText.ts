/** DB 空结果 / 拒答文案 marker（includes 匹配，非业务正则分类） */
export const DB_EMPTY_ANSWER_MARKERS = [
  '未查询到',
  '没有数据',
  '无记录',
  '查询结果为空',
  '暂无',
  '0条',
  '0 条',
  'count:0',
  'count：0',
  'not found',
  'no data',
  'no records',
  '无法找到',
  '没有找到',
  '无匹配',
  '缺少表',
  '缺少字段',
  '无法检索',
  '请补充信息',
  '请提供',
  '数据库未查到',
  '数据库中未找到',
  '未在数据库中查到',
  '未找到相关记录',
  '没有查到',
  '未查到匹配',
] as const

export const DB_REFUSAL_MARKERS = [
  '服务范围',
  '无法提供',
  '对不起',
  '抱歉',
  '不支持',
] as const

export function textIncludesAny(text: string, markers: readonly string[]): boolean {
  const s = String(text ?? '')
  if (!s) return false
  const lower = s.toLowerCase()
  return markers.some((m) => s.includes(m) || lower.includes(m.toLowerCase()))
}

/** 短答且像空结果/拒答（不含数字时） */
export function textLooksLikeDbEmptyOrRefusal(text: string): boolean {
  const s = String(text ?? '').trim()
  if (!s || s.length < 3) return true
  if (textIncludesAny(s, DB_EMPTY_ANSWER_MARKERS)) return true
  if (!/\d+/.test(s)) {
    if (textIncludesAny(s, DB_REFUSAL_MARKERS)) return true
    if (s.includes('助手') && (s.includes('我是') || s.includes('养老'))) return true
  }
  return false
}
