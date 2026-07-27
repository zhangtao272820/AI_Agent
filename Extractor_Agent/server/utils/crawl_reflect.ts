/**
 * 采集失败反思：空结果/质量门禁失败时生成纠正要点，写入影子 prompt。
 */
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import type { ChatOpenAI } from '@langchain/openai'
import { appendPromptPatch } from './prompt_evolution'
import { getExtractorAgentEnv } from './extractor_agent_env'
import type { CrawlFailureTag } from './crawl_failure_tags'

function clipText(s: string, max: number) {
  const t = String(s ?? '').trim()
  return t.length > max ? t.slice(0, max) : t
}

export function shouldReflectOnRun(result: any): boolean {
  if (!getExtractorAgentEnv().enableFailureReflect) return false
  const status = String(result?.status ?? '')
  if (status === 'needs_clarification') return false
  const items = Array.isArray(result?.items) ? result.items : []
  if (items.length === 0) return true
  if (!result?.quality?.passed) return true
  if (status === 'partial_ok') return true
  return false
}

export async function reflectOnCrawlFailure(
  model: ChatOpenAI,
  input: {
    task: string
    target_site?: string
    content_type?: string
    channel?: string
    failure_tags?: CrawlFailureTag[]
    quality_warnings?: string[]
  },
): Promise<string> {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      '你是网页采集失败分析器。根据任务、站点、通道与失败标签，输出**一条**中文纠正要点（不超过 80 字），供下次类似采集改进计划或抽取策略。不要输出代码；聚焦：种子 URL、通道选择、字段定义、反爬应对。',
    ],
    [
      'human',
      `任务：{task}
站点：{site}
类型：{content_type}
主通道：{channel}
失败标签：{tags}
质量警告：{warnings}

只输出一条纠正要点：`,
    ],
  ])
  try {
    const raw = await RunnableSequence.from([prompt, model, new StringOutputParser()]).invoke({
      task: clipText(input.task, 200),
      site: String(input.target_site ?? 'generic'),
      content_type: String(input.content_type ?? 'generic'),
      channel: String(input.channel ?? 'unknown'),
      tags: (input.failure_tags ?? []).join('、') || 'unknown',
      warnings: (input.quality_warnings ?? []).slice(0, 3).join('；') || '无',
    })
    const hint = clipText(String(raw ?? '').trim(), 120)
    if (!hint) return ''
    const tags = input.failure_tags ?? []
    const stage =
      tags.some((t) => t === 'empty_dom' || t === 'low_count') ? 'slot' : tags.length ? 'extract' : 'plan'
    appendPromptPatch({ stage, text: hint, source: 'reflection' })
    return hint
  } catch {
    return ''
  }
}

export async function maybeReflectAfterRun(model: ChatOpenAI | null, task: string, result: any): Promise<string> {
  if (!model || !shouldReflectOnRun(result)) return ''
  const tp = result?.taskPlan ?? {}
  const tags = Array.isArray(result?.meta?.failure_tags) ? result.meta.failure_tags : []
  const warnings = Array.isArray(result?.quality?.warnings) ? result.quality.warnings : []
  return reflectOnCrawlFailure(model, {
    task,
    target_site: tp.targetSite,
    content_type: tp.contentType,
    channel: result?.meta?.primary_channel,
    failure_tags: tags,
    quality_warnings: warnings,
  })
}
