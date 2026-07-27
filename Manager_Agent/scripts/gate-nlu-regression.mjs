/**
 * Phase 3 门禁：对比 manager-nlu-metrics.jsonl 最近两段窗口的 avg(finalConfidence)，跌幅过大则 exit 1。
 * 用法：node scripts/gate-nlu-regression.mjs [--window=40] [--max-drop=0.08]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const metPath = path.join(root, '.data', 'manager-nlu-metrics.jsonl')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    return m ? [m[1], m[2]] : [a, true]
  })
)
const windowSize = Math.max(10, Math.min(120, Number(args.window) || 40))
const maxDrop = Math.max(0.02, Math.min(0.25, Number(args['max-drop']) || 0.08))

const raw = await fs.readFile(metPath, 'utf8').catch(() => '')
if (!raw.trim()) {
  console.log('gate-nlu-regression: skip (no metrics file)', metPath)
  process.exit(0)
}
const lines = raw.split('\n').filter((l) => l.trim())
if (lines.length < windowSize * 2) {
  console.log('gate-nlu-regression: skip (not enough history)', lines.length, '<', windowSize * 2)
  process.exit(0)
}

const parseLine = (line) => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

const tail = lines.slice(-windowSize * 2).map(parseLine).filter(Boolean)
const prev = tail.slice(0, windowSize)
const cur = tail.slice(windowSize)

const avg = (rows) => {
  const xs = rows.map((r) => Number(r.finalConfidence)).filter((x) => Number.isFinite(x))
  if (!xs.length) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

const a0 = avg(prev)
const a1 = avg(cur)
if (a0 == null || a1 == null) {
  console.error('gate-nlu-regression: could not compute averages')
  process.exit(1)
}
const drop = a0 - a1
console.log('gate-nlu-regression:', { windowSize, avgPrev: a0.toFixed(3), avgCur: a1.toFixed(3), drop: drop.toFixed(3), maxDrop })
if (drop > maxDrop) {
  console.error('FAIL: finalConfidence regression exceeds threshold')
  process.exit(1)
}
process.exit(0)
