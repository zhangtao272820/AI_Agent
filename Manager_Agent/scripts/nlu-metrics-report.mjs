import fs from 'node:fs/promises'
import path from 'node:path'

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function toPercent(v) {
  if (!Number.isFinite(v)) return '0.00%'
  return `${(v * 100).toFixed(2)}%`
}

function getDateKey(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function initStat() {
  return {
    total: 0,
    clarify: 0,
    firstPass: 0,
    routeConfSum: 0,
    finalConfSum: 0,
    fallback: 0
  }
}

function appendStat(bucket, row) {
  bucket.total += 1
  if (row.needsClarify) bucket.clarify += 1
  if (row.firstPassSuccess) bucket.firstPass += 1
  if (Number.isFinite(Number(row.routeConfidence))) bucket.routeConfSum += Number(row.routeConfidence)
  if (Number.isFinite(Number(row.finalConfidence))) bucket.finalConfSum += Number(row.finalConfidence)
  if (Number(row.finalConfidence) + 1e-8 < Number(row.routeConfidence)) bucket.fallback += 1
}

function summarize(stat) {
  const total = Math.max(1, stat.total)
  return {
    total: stat.total,
    clarificationRate: stat.clarify / total,
    firstPassSuccessRate: stat.firstPass / total,
    fallbackRate: stat.fallback / total,
    avgRouteConfidence: stat.routeConfSum / total,
    avgFinalConfidence: stat.finalConfSum / total
  }
}

function ensureMapStat(map, key) {
  if (!map.has(key)) map.set(key, initStat())
  return map.get(key)
}

async function main() {
  const dataDir = path.join(process.cwd(), '.data')
  const inputFile = path.join(dataDir, 'manager-nlu-metrics.jsonl')
  const outDir = path.join(dataDir, 'manager-nlu-daily')
  const onlyToday = process.argv.includes('--today')
  const dateArg = process.argv.find((x) => x.startsWith('--date=')) || ''
  const targetDate = dateArg ? dateArg.slice('--date='.length).trim() : ''
  const today = new Date().toISOString().slice(0, 10)

  const raw = await fs.readFile(inputFile, 'utf8').catch(() => '')
  if (!raw.trim()) {
    console.log('No NLU metrics found. Please run manager requests first.')
    return
  }
  const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const rows = lines
    .map((line) => safeJsonParse(line))
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      ts: String(x.ts || ''),
      date: getDateKey(String(x.ts || '')),
      runId: String(x.runId || ''),
      intent: String(x.intent || ''),
      routeConfidence: Number(x.routeConfidence ?? 0),
      finalConfidence: Number(x.finalConfidence ?? 0),
      needsClarify: Boolean(x.needsClarify),
      firstPassSuccess: Boolean(x.firstPassSuccess)
    }))
    .filter((x) => x.date)

  let filtered = rows
  if (onlyToday) filtered = rows.filter((x) => x.date === today)
  if (targetDate) filtered = rows.filter((x) => x.date === targetDate)
  if (filtered.length === 0) {
    console.log(`No rows matched filter. today=${today} date=${targetDate || '(none)'}`)
    return
  }

  const overall = initStat()
  const daily = new Map()
  const byIntent = new Map()
  for (const row of filtered) {
    appendStat(overall, row)
    if (!daily.has(row.date)) daily.set(row.date, initStat())
    appendStat(daily.get(row.date), row)
    appendStat(ensureMapStat(byIntent, row.intent || 'unknown'), row)
  }

  const overallS = summarize(overall)
  console.log('NLU Metrics Summary')
  console.log(`- runs: ${overallS.total}`)
  console.log(`- clarification_rate: ${toPercent(overallS.clarificationRate)}`)
  console.log(`- first_pass_success_rate: ${toPercent(overallS.firstPassSuccessRate)}`)
  console.log(`- fallback_rate: ${toPercent(overallS.fallbackRate)}`)
  console.log(`- avg_route_confidence: ${overallS.avgRouteConfidence.toFixed(4)}`)
  console.log(`- avg_final_confidence: ${overallS.avgFinalConfidence.toFixed(4)}`)
  console.log('')
  console.log('Per-day')
  const perDayPayload = []
  const dayKeys = Array.from(daily.keys()).sort()
  for (const day of dayKeys) {
    const s = summarize(daily.get(day))
    perDayPayload.push({
      date: day,
      ...s
    })
    console.log(
      `${day} runs=${s.total} clarify=${toPercent(s.clarificationRate)} first_pass=${toPercent(
        s.firstPassSuccessRate
      )} fallback=${toPercent(s.fallbackRate)} route_conf=${s.avgRouteConfidence.toFixed(4)} final_conf=${s.avgFinalConfidence.toFixed(4)}`
    )
  }
  console.log('')
  console.log('Per-intent')
  const perIntentPayload = []
  const intentKeys = Array.from(byIntent.keys()).sort()
  for (const intent of intentKeys) {
    const s = summarize(byIntent.get(intent))
    perIntentPayload.push({
      intent,
      ...s
    })
    console.log(
      `${intent} runs=${s.total} clarify=${toPercent(s.clarificationRate)} first_pass=${toPercent(
        s.firstPassSuccessRate
      )} fallback=${toPercent(s.fallbackRate)} route_conf=${s.avgRouteConfidence.toFixed(4)} final_conf=${s.avgFinalConfidence.toFixed(4)}`
    )
  }

  await fs.mkdir(outDir, { recursive: true })
  for (const row of perDayPayload) {
    const outFile = path.join(outDir, `${row.date}.json`)
    await fs.writeFile(outFile, `${JSON.stringify(row, null, 2)}\n`, 'utf8')
  }
  const intentFileSuffix = onlyToday ? `intent-${today}` : targetDate ? `intent-${targetDate}` : 'intent-all'
  const intentOutFile = path.join(outDir, `${intentFileSuffix}.json`)
  await fs.writeFile(intentOutFile, `${JSON.stringify(perIntentPayload, null, 2)}\n`, 'utf8')
  console.log('')
  console.log(`Daily snapshots written to: ${outDir}`)
  console.log(`Intent snapshot written to: ${intentOutFile}`)
}

main().catch((e) => {
  console.error(`nlu-metrics-report failed: ${String(e?.message || e)}`)
  process.exit(1)
})
