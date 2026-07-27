/**
 * Code Agent 澄清：缺槽检测 + 快捷 chips（对标 DB clarification_hints）。
 */
import type { CodeTaskKind } from './code_learning'

export type CodeClarifySlot = 'file_path' | 'edit_scope' | 'task_scope' | 'compute_input'

export type CodeClarifyResult = {
  needsClarify: boolean
  questions: string[]
  chips: string[]
  missingSlots: CodeClarifySlot[]
}

const FILE_CHIPS = ['server/services/agent.ts', 'server/utils/', 'nuxt.config.ts', 'package.json']
const EDIT_CHIPS = ['只读分析不改文件', '生成 diff 预览', '修复类型错误', '补充单元测试']
const SCOPE_CHIPS = ['定位实现位置', '解释代码逻辑', '审查潜在 bug', '生成重构建议']
const COMPUTE_CHIPS = ['输出 JSON', '输出 Markdown 表格', '只给最终数值', '列出关键步骤摘要']

function looksLikeHasPath(message: string) {
  return /([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(message)
}

/** 单仓/monorepo 目录名（如 RAG_Agent、server/utils/）也算有效作用域 */
function looksLikeRepoScope(message: string) {
  if (looksLikeHasPath(message)) return true
  if (/\b[\w-]+_Agent\b/.test(message)) return true
  if (/\b(?:server|shared|utils|app|components)\/[\w.-]+/.test(message)) return true
  return false
}

export function buildClarificationChips(slots: CodeClarifySlot[]): string[] {
  const out: string[] = []
  if (slots.includes('file_path')) out.push(...FILE_CHIPS.slice(0, 3))
  if (slots.includes('edit_scope')) out.push(...EDIT_CHIPS.slice(0, 3))
  if (slots.includes('task_scope')) out.push(...SCOPE_CHIPS.slice(0, 3))
  if (slots.includes('compute_input')) out.push(...COMPUTE_CHIPS.slice(0, 3))
  const seen = new Set<string>()
  return out.filter((x) => {
    if (seen.has(x)) return false
    seen.add(x)
    return true
  }).slice(0, 6)
}

export function detectCodeClarification(input: {
  question: string
  taskKind: CodeTaskKind | 'full'
  hintFiles?: string[]
  upstreamContext?: string
  fromManager?: boolean
  writeAllowed?: boolean
}): CodeClarifyResult {
  const q = String(input.question ?? '').trim()
  const empty: CodeClarifyResult = { needsClarify: false, questions: [], chips: [], missingSlots: [] }
  if (!q || q.length >= 200) return empty

  const hasPath = looksLikeRepoScope(q)
  const hasHints = Boolean(input.hintFiles?.length)
  const hasUpstream = Boolean(String(input.upstreamContext ?? '').trim())
  const slots: CodeClarifySlot[] = []
  const questions: string[] = []

  // 总管已编排 task_kind：工程任务直接进执行链，由仓库检索定位文件（对标 compute 免澄清）
  if (
    input.fromManager &&
    (input.taskKind === 'edit' || input.taskKind === 'script' || input.taskKind === 'inspect')
  ) {
    return empty
  }

  if (input.taskKind === 'compute') {
    if (input.fromManager) return empty
    if (q.length < 8 && !hasUpstream) {
      slots.push('compute_input')
      questions.push('请说明要对哪些数据做计算或整理？')
    }
  }

  if (input.taskKind === 'edit' || input.writeAllowed) {
    if (!hasPath && !hasHints) {
      slots.push('file_path', 'edit_scope')
      questions.push('要修改哪个文件或目录？期望的改动范围是什么？')
    } else if (input.writeAllowed && q.length < 16) {
      slots.push('edit_scope')
      questions.push('请说明期望的修改方式：仅分析、生成 diff，还是直接改文件？')
    }
  }

  if (input.taskKind === 'inspect' || input.taskKind === 'full') {
    if (!hasPath && !hasHints && q.length < 12) {
      slots.push('task_scope', 'file_path')
      questions.push('请补充目标文件/模块，或说明要定位哪类代码问题？')
    }
  }

  if (!slots.length) return empty

  return {
    needsClarify: true,
    questions: questions.slice(0, 3),
    chips: buildClarificationChips(slots),
    missingSlots: slots,
  }
}

export function mergeClarificationChip(baseQuestion: string, chip: string): string {
  const base = String(baseQuestion ?? '').trim()
  const pick = String(chip ?? '').trim()
  if (!pick) return base
  if (!base) return pick
  if (/\.ts|\.vue|\.js|server\//.test(pick)) return `${base}，目标文件：${pick}`
  return `${base}，${pick}`
}
