<template>
  <div v-if="visible" class="insight">
    <div class="insight-h">运行洞察</div>
    <div class="insight-grid">
      <div class="insight-card">
        <div class="k">任务理解</div>
        <div v-if="taskKind" class="v">task_kind · {{ taskKind }}</div>
        <div v-else class="v muted">等待 meta…</div>
        <div v-if="abVariant" class="v small muted">A/B {{ abVariant }}</div>
      </div>
      <div class="insight-card">
        <div class="k">Agent 模式</div>
        <div class="v">{{ agentModeLabel }}</div>
        <div class="v small muted">{{ agentModeHint }}</div>
      </div>
      <div class="insight-card">
        <div class="k">工具链</div>
        <div v-if="toolNames.length" class="chain">
          <span
            v-for="(t, i) in toolNames"
            :key="`${t}-${i}`"
            class="chip"
            :class="{ err: erroredTools.has(t) }"
          >{{ t }}</span>
        </div>
        <div v-else class="v muted">等待工具调用…</div>
        <div v-if="phase" class="v small">阶段 · {{ phase }}</div>
      </div>
      <div class="insight-card">
        <div class="k">改动审阅</div>
        <div v-if="pendingFiles.length" class="v ok">
          {{ pendingFiles.length }} 个文件待确认
        </div>
        <div v-else class="v muted">无 pending diff</div>
        <div v-if="pendingBranch" class="v small mono">{{ pendingBranch }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type InsightTool = {
  kind: 'start' | 'end' | 'phase'
  tool?: string
  phase?: string
  status?: string
}

const props = defineProps<{
  taskKind?: string
  abVariant?: string
  agentMode?: 'ask' | 'edit' | 'agent'
  tools?: InsightTool[]
  pendingFiles?: string[]
  pendingBranch?: string
  active?: boolean
}>()

const visible = computed(
  () =>
    Boolean(
      props.active ||
        props.taskKind ||
        props.tools?.length ||
        props.pendingFiles?.length,
    ),
)

const agentModeLabel = computed(() => {
  if (props.agentMode === 'ask') return 'Ask'
  if (props.agentMode === 'edit') return 'Edit'
  return 'Agent'
})

const agentModeHint = computed(() => {
  if (props.agentMode === 'ask') return '只读 inspect'
  if (props.agentMode === 'edit') return '改码 + validate'
  return '多步自动（understand 定路径）'
})

const toolNames = computed(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of props.tools || []) {
    const name = String(t.tool || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out.slice(-8)
})

const erroredTools = computed(() => {
  const bad = new Set<string>()
  for (const t of props.tools || []) {
    if (t.kind === 'end' && t.status === 'error' && t.tool) bad.add(t.tool)
  }
  return bad
})

const phase = computed(() => {
  const list = props.tools || []
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.kind === 'phase' && list[i]?.phase) return String(list[i]!.phase)
  }
  return ''
})

const pendingFiles = computed(() => props.pendingFiles || [])
const pendingBranch = computed(() => props.pendingBranch || '')
</script>

<style scoped>
.insight {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(20, 28, 48, 0.55);
  border: 1px solid rgba(164, 179, 255, 0.22);
}
.insight-h {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.72;
  margin-bottom: 8px;
}
.insight-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (min-width: 1100px) {
  .insight-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.insight-card {
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(244, 246, 255, 0.04);
  border: 1px solid rgba(244, 246, 255, 0.08);
  min-height: 64px;
}
.k {
  font-size: 11px;
  opacity: 0.65;
  margin-bottom: 4px;
}
.v {
  font-size: 12px;
  line-height: 1.35;
  color: rgba(244, 246, 255, 0.92);
}
.v.muted {
  opacity: 0.55;
}
.v.small {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.75;
}
.v.ok {
  color: #9dffb0;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}
.chain {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(164, 179, 255, 0.16);
  border: 1px solid rgba(164, 179, 255, 0.28);
}
.chip.err {
  background: rgba(255, 120, 120, 0.16);
  border-color: rgba(255, 120, 120, 0.35);
}
</style>
