/** 从用户任务文本推断输出语言（planChart/report label 用） */

export type TaskLanguage = 'zh' | 'en' | 'mixed'

export function detectTaskLanguage(text: string): TaskLanguage {
  const s = String(text ?? '').trim()
  if (!s) return 'zh'
  const han = (s.match(/[\u4e00-\u9fff]/g) || []).length
  const latin = (s.match(/[A-Za-z]/g) || []).length
  if (han >= 4 && latin < han * 0.35) return 'zh'
  if (latin >= 8 && han < latin * 0.35) return 'en'
  if (han >= 2 && latin >= 6) return 'mixed'
  return han >= latin ? 'zh' : 'en'
}

export function chartPlanLanguageRule(question: string): string {
  const lang = detectTaskLanguage(question)
  if (lang === 'en') {
    return 'Output labels/panel titles in English matching the user task; do not use Chinese unless quoting source keys.'
  }
  if (lang === 'mixed') {
    return 'Match the user task language for labels; keep display_value units as in Code facts.'
  }
  return 'label/panel_title 使用与用户任务一致的中文；禁止展示 raw snake_case key。'
}

export function reportPlanLanguageRule(question: string): string {
  const lang = detectTaskLanguage(question)
  if (lang === 'en') {
    return 'Write executive_summary/claims in English; evidence_keys stay as Code fact keys.'
  }
  if (lang === 'mixed') {
    return 'Match user task language in narrative; evidence_keys unchanged.'
  }
  return '报告正文使用中文；evidence_keys 须与 Code facts.key 一致。'
}
