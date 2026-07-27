import { z } from 'zod'

export const CodeTaskUnderstandSchema = z.object({
  task_kind: z.enum(['compute', 'inspect', 'edit', 'script']),
  refined_question: z.string().min(4).max(480),
  hint_files: z.array(z.string().max(260)).max(8).default([]),
  hint_symbols: z.array(z.string().max(120)).max(8).default([]),
  completion_criteria: z.array(z.string().max(120)).max(6).default([]),
  write_allowed: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.7),
  rationale: z.string().max(320).default(''),
})

export type CodeTaskUnderstandParsed = z.infer<typeof CodeTaskUnderstandSchema>

export function isCodeTaskUnderstandEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.CODE_TASK_UNDERSTAND ?? '1').trim() !== '0'
}
