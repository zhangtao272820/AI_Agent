import path from 'node:path'
import { buildEvolutionExperimentDashboard, loadExperiments, loadHypotheses } from '../../graph/core/evolution/evolutionExperiments'

export default defineEventHandler(async () => {
  const policyDir = path.join(process.cwd(), '.data')
  const [dashboard, hypotheses, experiments] = await Promise.all([
    buildEvolutionExperimentDashboard(policyDir),
    loadHypotheses(policyDir),
    loadExperiments(policyDir)
  ])
  return { ok: true, dashboard, hypotheses, experiments }
})
