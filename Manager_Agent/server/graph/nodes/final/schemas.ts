import { z } from 'zod'

export const CriticVerdictSchema = z.object({
  pass: z.boolean(),
  severity: z.enum(['low', 'high']).default('low'),
  needsRetry: z.boolean().default(false),
  retryIntent: z.string().optional(),
  retryQuery: z.string().optional(),
  needsClarify: z.boolean().default(false),
  clarifyQuestions: z.array(z.string()).default([]),
  note: z.string().optional()
})

export type CriticVerdict = z.infer<typeof CriticVerdictSchema>
