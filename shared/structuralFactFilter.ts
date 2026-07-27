/** 机械性：库表/记录元数据列（非业务指标，适用于任意领域） */
export const STRUCTURAL_METADATA_MARKERS = [
  '创建',
  '修改',
  '时间',
  '日期',
  '编号',
  '是否',
  'creator',
  'modifier',
  'created',
  'updated',
  'timestamp',
  'userid',
  'user_id'
] as const

export function isStructuralMetadataFactKey(key: string): boolean {
  const k = String(key ?? '').trim()
  if (!k) return true
  const lower = k.toLowerCase()
  for (const m of STRUCTURAL_METADATA_MARKERS) {
    if (k.includes(m) || lower.includes(m.toLowerCase())) return true
  }
  return false
}

export function isAsciiOnlyShortKey(key: string): boolean {
  if (key.length > 3) return false
  for (const ch of key) {
    if (ch.codePointAt(0)! > 127) return false
  }
  return key.length > 0
}
