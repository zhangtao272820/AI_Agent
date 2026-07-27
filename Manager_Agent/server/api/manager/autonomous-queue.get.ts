import path from 'node:path'
import { buildAutonomousQueueDashboard } from '../../graph/core/task/autonomousQueue'

export default defineEventHandler(async () => {
  const policyDir = path.join(process.cwd(), '.data')
  const dashboard = await buildAutonomousQueueDashboard(policyDir)
  return { ok: true, ...dashboard }
})
