import { defineEventHandler, readBody, createError } from 'h3'
import * as z from 'zod'
import path from 'node:path'
import { OpenAIEmbeddings } from '@langchain/openai'
import { runVectorSearch } from '../services/vectorSearch'
import { mergeOpenAiRuntimeSecrets } from '../utils/runtime_secrets'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const parsed = z
    .object({
      query: z.string().min(1),
      root: z.string().optional(),
      extensions: z.array(z.string()).nullable().optional(),
      maxFiles: z.number().int().min(1).max(2000).default(800),
      maxCandidates: z.number().int().min(1).max(200).default(60),
      maxResults: z.number().int().min(1).max(50).default(10),
      maxCharsPerFile: z.number().int().min(1000).max(400000).default(120000),
      maxChunksPerFile: z.number().int().min(1).max(80).default(18),
      overlapLines: z.number().int().min(0).max(50).default(8),
      chunkChars: z.number().int().min(500).max(20000).default(2400),
      maxSnippetChars: z.number().int().min(200).max(20000).default(4000),
      maxPreviewChars: z.number().int().min(80).max(500).default(220),
      refreshCache: z.boolean().default(false)
    })
    .safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body' })
  }
  const data = parsed.data

  const runtime = mergeOpenAiRuntimeSecrets(useRuntimeConfig() as any)
  const apiKey = runtime.openaiApiKey as string | undefined
  const baseURL = runtime.openaiBaseUrl as string | undefined
  const embeddingModel =
    typeof runtime.openaiEmbeddingModel === 'string' && runtime.openaiEmbeddingModel
      ? String(runtime.openaiEmbeddingModel)
      : 'text-embedding-v1'
  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: 'Missing OPENAI_API_KEY' })
  }

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    model: embeddingModel,
    configuration: baseURL ? { baseURL } : undefined
  } as any)

  const rootOverride = data.root ? path.resolve(data.root) : undefined
  return await runVectorSearch({
    embeddings,
    embeddingModel,
    query: data.query,
    rootOverride,
    extensions: data.extensions ?? null,
    maxFiles: data.maxFiles,
    maxCandidates: data.maxCandidates,
    maxResults: data.maxResults,
    maxCharsPerFile: data.maxCharsPerFile,
    maxChunksPerFile: data.maxChunksPerFile,
    overlapLines: data.overlapLines,
    chunkChars: data.chunkChars,
    maxSnippetChars: data.maxSnippetChars,
    maxPreviewChars: data.maxPreviewChars,
    refreshCache: data.refreshCache
  })
})
