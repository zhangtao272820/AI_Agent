<template>
  <div ref="backgroundRef" class="spring-background">
    <div class="sky-gradient"></div>
    <div class="aurora-layer"></div>
    <div class="petal-layer">
      <span
        v-for="petal in petals"
        :key="petal.id"
        class="petal"
        :style="petal.style"
      />
    </div>
    <div
      class="cursor-bloom"
      :style="{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }"
    ></div>
    <div class="vignette"></div>
  </div>
</template>

<script setup lang="ts">
type PetalItem = {
  id: number
  style: Record<string, string>
}

const cursor = ref({ x: 0, y: 0 })
const petals = ref<PetalItem[]>([])
const backgroundRef = ref<HTMLElement | null>(null)
let windTimer: ReturnType<typeof setInterval> | null = null
let gustTimer: ReturnType<typeof setTimeout> | null = null
let nextGustTimer: ReturnType<typeof setTimeout> | null = null
let windFrame = 0
const windState = {
  x: 0,
  rotate: 0,
  targetX: 0,
  targetRotate: 0
}

function createPetal(index: number): PetalItem {
  const delay = `${(-Math.random() * 20).toFixed(2)}s`
  const duration = `${(12 + Math.random() * 16).toFixed(2)}s`
  const drift = `${(-26 + Math.random() * 52).toFixed(2)}px`
  const left = `${(Math.random() * 100).toFixed(2)}%`
  const size = `${(6 + Math.random() * 12).toFixed(2)}px`
  const sway = `${(3 + Math.random() * 5).toFixed(2)}s`
  const opacity = `${(0.35 + Math.random() * 0.45).toFixed(2)}`

  return {
    id: index,
    style: {
      left,
      width: size,
      height: `${Number(size.replace('px', '')) * 0.72}px`,
      animationDelay: `${delay}, ${delay}`,
      animationDuration: `${duration}, ${sway}`,
      '--drift': drift,
      '--petal-opacity': opacity
    }
  }
}

function onPointerMove(event: MouseEvent) {
  cursor.value = {
    x: event.clientX,
    y: event.clientY
  }
}

function applyWind(windX: number, rotate: number) {
  if (!backgroundRef.value) return
  backgroundRef.value.style.setProperty('--wind-x', `${windX.toFixed(2)}px`)
  backgroundRef.value.style.setProperty('--wind-rotate', `${rotate.toFixed(2)}deg`)
}

function randomBaseWind() {
  windState.targetX = 0
  windState.targetRotate = 0
}

function triggerGust() {
  const dir = Math.random() > 0.5 ? 1 : -1
  windState.targetX = dir * (88 + Math.random() * 88)
  windState.targetRotate = dir * (12 + Math.random() * 10)

  if (gustTimer) {
    window.clearTimeout(gustTimer)
    gustTimer = null
  }
  gustTimer = window.setTimeout(() => {
    randomBaseWind()
    scheduleNextGust()
  }, 2200 + Math.floor(Math.random() * 2000))
}

function scheduleNextGust() {
  if (nextGustTimer) {
    window.clearTimeout(nextGustTimer)
    nextGustTimer = null
  }
  nextGustTimer = window.setTimeout(() => {
    triggerGust()
  }, 12000 + Math.floor(Math.random() * 18000))
}

function animateWind() {
  windState.x += (windState.targetX - windState.x) * 0.06
  windState.rotate += (windState.targetRotate - windState.rotate) * 0.06
  applyWind(windState.x, windState.rotate)
  windFrame = window.requestAnimationFrame(animateWind)
}

onMounted(() => {
  petals.value = Array.from({ length: 88 }, (_, idx) => createPetal(idx))
  cursor.value = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.4
  }
  if (backgroundRef.value) {
    applyWind(0, 0)
  }
  windState.x = 0
  windState.rotate = 0
  windState.targetX = 0
  windState.targetRotate = 0
  animateWind()
  scheduleNextGust()
  window.addEventListener('mousemove', onPointerMove)
})

onBeforeUnmount(() => {
  if (windTimer) {
    window.clearInterval(windTimer)
    windTimer = null
  }
  if (gustTimer) {
    window.clearTimeout(gustTimer)
    gustTimer = null
  }
  if (nextGustTimer) {
    window.clearTimeout(nextGustTimer)
    nextGustTimer = null
  }
  if (windFrame) {
    window.cancelAnimationFrame(windFrame)
    windFrame = 0
  }
  window.removeEventListener('mousemove', onPointerMove)
})
</script>

<style scoped>
.spring-background {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  background: #0b1210;
  --wind-x: 0px;
  --wind-rotate: 0deg;
}

.sky-gradient {
  position: absolute;
  inset: -15%;
  background:
    radial-gradient(circle at 18% 24%, rgba(200, 255, 191, 0.28), transparent 44%),
    radial-gradient(circle at 82% 22%, rgba(255, 212, 235, 0.26), transparent 46%),
    radial-gradient(circle at 52% 78%, rgba(156, 238, 184, 0.25), transparent 53%),
    linear-gradient(160deg, #09110d 0%, #111e17 46%, #16281d 100%);
  animation: skyShift 18s ease-in-out infinite alternate;
}

.aurora-layer {
  position: absolute;
  inset: -20%;
  background:
    conic-gradient(from 180deg at 30% 40%, rgba(171, 243, 174, 0.2), transparent 40%, rgba(255, 189, 224, 0.12), transparent 72%, rgba(171, 243, 174, 0.2)),
    radial-gradient(circle at 70% 65%, rgba(209, 255, 214, 0.14), transparent 48%);
  filter: blur(28px);
  animation: auroraFlow 22s linear infinite;
  opacity: 0.8;
}

.petal-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.petal {
  position: absolute;
  top: -10%;
  border-radius: 75% 20% 70% 25%;
  background: linear-gradient(145deg, rgba(255, 215, 232, 0.92), rgba(255, 177, 213, 0.6));
  box-shadow: 0 0 8px rgba(255, 193, 224, 0.35);
  opacity: var(--petal-opacity, 0.6);
  animation-name: petalFall, petalSway;
  animation-timing-function: linear, ease-in-out;
  animation-iteration-count: infinite, infinite;
  transform-origin: center center;
}

.cursor-bloom {
  position: absolute;
  width: 380px;
  height: 380px;
  margin-left: -190px;
  margin-top: -190px;
  border-radius: 50%;
  pointer-events: none;
  background:
    radial-gradient(circle, rgba(196, 255, 191, 0.26) 0%, rgba(255, 188, 224, 0.1) 40%, transparent 72%);
  filter: blur(12px);
  transition: transform 180ms ease-out;
}

.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at center, transparent 48%, rgba(2, 8, 6, 0.48) 100%),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.24));
}

@keyframes petalFall {
  from {
    transform: translate3d(0, -10vh, 0) rotate(0deg);
  }
  to {
    transform: translate3d(calc(var(--drift, 0px) + var(--wind-x, 0px)), 118vh, 0) rotate(320deg);
  }
}

@keyframes petalSway {
  0%, 100% {
    margin-left: -8px;
    rotate: calc(-6deg + var(--wind-rotate, 0deg));
  }
  50% {
    margin-left: 8px;
    rotate: calc(7deg + var(--wind-rotate, 0deg));
  }
}

@keyframes skyShift {
  0% {
    transform: translate3d(-1.2%, -1.6%, 0) scale(1.01);
  }
  100% {
    transform: translate3d(1.4%, 1.8%, 0) scale(1.06);
  }
}

@keyframes auroraFlow {
  0% {
    transform: rotate(0deg) scale(1);
  }
  50% {
    transform: rotate(180deg) scale(1.04);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
}
</style>
