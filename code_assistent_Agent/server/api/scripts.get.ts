import { getQuery } from 'h3'
import { listPackageScripts } from '../utils/packageScripts'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const root = q.root ? String(q.root) : undefined
  const entries = await listPackageScripts(root)
  return {
    scripts: entries.map((e) => e.name),
    entries,
  }
})
