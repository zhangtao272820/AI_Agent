<template>
  <div v-if="visible" class="insight">
    <div class="insight-h">运行洞察</div>
    <div class="insight-grid">
      <div class="insight-card">
        <div class="k">任务理解</div>
        <div v-if="taskKind" class="v">kind: {{ taskKind }} · engine: {{ engineHint || '-' }}</div>
        <div v-if="confidence != null" class="v muted">conf {{ confidence.toFixed(2) }} · {{ source || '-' }}</div>
        <div v-if="rationale" class="v small">{{ rationale }}</div>
        <div v-else class="v muted">等待 understand…</div>
      </div>
      <div class="insight-card">
        <div class="k">引擎链</div>
        <div v-if="chain.length" class="chain">
          <span
            v-for="(e, i) in chain"
            :key="`${e}-${i}`"
            class="chip"
            :class="chainChipClass(i, e)"
          >{{ e }}</span>
        </div>
        <div v-else class="v muted">等待 engine_chain…</div>
        <div v-if="actualEngine || activeEngine" class="v small">
          实跑: {{ actualEngine || activeEngine }}
        </div>
      </div>
      <div class="insight-card">
        <div class="k">Profile</div>
        <div class="v">{{ profileLabel || browserProfile || '-' }}</div>
        <div v-if="storageProfile" class="v small">storage: {{ storageProfile }}</div>
        <div v-if="sidecarNote" class="v small muted">{{ sidecarNote }}</div>
      </div>
      <div class="insight-card">
        <div class="k">Verify</div>
        <div v-if="verify" class="v" :class="verify.ok ? 'ok' : 'bad'">
          {{ verify.ok ? '通过' : '未通过' }} · {{ verify.reason }}
          <span v-if="verify.failureType">（{{ verify.failureType }}）</span>
        </div>
        <div v-else class="v muted">等待 verify…</div>
        <div v-if="verify?.hints?.length" class="v small">{{ verify.hints[0] }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type VerifyRow = {
  ok: boolean
  reason: string
  failureType?: string
  hints?: string[]
  retryable?: boolean
}

const props = defineProps<{
  understand?: Record<string, unknown> | null
  engineChain?: Record<string, unknown> | null
  engineActive?: Record<string, unknown> | null
  verifyRow?: Record<string, unknown> | null
  runMeta?: Record<string, unknown> | null
}>()

const visible = computed(
  () =>
    Boolean(props.understand || props.engineChain || props.verifyRow || props.runMeta),
)

const taskSpec = computed(() => {
  const u = props.understand
  const spec = u?.taskSpec
  return spec && typeof spec === 'object' ? (spec as Record<string, unknown>) : null
})

const taskKind = computed(() => String(taskSpec.value?.task_kind || '').trim() || '')
const engineHint = computed(() => String(taskSpec.value?.engine_hint || '').trim() || '')
const rationale = computed(() => String(taskSpec.value?.rationale || '').trim() || '')
const confidence = computed(() => {
  const n = Number(taskSpec.value?.confidence ?? props.understand?.picked && (props.understand!.picked as any).confidence)
  return Number.isFinite(n) ? n : null
})
const source = computed(() => {
  const p = props.understand?.picked
  return p && typeof p === 'object' ? String((p as any).source || '') : ''
})

const chain = computed(() => {
  const c = props.engineChain?.chain
  return Array.isArray(c) ? c.map((x) => String(x)) : []
})
const activeIndex = computed(() => {
  const i = props.engineActive?.attemptIndex ?? props.engineChain?.activeIndex
  return Number.isFinite(Number(i)) ? Number(i) : -1
})
const activeEngine = computed(() => String(props.engineActive?.engine || '').trim() || '')
const actualEngine = computed(
  () =>
    String(props.engineActive?.actualEngine || props.runMeta?.actualEngine || props.engineActive?.engine || '').trim() ||
    '',
)
const profileLabel = computed(() =>
  String(props.runMeta?.profile || props.engineChain?.profile || props.understand?.profile || '').trim(),
)
const browserProfile = computed(() => String(props.runMeta?.browserProfile || '').trim() || '')
const storageProfile = computed(() =>
  String(props.runMeta?.storageProfile || props.understand?.storageProfile || '').trim() || '',
)
const sidecarNote = computed(() => String(props.engineChain?.sidecarNote || '').trim() || '')

const verify = computed((): VerifyRow | null => {
  const v = props.verifyRow?.verify
  if (!v || typeof v !== 'object') return null
  const row = v as Record<string, unknown>
  return {
    ok: row.ok !== false,
    reason: String(row.reason || ''),
    failureType: String(row.failureType || '').trim() || undefined,
    hints: Array.isArray(row.hints) ? row.hints.map((h) => String(h)) : undefined,
    retryable: row.retryable === true,
  }
})

function chainChipClass(i: number, engine: string) {
  if (activeEngine.value && engine === activeEngine.value) return 'active'
  if (activeIndex.value >= 0 && i < activeIndex.value) return 'done'
  if (activeIndex.value >= 0 && i === activeIndex.value) return 'active'
  return ''
}
</script>

<style scoped>
.insight {
  margin: 14px 0;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(12, 22, 42, 0.48);
  border: 1px solid rgba(168, 206, 255, 0.22);
  backdrop-filter: blur(16px) saturate(1.15);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.22);
}
.insight-h {
  font-size: 13px;
  font-weight: 650;
  margin-bottom: 12px;
  letter-spacing: 0.2px;
  color: rgba(230, 240, 255, 0.92);
}
.insight-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (min-width: 900px) {
  .insight-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
.insight-card {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(168, 206, 255, 0.1);
  min-height: 78px;
}
.k {
  font-size: 11px;
  color: rgba(180, 200, 225, 0.65);
  margin-bottom: 6px;
  font-weight: 600;
}
.v {
  font-size: 12px;
  line-height: 1.45;
  word-break: break-word;
  color: rgba(236, 244, 255, 0.94);
}
.v.small {
  font-size: 11px;
  color: rgba(200, 218, 240, 0.8);
  margin-top: 4px;
}
.v.muted {
  color: rgba(168, 190, 218, 0.55);
}
.v.ok {
  color: #7dcea0;
}
.v.bad {
  color: #f1948a;
}
.chain {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(220, 236, 255, 0.9);
}
.chip.active {
  background: rgba(93, 173, 226, 0.28);
  border-color: rgba(93, 173, 226, 0.55);
}
.chip.done {
  opacity: 0.55;
}
</style>
