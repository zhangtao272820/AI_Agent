import { restoreAgentEditedFiles } from '../utils/codeGitWorktree'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const paths = Array.isArray(body?.paths) ? body.paths.map(String) : []
  const root = body?.root ? String(body.root) : undefined
  if (!paths.length) {
    throw createError({ statusCode: 400, statusMessage: 'paths required' })
  }
  const result = await restoreAgentEditedFiles({ paths, root })
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: result.error || 'restore failed' })
  }
  return result
})
