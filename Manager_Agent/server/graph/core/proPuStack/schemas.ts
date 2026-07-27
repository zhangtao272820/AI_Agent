import { z } from 'zod'
import { resolveManagerEnvBool } from '../../../utils/platform/managerEnvModes'

export const PreservedConstraintsSchema = z.object({
  timeRange: z.string().max(120).optional(),
  dimensions: z.array(z.string()).max(6).optional(),
  metrics: z.array(z.string()).max(6).optional(),
  outputFormat: z.string().max(120).optional(),
  mustNot: z.array(z.string()).max(4).optional(),
  userExplicitPhrases: z.array(z.string()).max(6).optional()
})

export type PreservedConstraints = z.infer<typeof PreservedConstraintsSchema>

export const InferredDataSourceSchema = z.object({
  plane: z.enum(['db', 'rag', 'crawler', 'admin', 'gui', 'multimodal', 'music', 'video']),
  confidence: z.number().min(0).max(1),
  inferReason: z.string().max(240)
})

export type InferredDataSource = z.infer<typeof InferredDataSourceSchema>

export const StepDispatchDraftSchema = z.object({
  agent: z.string().min(1).max(32),
  scopedUserLanguage: z.string().min(2).max(480),
  clauseIds: z.array(z.string()).max(4).optional(),
  attachedConstraints: z.array(z.string()).max(8).optional()
})

export type StepDispatchDraft = z.infer<typeof StepDispatchDraftSchema>

export const TaskShapeSchema = z.object({
  taskShape: z
    .enum(['single_agent', 'linear_pipeline', 'multi_source_parallel', 'action_only'])
    .default('linear_pipeline'),
  planShortcut: z
    .enum(['none', 'db_only', 'rag_only', 'db_chart', 'admin_only', 'chitchat_only'])
    .default('none'),
  requiresAgentPipeline: z.boolean().default(true),
  wantsVisualize: z.boolean().default(false),
  wantsReport: z.boolean().default(false),
  wantsAdmin: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.65),
  rationale: z.string().max(320).default('')
})

export const DataPlaneSchema = z.object({
  inferredDataSources: z.array(InferredDataSourceSchema).max(5).default([]),
  preservedConstraints: PreservedConstraintsSchema.optional(),
  taskIntent: z
    .enum(['structured_query', 'document_retrieval', 'hybrid', 'action', 'unknown'])
    .default('unknown'),
  primaryPlane: z.enum(['db', 'rag', 'crawler', 'admin', 'gui', 'none']).default('none'),
  hasExplicitSubject: z.boolean().default(false),
  clarifyRisk: z.enum(['none', 'low', 'medium', 'high']).default('low'),
  confidence: z.number().min(0).max(1).default(0.65),
  rationale: z.string().max(320).default('')
})

export const ActionPlaneSchema = z.object({
  actionClauses: z
    .array(
      z.object({
        kind: z.enum(['admin', 'gui', 'none']).default('none'),
        scopedText: z.string().max(480),
        confidence: z.number().min(0).max(1).default(0.6)
      })
    )
    .max(4)
    .default([]),
  stepDispatchDraft: z.array(StepDispatchDraftSchema).max(12).optional(),
  confidence: z.number().min(0).max(1).default(0.65)
})

export const AmbiguitySchema = z.object({
  policy: z.enum(['clarify', 'infer_with_defaults', 'proceed']).default('proceed'),
  needsClarify: z.boolean().default(false),
  clarifyQuestions: z.array(z.string()).max(4).default([]),
  defaultAssumptions: z.array(z.string()).max(4).default([]),
  confidence: z.number().min(0).max(1).default(0.65)
})

export const ProPuStackUnifiedSchema = z.object({
  taskShape: z
    .enum(['single_agent', 'linear_pipeline', 'multi_source_parallel', 'action_only'])
    .default('linear_pipeline'),
  requiresAgentPipeline: z.boolean().default(true),
  wantsVisualize: z.boolean().default(false),
  wantsReport: z.boolean().default(false),
  wantsAdmin: z.boolean().default(false),
  inferredDataSources: z.array(InferredDataSourceSchema).max(6).default([]),
  taskIntent: z
    .enum(['structured_query', 'document_retrieval', 'hybrid', 'action', 'unknown'])
    .default('unknown'),
  primaryPlane: z.enum(['db', 'rag', 'crawler', 'admin', 'gui', 'none']).default('none'),
  hasExplicitSubject: z.boolean().default(false),
  clarifyRisk: z.enum(['none', 'low', 'medium', 'high']).default('low'),
  preservedConstraints: PreservedConstraintsSchema.optional(),
  stepDispatchDraft: z.array(StepDispatchDraftSchema).min(1).max(12),
  confidence: z.number().min(0).max(1).default(0.72),
  rationale: z.string().max(400).default('')
})

export function isProUnifiedPuStackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveManagerEnvBool('MANAGER_PRO_UNIFIED', env)
}
