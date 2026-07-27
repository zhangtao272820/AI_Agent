/** 跨 Agent 复用的文本 marker（includes 匹配，非业务正则分类） */

export function textIncludesAny(text: string, markers: readonly string[]): boolean {
  const s = String(text ?? '')
  if (!s) return false
  const lower = s.toLowerCase()
  return markers.some((m) => s.includes(m) || lower.includes(m.toLowerCase()))
}

export const AGENT_ERROR_MARKERS = [
  'error',
  '失败',
  '异常',
  '超时',
  'timeout',
  '拒绝',
  'denied',
] as const

export const PLAN_FAILURE_MARKERS = ['失败', '异常', '不完整'] as const

export const ADMIN_CONFIRM_MARKERS = [
  '等待确认',
  '待确认操作',
  '确认继续',
  '请回复“确认”',
  '请回复"确认"',
] as const

export const MULTI_COMPARE_MARKERS = ['多方案', '对比方案', '两种方案', 'A/B', 'ab测试'] as const

export const HEAVY_TASK_MARKERS = [
  '分别',
  '对比',
  '同时',
  '并且',
  '以及',
  '汇总后',
  '生成报告',
  '生成图表',
  '联网',
  '搜索',
  '爬取',
  '登录',
  '填表',
] as const

/** 用户明确要求叙述性报告（结论/注意事项/对照），不宜用 facts 表直通 */
export const NARRATIVE_REPORT_MARKERS = [
  '报告',
  '结论',
  '注意事项',
  '对照',
  '参考区间',
  '指南',
  '分析',
  '汇总',
  '评估',
  '解读',
] as const

export const ADMIN_WRITE_ACTION_MARKERS = [
  '创建',
  '新建',
  '添加',
  '删除',
  '移除',
  '发送',
  '发邮件',
  '写邮件',
  '安排',
  '预约',
  '设置',
  '修改',
  '更新',
] as const

export const ADMIN_WRITE_TARGET_MARKERS = ['待办', '提醒', '日程', '会议', '邮件'] as const

export const MEDIA_MISSING_MARKERS = [
  '缺少',
  '未提供',
  '无法',
  '没有',
  '无',
] as const

export const MEDIA_MISSING_SUBJECTS = ['图', '图像', '照片', '附件', '文件', '图片'] as const

export const PROMPT_INJECTION_MARKERS = [
  'ignore previous instructions',
  'system prompt',
  'you are chatgpt',
  '请忽略',
  '开发者消息',
  '系统消息',
  'system message',
] as const

export function looksLikeAgentError(text: string): boolean {
  return textIncludesAny(text, AGENT_ERROR_MARKERS)
}

export function looksLikeAdminConfirmMessage(text: string): boolean {
  return textIncludesAny(text, ADMIN_CONFIRM_MARKERS)
}

export function looksLikeMultiCompareRequest(text: string): boolean {
  return textIncludesAny(text, MULTI_COMPARE_MARKERS)
}

export function looksLikeNarrativeReportRequest(text: string): boolean {
  return textIncludesAny(text, NARRATIVE_REPORT_MARKERS)
}

export function looksLikeHeavyTaskText(text: string): boolean {
  const q = String(text ?? '').trim()
  if (q.length > 320) return true
  if (textIncludesAny(q, HEAVY_TASK_MARKERS)) return true
  if (q.includes('再') && (q.includes('再') || q.includes('然后'))) {
    const first = q.indexOf('再')
    const second = q.indexOf('再', first + 1)
    if (second > first) return true
  }
  return q.toLowerCase().includes('multi')
}

export function looksLikeRiskyAdminWrite(text: string): boolean {
  const t = String(text ?? '')
  const hasAction = textIncludesAny(t, ADMIN_WRITE_ACTION_MARKERS)
  const hasTarget = textIncludesAny(t, ADMIN_WRITE_TARGET_MARKERS)
  return hasAction && hasTarget
}

export function looksLikeFinalTextClaimsMissingMedia(text: string): boolean {
  const s = String(text ?? '')
  if (!textIncludesAny(s, MEDIA_MISSING_MARKERS)) return false
  return ['图', '图片', '附件', '文件'].some((sub) => s.includes(sub))
}

export function looksLikeSynthRejectingMedia(synth: string, multimodalOut: string): boolean {
  const mm = String(multimodalOut || '').trim()
  if (!mm || mm.length < 16) return false
  const s = String(synth || '').trim()
  if (!s) return true
  if (!textIncludesAny(s, MEDIA_MISSING_MARKERS)) return false
  return MEDIA_MISSING_SUBJECTS.some((sub) => s.includes(sub))
}

export function looksLikePromptInjectionLine(line: string): boolean {
  const t = line.trim().toLowerCase()
  return PROMPT_INJECTION_MARKERS.some((m) => t.includes(m.toLowerCase()))
}

export function textHasHttpUrl(text: string): boolean {
  const t = String(text ?? '')
  return t.includes('http://') || t.includes('https://')
}

export function textHasDigits(text: string): boolean {
  for (const ch of String(text ?? '')) {
    if (ch >= '0' && ch <= '9') return true
  }
  return false
}
