<template>
  <div class="cosmic-midi">
    <div class="cosmic-midi-head">
      <span class="cosmic-midi-label">{{ label }}</span>
      <button type="button" class="midi-btn alt" :disabled="downloading" @click="downloadMidi">
        {{ downloading ? '下载中…' : '下载 MIDI' }}
      </button>
    </div>

    <div class="midi-player-shell">
      <button type="button" class="midi-play-fab" :disabled="loading" :title="playing ? '暂停' : '播放'" @click="togglePlay">
        <span v-if="loading" class="midi-spin" />
        <span v-else class="midi-play-icon">{{ playing ? '❚❚' : '▶' }}</span>
      </button>
      <div class="midi-player-main">
        <div class="midi-track" @click="onSeekClick">
          <span class="midi-fill" :style="{ width: `${Math.min(100, progress * 100)}%` }" />
        </div>
        <div class="midi-times">
          <span>{{ formatTime(elapsed) }}</span>
          <span>{{ formatTime(durationSec) }}</span>
        </div>
        <p class="midi-status">{{ statusText }}</p>
      </div>
    </div>

    <p v-if="hint && !error" class="cosmic-midi-hint">{{ hint }}</p>
    <p v-if="error" class="cosmic-midi-err">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{ url: string; label?: string }>()

const label = computed(() => props.label || 'MIDI 曲目')
const downloadName = computed(() => {
  const base = props.url.split(/[/?#]/).pop() || ''
  return /\.mid/i.test(base) ? base : 'generated.mid'
})

const loading = ref(false)
const downloading = ref(false)
const playing = ref(false)
const progress = ref(0)
const elapsed = ref(0)
const durationSec = ref(0)
const error = ref('')
const hint = '浏览器内 MIDI 合成播放；若加载失败请确认 Music_Agent(13110) 已启动。'

const statusText = computed(() => {
  if (error.value) return '加载失败'
  if (loading.value) return '正在加载 MIDI…'
  if (playing.value) return '播放中'
  if (durationSec.value > 0) return '就绪，点击播放'
  return '点击左侧按钮播放'
})

let toneMod: typeof import('tone') | null = null
let midiMod: typeof import('@tonejs/midi') | null = null
let synth: import('tone').PolySynth | null = null
let part: import('tone').Part | null = null
let parsed: import('@tonejs/midi').Midi | null = null
let raf = 0
let playStart = 0

async function fetchWithTimeout(url: string, ms = 15000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function ensureAudio() {
  if (!toneMod) toneMod = await import('tone')
  if (!midiMod) midiMod = await import('@tonejs/midi')
  await toneMod.start()
  if (!synth) {
    synth = new toneMod.PolySynth(toneMod.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.35, release: 0.6 },
    }).toDestination()
    synth.volume.value = -6
  }
}

async function loadMidi() {
  if (parsed) return parsed
  loading.value = true
  error.value = ''
  try {
    await ensureAudio()
    const res = await fetchWithTimeout(props.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}，请确认 Music_Agent 已启动且文件存在`)
    const buf = await res.arrayBuffer()
    if (!buf.byteLength) throw new Error('文件为空')
    parsed = new midiMod!.Midi(buf)
    durationSec.value = Math.max(parsed.duration, 0.5)
    return parsed
  } catch (e: any) {
    const msg = String(e?.message || e)
    error.value =
      msg.includes('abort') || msg.includes('Abort')
        ? '加载超时：请确认 music_agent 已启动，且总管已配置 MUSIC_AGENT_HTTP_URL（Docker 内应为 http://music_agent:13110）'
        : `MIDI 加载失败：${msg}`
    throw e
  } finally {
    loading.value = false
  }
}

function stopPlayback(reset = true) {
  try {
    part?.stop(0)
    part?.dispose()
  } catch {}
  part = null
  if (toneMod) {
    try {
      toneMod.Transport.stop()
      toneMod.Transport.cancel(0)
      toneMod.Transport.position = '0:0:0'
    } catch {}
  }
  if (synth) {
    try {
      synth.releaseAll()
    } catch {}
  }
  playing.value = false
  if (reset) {
    progress.value = 0
    elapsed.value = 0
  }
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function tickProgress() {
  if (!playing.value || !toneMod) return
  const t = toneMod.Transport.seconds
  elapsed.value = t
  progress.value = durationSec.value > 0 ? t / durationSec.value : 0
  if (t >= durationSec.value - 0.05) {
    stopPlayback()
    return
  }
  raf = requestAnimationFrame(tickProgress)
}

function scheduleMidi(midi: import('@tonejs/midi').Midi) {
  if (!toneMod || !synth) return
  const events: Array<{ time: number; note: any }> = []
  midi.tracks.forEach((track) => {
    track.notes.forEach((note) => {
      events.push({ time: note.time, note })
    })
  })
  events.sort((a, b) => a.time - b.time)
  stopPlayback(false)
  part = new toneMod.Part((time, value) => {
    synth!.triggerAttackRelease(value.name, value.duration, time, value.velocity)
  }, events.map((item) => ({ time: item.time, name: item.note.name, duration: item.note.duration, velocity: item.note.velocity })))
  part.start(0)
  toneMod.Transport.seconds = 0
  toneMod.Transport.start()
  playStart = toneMod.now()
  playing.value = true
  tickProgress()
}

async function togglePlay() {
  if (playing.value) {
    stopPlayback()
    return
  }
  try {
    const midi = await loadMidi()
    stopPlayback()
    scheduleMidi(midi)
  } catch {
    playing.value = false
  }
}

function onSeekClick(ev: MouseEvent) {
  if (!durationSec.value || !toneMod || !parsed) return
  const el = ev.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
  const targetSec = ratio * durationSec.value
  stopPlayback(false)
  const now = toneMod.now() + 0.06
  const notes = parsed.tracks.flatMap((track) => track.notes).filter((note) => note.time >= targetSec)
  part = new toneMod.Part((time, value) => {
    synth?.triggerAttackRelease(value.name, value.duration, time, value.velocity)
  }, notes.map((note) => ({ time: note.time - targetSec, name: note.name, duration: note.duration, velocity: note.velocity })))
  part.start(0)
  toneMod.Transport.seconds = 0
  toneMod.Transport.start()
  playStart = now - targetSec
  elapsed.value = targetSec
  progress.value = ratio
  playing.value = true
  tickProgress()
}

async function downloadMidi() {
  downloading.value = true
  error.value = ''
  try {
    const res = await fetchWithTimeout(props.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = downloadName.value
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
  } catch (e: any) {
    error.value = `下载失败：${String(e?.message || e)}`
  } finally {
    downloading.value = false
  }
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

onBeforeUnmount(() => {
  stopPlayback()
  try {
    part?.dispose()
  } catch {}
  part = null
  synth?.dispose()
  synth = null
})
</script>

<style scoped>
.cosmic-midi{padding:2px 0}
.cosmic-midi-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.cosmic-midi-label{font-size:12px;font-weight:600;color:#a5b4fc;letter-spacing:.06em}
.midi-btn{appearance:none;border:1px solid rgba(56,189,248,.45);background:linear-gradient(135deg,rgba(37,99,235,.35),rgba(124,58,237,.25));color:#e0f2fe;border-radius:999px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer}
.midi-btn:disabled{opacity:.55;cursor:wait}
.midi-btn.alt{background:rgba(30,41,59,.65)}
.midi-player-shell{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:rgba(2,8,28,.65);border:1px solid rgba(56,189,248,.25)}
.midi-play-fab{flex-shrink:0;width:44px;height:44px;border-radius:50%;border:1px solid rgba(56,189,248,.5);background:linear-gradient(145deg,#1d4ed8,#7c3aed);color:#f8fafc;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(59,130,246,.35)}
.midi-play-fab:disabled{opacity:.6;cursor:wait}
.midi-play-icon{font-size:14px;line-height:1}
.midi-spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:midiSpin .7s linear infinite}
@keyframes midiSpin{to{transform:rotate(360deg)}}
.midi-player-main{flex:1;min-width:0}
.midi-track{height:6px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden;cursor:pointer;margin-bottom:6px}
.midi-fill{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#a78bfa);box-shadow:0 0 10px rgba(56,189,248,.5);transition:width .08s linear}
.midi-times{display:flex;justify-content:space-between;font-size:10px;color:#94a3b8;font-variant-numeric:tabular-nums}
.midi-status{margin:4px 0 0;font-size:11px;color:#64748b}
.cosmic-midi-hint{margin:8px 0 0;font-size:11px;color:#64748b;line-height:1.5}
.cosmic-midi-err{margin:8px 0 0;font-size:11px;color:#fca5a5;line-height:1.5}
</style>
