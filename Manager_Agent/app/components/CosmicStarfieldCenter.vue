<template>
  <div ref="rootEl" class="cosmic-stars">
    <canvas ref="canvasEl" class="cosmic-stars-canvas" />
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { STAR_FRAGMENT, STAR_VERTEX } from './cosmicUniverseShared'

const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let starPoints: THREE.Points | null = null
let starMaterial: THREE.ShaderMaterial | null = null
let animationId = 0
let running = true
let resizeObserver: ResizeObserver | null = null
let onVisibility: (() => void) | null = null

const STAR_COUNT = 16000

function createStars(sceneRef: THREE.Scene) {
  const positions = new Float32Array(STAR_COUNT * 3)
  const colors = new Float32Array(STAR_COUNT * 3)
  const sizes = new Float32Array(STAR_COUNT)
  const alphas = new Float32Array(STAR_COUNT)
  const twinkleSpeed = new Float32Array(STAR_COUNT)
  const twinklePhase = new Float32Array(STAR_COUNT)

  const temps = [
    { h: 218, s: 10, l: 95 },
    { h: 225, s: 18, l: 90 },
    { h: 45, s: 22, l: 91 },
    { h: 28, s: 32, l: 87 }
  ]

  for (let i = 0; i < STAR_COUNT; i++) {
    const layer = Math.floor(Math.random() * 4)
    const temp = temps[layer]
    const depth = 420 + layer * 150 + Math.random() * 480

    positions[i * 3] = (Math.random() - 0.5) * 1200
    positions[i * 3 + 1] = (Math.random() - 0.5) * 800
    positions[i * 3 + 2] = -depth

    const col = new THREE.Color()
    col.setHSL((temp.h + (Math.random() - 0.5) * 12) / 360, temp.s / 100, temp.l / 100)
    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b

    sizes[i] = (4.5 - layer * 0.2) + Math.random() * (6.5 - layer * 0.35)
    alphas[i] = 0.78 + Math.random() * 0.22
    twinkleSpeed[i] = 0.8 + Math.random() * 4
    twinklePhase[i] = Math.random() * Math.PI * 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('twinkleSpeed', new THREE.BufferAttribute(twinkleSpeed, 1))
  geometry.setAttribute('twinklePhase', new THREE.BufferAttribute(twinklePhase, 1))

  starMaterial = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uWarp: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true
  })

  starPoints = new THREE.Points(geometry, starMaterial)
  sceneRef.add(starPoints)
}

function resize() {
  if (!camera || !renderer || !rootEl.value || !canvasEl.value) return
  const rect = rootEl.value.getBoundingClientRect()
  const w = Math.max(1, Math.floor(rect.width))
  const h = Math.max(1, Math.floor(rect.height))
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

function init() {
  if (!canvasEl.value || !rootEl.value) return

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x030508)
  camera = new THREE.PerspectiveCamera(52, 1, 1, 4000)
  camera.position.set(0, 0, 0)

  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl.value,
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance'
  })
  renderer.setClearColor(0x030508, 1)

  createStars(scene)
  resize()

  const tick = (t: number) => {
    animationId = requestAnimationFrame(tick)
    if (!running || !renderer || !scene || !camera || !starMaterial) return
    starMaterial.uniforms.uTime.value = t * 0.001
    if (starPoints) {
      starPoints.position.x = Math.sin(t * 0.00007) * 40
      starPoints.position.y = Math.cos(t * 0.00005) * 14
    }
    renderer.render(scene, camera)
  }
  tick(0)
}

function cleanup() {
  running = false
  if (animationId) cancelAnimationFrame(animationId)
  resizeObserver?.disconnect()
  if (starPoints) {
    starPoints.geometry.dispose()
    starMaterial?.dispose()
    scene?.remove(starPoints)
  }
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  starPoints = null
  starMaterial = null
}

onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    return
  }
  init()
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resize())
    resizeObserver.observe(rootEl.value)
  } else {
    window.addEventListener('resize', resize, { passive: true })
  }
  onVisibility = () => {
    running = !document.hidden
  }
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  cleanup()
  window.removeEventListener('resize', resize)
})
</script>

<style scoped>
.cosmic-stars {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 40%, rgba(18, 24, 55, 0.35), #030508 70%);
  overflow: hidden;
}
.cosmic-stars-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
