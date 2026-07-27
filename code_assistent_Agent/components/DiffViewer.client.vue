<template>
  <div class="wrap">
    <div class="head">
      <div class="mono">{{ path || 'diff' }}</div>
      <div class="meta">{{ changedLines }} 行变更</div>
    </div>
    <div class="box">
      <div
        v-for="(line, idx) in diffLines"
        :key="idx"
        class="line"
        :class="cls(line)"
      >
        <code>{{ line }}</code>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ oldText: string; newText: string; path?: string }>()

type DiffOp = { type: 'equal' | 'insert' | 'delete'; line: string }

function myersDiff(a: string[], b: string[]) {
  const n = a.length
  const m = b.length
  const max = n + m
  const offset = max
  let v = new Array<number>(2 * max + 1).fill(0)
  const trace: number[][] = []

  for (let d = 0; d <= max; d++) {
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      const idx = k + offset
      let x: number
      const left = v[idx - 1] ?? 0
      const right = v[idx + 1] ?? 0
      if (k === -d || (k !== d && left < right)) {
        x = right
      } else {
        x = left + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next[idx] = x
      if (x >= n && y >= m) {
        trace.push(next)
        const ops: DiffOp[] = []
        let curX = n
        let curY = m
        for (let curD = trace.length - 1; curD > 0; curD--) {
          const vPrev = trace[curD - 1]!
          const kCur = curX - curY
          let prevK: number
          if (
            kCur === -curD ||
            (kCur !== curD &&
              (vPrev[kCur - 1 + offset] ?? 0) < (vPrev[kCur + 1 + offset] ?? 0))
          ) {
            prevK = kCur + 1
          } else {
            prevK = kCur - 1
          }
          const prevX = vPrev[prevK + offset]!
          const prevY = prevX - prevK

          while (curX > prevX && curY > prevY) {
            ops.push({ type: 'equal', line: a[curX - 1]! })
            curX--
            curY--
          }
          if (curX === prevX) {
            ops.push({ type: 'insert', line: b[curY - 1]! })
            curY--
          } else {
            ops.push({ type: 'delete', line: a[curX - 1]! })
            curX--
          }
          curX = prevX
          curY = prevY
        }

        while (curX > 0 && curY > 0) {
          ops.push({ type: 'equal', line: a[curX - 1]! })
          curX--
          curY--
        }
        while (curX > 0) {
          ops.push({ type: 'delete', line: a[curX - 1]! })
          curX--
        }
        while (curY > 0) {
          ops.push({ type: 'insert', line: b[curY - 1]! })
          curY--
        }

        ops.reverse()
        return ops
      }
    }
    trace.push(next)
    v = next
  }
  return [] as DiffOp[]
}

function unifiedDiff(path: string, oldText: string, newText: string) {
  const oldLines = oldText.split(/\r?\n/)
  const newLines = newText.split(/\r?\n/)
  const ops = myersDiff(oldLines, newLines)
  const lines: string[] = []
  lines.push(`--- a/${path}`)
  lines.push(`+++ b/${path}`)
  for (const op of ops) {
    if (op.type === 'equal') lines.push(` ${op.line}`)
    if (op.type === 'delete') lines.push(`-${op.line}`)
    if (op.type === 'insert') lines.push(`+${op.line}`)
  }
  return lines
}

const diffLines = computed(() => unifiedDiff(props.path || 'file', props.oldText || '', props.newText || ''))
const changedLines = computed(() => diffLines.value.filter((l) => l.startsWith('+') || l.startsWith('-')).length)

function cls(line: string) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}
</script>

<style scoped>
.wrap {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 10px;
  height: 100%;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.meta {
  font-size: 12px;
  opacity: 0.8;
}
.box {
  overflow: auto;
  border: 1px solid rgba(244, 246, 255, 0.12);
  border-radius: 14px;
  background: transparent;
}
.line {
  padding: 4px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  white-space: pre;
}
.line.meta {
  opacity: 0.8;
  background: rgba(255, 255, 255, 0.04);
}
.line.add {
  background: rgba(106, 255, 190, 0.10);
}
.line.del {
  background: rgba(255, 124, 164, 0.10);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>

