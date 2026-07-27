<template>
  <div
    ref="rootEl"
    class="cosmic-lane"
    :class="[isFull ? 'cosmic-lane--full' : `cosmic-lane--${side}`, { 'cosmic-lane--thinking': thinkingBlend > 0.08 }]"
  >
    <canvas ref="glCanvas" class="cosmic-lane-gl" />
    <canvas ref="fxCanvas" class="cosmic-lane-fx" />
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three'
import { animateHoleParticles, createGargantuaHole, orientHoleToCamera } from './cosmicLensingHole'
import {
  STAR_FRAGMENT,
  STAR_VERTEX,
  createPointMaterial,
  disposeMaterial,
  disposeObjectDeep,
  fillGalaxySpiral,
  makeCoreTexture,
  makeNebulaCloudTexture,
  makeOrionNebulaTexture,
  makePillarNebulaTexture,
  makeSoftAlphaTexture,
  randomNormal
} from './cosmicUniverseShared'

const props = withDefaults(
  defineProps<{
    side?: 'left' | 'right' | 'full'
    /** Agent 思考/执行中时拉高宇宙动效强度 */
    agentThinking?: boolean
  }>(),
  { side: 'left', agentThinking: false }
)

const thinkingBlend = ref(0)

const isFull = computed(() => props.side === 'full')
const GALAXY_ROT_SPEED = 0.00042
/** full 布局下星系/星云整体放大 */
const FULL_COSMIC_SCALE = 1.38

const MOTION_PROFILE = {
  /** 基线慢速漂移，营造深空推进感 */
  starDriftX: 0.006,
  starDriftY: 0.004,
  starDriftAmpX: 12,
  starDriftAmpY: 8,
  dustDriftX: 0.004,
  dustDriftY: 0.003,
  dustDriftAmpX: 8,
  dustDriftAmpY: 5,
  galaxyPulse: 0.045,
  nebulaPulse: 0.06
}

const rootEl = ref<HTMLDivElement | null>(null)
const glCanvas = ref<HTMLCanvasElement | null>(null)
const fxCanvas = ref<HTMLCanvasElement | null>(null)

let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let skyPoints: THREE.Points | null = null
let skyMaterial: THREE.ShaderMaterial | null = null
let dustPoints: THREE.Points | null = null
let ambientNebulaGroup: THREE.Group | null = null
let standaloneNebulaGroup: THREE.Group | null = null
let blackHoleGroup: THREE.Group | null = null
let whiteHoleGroup: THREE.Group | null = null
const animGroups: THREE.Group[] = []
const galaxyGroups: { group: THREE.Group; rotSpeed: number }[] = []

let fullGalaxyInset = 320
let fullLayoutAspect = 1.78
let fullViewportWidth = 1920
let fullViewportHeight = 1080

/** 由相机 FOV + 对话框宽度推算 gutter 世界坐标边界 */
interface GutterBounds {
  dialogHalfX: number
  innerX: number
  outerX: number
  worldHalfW: number
  worldHalfH: number
}

let gutter: GutterBounds = {
  dialogHalfX: 380,
  innerX: 410,
  outerX: 490,
  worldHalfW: 520,
  worldHalfH: 300
}

const FULL_COVER_HALF_W = 2400
const FULL_COVER_HALF_H = 1450

let nebulaSharedTexture: THREE.CanvasTexture | null = null
let softAlphaTexture: THREE.CanvasTexture | null = null
let orionNebulaTexture: THREE.CanvasTexture | null = null
let pillarNebulaTexture: THREE.CanvasTexture | null = null
let coreTexture: THREE.CanvasTexture | null = null
let animationId = 0
let running = true
let resizeObserver: ResizeObserver | null = null

interface Meteor {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  head: string
  mid: string
  width: number
}

let fxCtx: CanvasRenderingContext2D | null = null
let fxW = 0
let fxH = 0
let meteors: Meteor[] = []
let lastMeteorAt = 0
let onVisibility: (() => void) | null = null

const SKY_STAR_COUNT = props.side === 'full' ? 52000 : 5500
const DUST_COUNT = props.side === 'full' ? 5200 : 0

interface ScreenPlacement {
  screenX: number
  screenY: number
  z: number
}

interface ClusterDef extends ScreenPlacement {
  x?: number
  y?: number
  radius: number
  rotZ: number
  rotSpeed: number
  arms: number
  twist: number
  armSpread: number
  flatten: number
  diskThickness: number
  starCount: number
  dustCount: number
  inner: string
  outer: string
  armTints: string[]
  coreScale: number
  nebulaCount: number
}

/** 独立星云（大云雾 Sprite，与螺旋星系粒子区分） */
interface NebulaCloudDef extends ScreenPlacement {
  x?: number
  y?: number
  sx: number
  sy: number
  color: string
  opacity: number
  variant: 'orion' | 'pillar' | 'cloud'
}

const _raycaster = new THREE.Raycaster()
const _plane = new THREE.Plane()
const _planeHit = new THREE.Vector3()
const _ndc = new THREE.Vector2()

/** 屏幕比例 (0~1) → 世界坐标：保证落在对话框外侧 gutter，不被透视挤到中间 */
function worldAtScreen(screenX: number, screenY: number, z: number): THREE.Vector3 | null {
  if (!camera) return null
  _ndc.set(screenX * 2 - 1, -(screenY * 2 - 1))
  _raycaster.setFromCamera(_ndc, camera)
  _plane.set(new THREE.Vector3(0, 0, 1), -z)
  const hit = _raycaster.ray.intersectPlane(_plane, _planeHit)
  return hit ? _planeHit.clone() : null
}

function tagPlacement(obj: THREE.Object3D, p: ScreenPlacement) {
  obj.userData.placement = { screenX: p.screenX, screenY: p.screenY, z: p.z }
}

function applyPlacement(obj: THREE.Object3D) {
  const p = obj.userData.placement as ScreenPlacement | undefined
  if (!p) return
  const pos = worldAtScreen(p.screenX, p.screenY, p.z)
  if (pos) {
    obj.position.copy(pos)
    obj.userData.basePos = pos.clone()
  }
}

function relayoutPlacedObjects() {
  if (!camera || props.side !== 'full') return
  if (blackHoleGroup?.userData.placement) {
    Object.assign(blackHoleGroup.userData.placement, lensingHolePlacement(false))
  }
  if (whiteHoleGroup?.userData.placement) {
    Object.assign(whiteHoleGroup.userData.placement, lensingHolePlacement(true))
  }
  for (const g of animGroups) applyPlacement(g)
  standaloneNebulaGroup?.children.forEach((c) => applyPlacement(c))
  ambientNebulaGroup?.children.forEach((c) => applyPlacement(c))
}

function clampObjectToViewBand(obj: THREE.Object3D, margin = 28) {
  if (!camera || props.side !== 'full') return
  const z = obj.position.z
  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
  const camToPlane = Math.max(1, camera.position.z - z)
  const halfW = Math.tan(hFov / 2) * camToPlane
  const halfH = Math.tan(vFov / 2) * camToPlane

  const xMin = -halfW + margin
  const xMax = halfW - margin
  const yMin = -halfH + margin * 0.5
  const yMax = halfH - margin * 0.5

  obj.position.x = THREE.MathUtils.clamp(obj.position.x, xMin, xMax)
  obj.position.y = THREE.MathUtils.clamp(obj.position.y, yMin, yMax)
}

/** 左侧 gutter：screenX 4%~24%，screenY 铺满顶/中/底 */
const LEFT_GALAXY_TEMPLATES: ClusterDef[] = [
  {
    screenX: 0.1, screenY: 0.92, z: -520, radius: 105, rotZ: 0.32, rotSpeed: 0.00038, arms: 4, twist: 0.014, armSpread: 0.36, flatten: 0.82,
    diskThickness: 22, starCount: 3200, dustCount: 1100,
    inner: '#ffd0a6', outer: '#9ad6ff', armTints: ['#7dd3fc', '#22d3ee', '#c084fc', '#fb7185'],
    coreScale: 0.62, nebulaCount: 2
  },
  {
    screenX: 0.18, screenY: 0.74, z: -545, radius: 130, rotZ: 1.15, rotSpeed: -0.00034, arms: 2, twist: 0.016, armSpread: 0.34, flatten: 0.76,
    diskThickness: 24, starCount: 3600, dustCount: 1250,
    inner: '#fff8ee', outer: '#6b5344', armTints: ['#d4c4a8', '#c9b89a', '#a89070', '#8b7355'],
    coreScale: 0.65, nebulaCount: 2
  },
  {
    screenX: 0.11, screenY: 0.56, z: -560, radius: 145, rotZ: 2.05, rotSpeed: 0.0004, arms: 4, twist: 0.014, armSpread: 0.35, flatten: 0.8,
    diskThickness: 26, starCount: 4000, dustCount: 1400,
    inner: '#e8f0ff', outer: '#1e6fd4', armTints: ['#6eb0f5', '#93c5fd', '#60a5fa', '#3b82f6'],
    coreScale: 0.7, nebulaCount: 3
  },
  {
    screenX: 0.2, screenY: 0.38, z: -575, radius: 120, rotZ: 0.85, rotSpeed: -0.00036, arms: 2, twist: 0.017, armSpread: 0.38, flatten: 0.68,
    diskThickness: 20, starCount: 3000, dustCount: 1050,
    inner: '#fff4e8', outer: '#8b6914', armTints: ['#fcd34d', '#fbbf24', '#d97706', '#b45309'],
    coreScale: 0.6, nebulaCount: 2
  },
  {
    screenX: 0.12, screenY: 0.2, z: -590, radius: 115, rotZ: 1.6, rotSpeed: 0.00033, arms: 2, twist: 0.016, armSpread: 0.36, flatten: 0.72,
    diskThickness: 19, starCount: 2800, dustCount: 950,
    inner: '#f0ffe8', outer: '#508820', armTints: ['#bef264', '#a3e635', '#84cc16', '#65a30d'],
    coreScale: 0.58, nebulaCount: 2
  },
  {
    screenX: 0.17, screenY: 0.06, z: -605, radius: 95, rotZ: 2.3, rotSpeed: -0.0004, arms: 2, twist: 0.018, armSpread: 0.4, flatten: 0.65,
    diskThickness: 16, starCount: 2200, dustCount: 750,
    inner: '#ecfdf5', outer: '#0d9488', armTints: ['#5eead4', '#2dd4bf', '#14b8a6', '#0f766e'],
    coreScale: 0.55, nebulaCount: 2
  }
]

const RIGHT_GALAXY_TEMPLATES: ClusterDef[] = [
  {
    screenX: 0.9, screenY: 0.9, z: -515, radius: 108, rotZ: -0.28, rotSpeed: -0.00036, arms: 4, twist: 0.013, armSpread: 0.35, flatten: 0.84,
    diskThickness: 22, starCount: 3300, dustCount: 1150,
    inner: '#fff0f5', outer: '#6a5090', armTints: ['#c4b5fd', '#a78bfa', '#fb7185', '#f472b6'],
    coreScale: 0.62, nebulaCount: 2
  },
  {
    screenX: 0.82, screenY: 0.72, z: -540, radius: 128, rotZ: 1.45, rotSpeed: 0.00032, arms: 2, twist: 0.015, armSpread: 0.33, flatten: 0.78,
    diskThickness: 24, starCount: 3700, dustCount: 1280,
    inner: '#fff5f8', outer: '#a03060', armTints: ['#f9a8d4', '#fb7185', '#e888a8', '#be185d'],
    coreScale: 0.65, nebulaCount: 2
  },
  {
    screenX: 0.89, screenY: 0.54, z: -555, radius: 142, rotZ: 0.7, rotSpeed: -0.00038, arms: 4, twist: 0.013, armSpread: 0.34, flatten: 0.82,
    diskThickness: 25, starCount: 4100, dustCount: 1450,
    inner: '#f0ffe8', outer: '#508820', armTints: ['#bef264', '#a3e635', '#84cc16', '#65a30d'],
    coreScale: 0.7, nebulaCount: 3
  },
  {
    screenX: 0.8, screenY: 0.36, z: -570, radius: 118, rotZ: 1.9, rotSpeed: 0.00035, arms: 2, twist: 0.016, armSpread: 0.36, flatten: 0.68,
    diskThickness: 20, starCount: 2900, dustCount: 1000,
    inner: '#ecfdf5', outer: '#0d9488', armTints: ['#5eead4', '#2dd4bf', '#14b8a6', '#0f766e'],
    coreScale: 0.6, nebulaCount: 2
  },
  {
    screenX: 0.88, screenY: 0.18, z: -585, radius: 112, rotZ: 0.55, rotSpeed: -0.00033, arms: 2, twist: 0.017, armSpread: 0.37, flatten: 0.7,
    diskThickness: 18, starCount: 2700, dustCount: 920,
    inner: '#fff8ee', outer: '#6b5344', armTints: ['#d4c4a8', '#c9b89a', '#a89070', '#8b7355'],
    coreScale: 0.58, nebulaCount: 2
  },
  {
    screenX: 0.83, screenY: 0.05, z: -600, radius: 92, rotZ: 2.1, rotSpeed: 0.00037, arms: 2, twist: 0.018, armSpread: 0.39, flatten: 0.64,
    diskThickness: 15, starCount: 2100, dustCount: 720,
    inner: '#e8f0ff', outer: '#1e6fd4', armTints: ['#6eb0f5', '#93c5fd', '#60a5fa', '#3b82f6'],
    coreScale: 0.55, nebulaCount: 2
  }
]

const LEFT_NEBULA_TEMPLATES: NebulaCloudDef[] = [
  { screenX: 0.06, screenY: 0.8, z: -480, sx: 300, sy: 240, color: '#c084fc', opacity: 0.042, variant: 'orion' },
  { screenX: 0.22, screenY: 0.64, z: -495, sx: 270, sy: 220, color: '#f472b6', opacity: 0.038, variant: 'cloud' },
  { screenX: 0.07, screenY: 0.46, z: -510, sx: 290, sy: 230, color: '#60a5fa', opacity: 0.035, variant: 'orion' },
  { screenX: 0.21, screenY: 0.28, z: -525, sx: 250, sy: 200, color: '#fb923c', opacity: 0.032, variant: 'pillar' },
  { screenX: 0.08, screenY: 0.12, z: -540, sx: 230, sy: 185, color: '#a78bfa', opacity: 0.03, variant: 'cloud' },
  { screenX: 0.19, screenY: 0.02, z: -555, sx: 210, sy: 170, color: '#67e8f9', opacity: 0.028, variant: 'pillar' }
]

const RIGHT_NEBULA_TEMPLATES: NebulaCloudDef[] = [
  { screenX: 0.94, screenY: 0.78, z: -475, sx: 295, sy: 235, color: '#f9a8d4', opacity: 0.04, variant: 'orion' },
  { screenX: 0.78, screenY: 0.62, z: -490, sx: 265, sy: 215, color: '#67e8f9', opacity: 0.036, variant: 'cloud' },
  { screenX: 0.93, screenY: 0.44, z: -505, sx: 285, sy: 225, color: '#c4b5fd', opacity: 0.034, variant: 'orion' },
  { screenX: 0.77, screenY: 0.26, z: -520, sx: 255, sy: 205, color: '#86efac', opacity: 0.031, variant: 'pillar' },
  { screenX: 0.92, screenY: 0.1, z: -535, sx: 235, sy: 190, color: '#fda4af', opacity: 0.029, variant: 'cloud' },
  { screenX: 0.79, screenY: 0.01, z: -550, sx: 220, sy: 175, color: '#fcd34d', opacity: 0.027, variant: 'pillar' }
]

function resolveScreenPos(def: ScreenPlacement) {
  const pos = worldAtScreen(def.screenX, def.screenY, def.z)
  return { x: pos?.x ?? 0, y: pos?.y ?? 0 }
}

/** 黑洞/白洞落在对话框外侧 gutter，避免被中央 UI 遮挡 */
function lensingHolePlacement(isWhite: boolean): ScreenPlacement {
  if (props.side !== 'full') {
    return isWhite
      ? { screenX: 0.28, screenY: 0.5, z: 20 }
      : { screenX: 0.72, screenY: 0.5, z: 20 }
  }
  const dialogRatio = Math.min(720, fullViewportWidth * 0.48) / Math.max(1, fullViewportWidth)
  const halfDialog = dialogRatio / 2
  const gutterPad = 0.04
  const fromCenter = halfDialog + gutterPad + 0.1
  const screenX = isWhite
    ? Math.max(0.5 + fromCenter, 0.86)
    : Math.min(0.5 - fromCenter, 0.14)
  return {
    screenX: THREE.MathUtils.clamp(screenX, 0.08, 0.92),
    screenY: 0.5,
    z: 55
  }
}

function updateFullLayoutMetrics(width: number, height: number) {
  fullLayoutAspect = width / Math.max(1, height)
  fullViewportWidth = width
  fullViewportHeight = height

  const vFov = (50 * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * fullLayoutAspect)
  const camDist = Math.hypot(420, 880)
  const worldHalfW = camDist * Math.tan(hFov / 2)
  const worldHalfH = camDist * Math.tan(vFov / 2)

  const dialogHalfPx = Math.min(720, width * 0.48)
  const pxToWorld = worldHalfW / (width / 2)
  fullGalaxyInset = dialogHalfPx * pxToWorld
  gutter = { dialogHalfX: fullGalaxyInset, innerX: 0, outerX: worldHalfW, worldHalfW, worldHalfH }
}

const METEOR_COLORS = [
  { head: '255,252,248', mid: '200,225,255' },
  { head: '255,210,140', mid: '255,120,80' },
  { head: '180,255,200', mid: '80,200,140' },
  { head: '255,180,240', mid: '200,100,255' },
  { head: '140,220,255', mid: '60,140,255' },
  { head: '255,255,180', mid: '255,200,100' }
]

function getGalaxyDefs(): ClusterDef[] {
  if (props.side === 'full') {
    return [...LEFT_GALAXY_TEMPLATES, ...RIGHT_GALAXY_TEMPLATES]
  }
  if (props.side === 'left') return LEFT_GALAXY_TEMPLATES
  return RIGHT_GALAXY_TEMPLATES
}

function getNebulaDefs(): NebulaCloudDef[] {
  if (props.side === 'full') {
    return [...LEFT_NEBULA_TEMPLATES, ...RIGHT_NEBULA_TEMPLATES]
  }
  if (props.side === 'left') return LEFT_NEBULA_TEMPLATES
  return RIGHT_NEBULA_TEMPLATES
}

function addArmNebulae(group: THREE.Group, def: ClusterDef, armTintColors: THREE.Color[]) {
  if (!softAlphaTexture || def.nebulaCount <= 0) return

  for (let i = 0; i < def.nebulaCount; i++) {
    const r = def.radius * (0.35 + Math.pow(Math.random(), 0.85) * 0.62)
    const armIndex = Math.floor(Math.random() * def.arms)
    const angle = (armIndex / def.arms) * Math.PI * 2 + r * def.twist + randomNormal() * (def.armSpread * 0.55)

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softAlphaTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.06 + Math.random() * 0.08,
        color: armTintColors[(armIndex + i) % armTintColors.length]
      })
    )
    sprite.position.set(
      Math.cos(angle) * r + randomNormal() * (r * 0.08),
      randomNormal() * def.diskThickness * 1.1,
      Math.sin(angle) * r * 0.15 + randomNormal() * (r * 0.04)
    )
    const s = def.radius * (0.35 + Math.random() * 0.45)
    sprite.scale.set(s, s * (0.65 + def.flatten * 0.15), 1)
    sprite.userData.baseScale = { x: s, y: s * (0.65 + def.flatten * 0.15), phase: Math.random() * Math.PI * 2 }
    group.add(sprite)
  }
}

function createStandaloneNebulae(sceneRef: THREE.Scene) {
  standaloneNebulaGroup = new THREE.Group()
  standaloneNebulaGroup.renderOrder = 1

  for (const def of getNebulaDefs()) {
    const tex =
      def.variant === 'orion'
        ? orionNebulaTexture
        : def.variant === 'pillar'
          ? pillarNebulaTexture
          : nebulaSharedTexture
    if (!tex) continue

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: def.opacity,
        color: new THREE.Color(def.color)
      })
    )
    const nebScale = props.side === 'full' ? FULL_COSMIC_SCALE : 1
    const pos = resolveScreenPos(def)
    sprite.position.set(pos.x, pos.y, def.z)
    sprite.userData.basePos = new THREE.Vector3(pos.x, pos.y, def.z)
    const bx = def.sx * nebScale
    const by = def.sy * nebScale
    sprite.scale.set(bx, by, 1)
    sprite.userData.baseScale = { x: bx, y: by, phase: Math.random() * Math.PI * 2 }
    tagPlacement(sprite, def)
    standaloneNebulaGroup.add(sprite)
  }

  sceneRef.add(standaloneNebulaGroup)
}

function createGalaxy(def: ClusterDef, sceneRef: THREE.Scene) {
  const sizeScale = props.side === 'full' ? FULL_COSMIC_SCALE : 1
  const radius = def.radius * sizeScale
  const armTightness = 0.18 + (radius / 280) * 0.06
  const inner = new THREE.Color(def.inner)
  const outer = new THREE.Color(def.outer)
  const armTintColors = def.armTints.map((c) => new THREE.Color(c))
  const group = new THREE.Group()
  const pos = resolveScreenPos(def)
  group.position.set(pos.x, pos.y, def.z)
  group.userData.basePos = new THREE.Vector3(pos.x, pos.y, def.z)
  group.userData.motionPhase = Math.random() * Math.PI * 2
  tagPlacement(group, def)
  group.rotation.x = -0.48
  group.rotation.z = def.rotZ
  group.renderOrder = 2

  const densityScale = props.side === 'full' ? 1 : 0.4
  const starCount = Math.floor(def.starCount * densityScale)
  const dustCount = Math.floor(def.dustCount * densityScale)
  const total = starCount + dustCount

  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const sizes = new Float32Array(total)
  const alphas = new Float32Array(total)

  const spiralBase = {
    radius,
    arms: def.arms,
    armSpread: def.armSpread,
    armTightness,
    flatten: def.flatten,
    diskThickness: def.diskThickness,
    innerColor: inner,
    outerColor: outer,
    armTints: armTintColors
  }

  fillGalaxySpiral(positions, colors, sizes, alphas, {
    ...spiralBase,
    offset: 0,
    count: starCount,
    twist: def.twist,
    isDust: false
  })
  fillGalaxySpiral(positions, colors, sizes, alphas, {
    ...spiralBase,
    offset: starCount,
    count: dustCount,
    twist: def.twist * 1.04,
    isDust: true
  })

  if (sizeScale > 1) {
    for (let i = 0; i < total; i++) sizes[i] *= 1.12
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))

  const points = new THREE.Points(geo, createPointMaterial())
  group.add(points)

  addArmNebulae(group, { ...def, radius }, armTintColors)

  if (coreTexture) {
    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: coreTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.55,
        color: inner
      })
    )
    const coreSize = radius * 0.55 * def.coreScale
    core.scale.set(coreSize, coreSize, 1)
    group.add(core)
  }

  sceneRef.add(group)
  animGroups.push(group)
  galaxyGroups.push({ group, rotSpeed: def.rotSpeed })
}

function createSkyStars(sceneRef: THREE.Scene) {
  const positions = new Float32Array(SKY_STAR_COUNT * 3)
  const colors = new Float32Array(SKY_STAR_COUNT * 3)
  const sizes = new Float32Array(SKY_STAR_COUNT)
  const alphas = new Float32Array(SKY_STAR_COUNT)
  const twinkleSpeed = new Float32Array(SKY_STAR_COUNT)
  const twinklePhase = new Float32Array(SKY_STAR_COUNT)

  const temps = [
    { h: 218, s: 6, l: 97 },
    { h: 198, s: 38, l: 76 },
    { h: 42, s: 22, l: 91 },
    { h: 12, s: 42, l: 84 },
    { h: 278, s: 48, l: 80 },
    { h: 152, s: 34, l: 72 },
    { h: 332, s: 44, l: 78 },
    { h: 265, s: 28, l: 86 },
    { h: 175, s: 52, l: 68 },
    { h: 48, s: 12, l: 94 }
  ]

  const coverW = props.side === 'full' ? Math.max(FULL_COVER_HALF_W, gutter.worldHalfW * 1.22) : FULL_COVER_HALF_W
  const coverH = props.side === 'full' ? Math.max(FULL_COVER_HALF_H, gutter.worldHalfH * 1.28) : FULL_COVER_HALF_H

  for (let i = 0; i < SKY_STAR_COUNT; i++) {
    const temp = temps[Math.floor(Math.random() * temps.length)]
    const depthT = Math.pow(Math.random(), 0.78)
    const layer = Math.floor(depthT * 4)
    const depth = 320 + layer * 120 + depthT * 620

    if (props.side === 'full') {
      positions[i * 3] = (Math.random() - 0.5) * coverW * 2.35
      positions[i * 3 + 1] = (Math.random() - 0.5) * coverH * 2.25
      positions[i * 3 + 2] = (Math.random() - 0.5) * coverH * 1.55 - depth * 0.1
    } else {
      const xMin = props.side === 'left' ? -40 : -360
      const xMax = props.side === 'left' ? 360 : 40
      positions[i * 3] = xMin + Math.random() * (xMax - xMin)
      positions[i * 3 + 1] = (Math.random() - 0.5) * 920
      positions[i * 3 + 2] = -depth - Math.random() * 200
    }

    const col = new THREE.Color()
    col.setHSL((temp.h + (Math.random() - 0.5) * 18) / 360, temp.s / 100, temp.l / 100)
    colors[i * 3] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b

    const depthBright = 0.62 + 0.38 * (1 - depthT)
    const sizeRoll = Math.random()
    let baseSize: number
    if (sizeRoll < 0.52) baseSize = 1.1 + Math.random() * 2.4
    else if (sizeRoll < 0.88) baseSize = 3.2 + Math.random() * 5.2
    else baseSize = 7.5 + Math.random() * 10.5
    sizes[i] = baseSize * depthBright * (0.85 + Math.random() * 0.35)
    alphas[i] = (0.68 + Math.random() * 0.32) * (1 - layer * 0.03) * depthBright
    twinkleSpeed[i] = 0.55 + Math.random() * 4.6
    twinklePhase[i] = Math.random() * Math.PI * 2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))
  geo.setAttribute('twinkleSpeed', new THREE.BufferAttribute(twinkleSpeed, 1))
  geo.setAttribute('twinklePhase', new THREE.BufferAttribute(twinklePhase, 1))

  skyMaterial = new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uWarp: { value: 0 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true
  })

  skyPoints = new THREE.Points(geo, skyMaterial)
  sceneRef.add(skyPoints)
}

function createCosmicDust(sceneRef: THREE.Scene) {
  if (DUST_COUNT <= 0) return

  const positions = new Float32Array(DUST_COUNT * 3)
  const colors = new Float32Array(DUST_COUNT * 3)
  const sizes = new Float32Array(DUST_COUNT)
  const alphas = new Float32Array(DUST_COUNT)

  const dustColors = [
    new THREE.Color('#4a6080'),
    new THREE.Color('#6080a0'),
    new THREE.Color('#806080'),
    new THREE.Color('#506878'),
    new THREE.Color('#705868')
  ]

  for (let i = 0; i < DUST_COUNT; i++) {
    const c = dustColors[Math.floor(Math.random() * dustColors.length)]
    positions[i * 3] = (Math.random() - 0.5) * FULL_COVER_HALF_W * 2
    positions[i * 3 + 1] = (Math.random() - 0.5) * 400
    positions[i * 3 + 2] = (Math.random() - 0.5) * FULL_COVER_HALF_H * 1.2 - 400

    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
    sizes[i] = 18 + Math.random() * 32
    alphas[i] = 0.01 + Math.random() * 0.018
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1))

  dustPoints = new THREE.Points(geo, createPointMaterial())
  sceneRef.add(dustPoints)
}

function createAmbientNebulae(sceneRef: THREE.Scene) {
  if (!nebulaSharedTexture) return

  ambientNebulaGroup = new THREE.Group()
  ambientNebulaGroup.renderOrder = 0

  const backdropLayers: (ScreenPlacement & { sx: number; sy: number; tex: THREE.CanvasTexture | null; color: string; opacity: number })[] = [
    { screenX: 0.14, screenY: 0.88, z: -660, sx: 520, sy: 420, tex: nebulaSharedTexture, color: '#0c1028', opacity: 0.024 },
    { screenX: 0.86, screenY: 0.88, z: -655, sx: 500, sy: 410, tex: nebulaSharedTexture, color: '#0c1028', opacity: 0.022 },
    { screenX: 0.12, screenY: 0.5, z: -640, sx: 540, sy: 380, tex: orionNebulaTexture, color: '#ffffff', opacity: 0.02 },
    { screenX: 0.88, screenY: 0.5, z: -635, sx: 520, sy: 370, tex: orionNebulaTexture, color: '#ffffff', opacity: 0.019 },
    { screenX: 0.15, screenY: 0.12, z: -620, sx: 480, sy: 400, tex: pillarNebulaTexture, color: '#ffffff', opacity: 0.018 },
    { screenX: 0.85, screenY: 0.12, z: -615, sx: 470, sy: 390, tex: pillarNebulaTexture, color: '#ffffff', opacity: 0.017 }
  ]

  const backdropScale = props.side === 'full' ? FULL_COSMIC_SCALE : 1
  for (const p of backdropLayers) {
    if (!p.tex) continue
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: p.tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: p.opacity,
        color: new THREE.Color(p.color)
      })
    )
    const pos = resolveScreenPos(p)
    sprite.position.set(pos.x, pos.y, p.z)
    sprite.userData.basePos = new THREE.Vector3(pos.x, pos.y, p.z)
    const bx = p.sx * backdropScale
    const by = p.sy * backdropScale
    sprite.scale.set(bx, by, 1)
    sprite.userData.baseScale = { x: bx, y: by, phase: Math.random() * Math.PI * 2 }
    tagPlacement(sprite, p)
    ambientNebulaGroup.add(sprite)
  }

  sceneRef.add(ambientNebulaGroup)
}

/** Gargantua 风格黑洞/白洞（单 Quad 引力透镜着色器，始终面向相机） */
function placeLensingHole(
  sceneRef: THREE.Scene,
  isWhite: boolean,
  placement: ScreenPlacement,
  size: number
) {
  const spin = isWhite ? -1.85 : 1.55
  const { group, material } = createGargantuaHole(isWhite, spin, size, softAlphaTexture)
  const pos = resolveScreenPos(placement)
  group.position.set(pos.x, pos.y, placement.z)
  group.userData.basePos = new THREE.Vector3(pos.x, pos.y, placement.z)
  group.userData.motionPhase = Math.random() * Math.PI * 2
  tagPlacement(group, placement)

  sceneRef.add(group)
  group.userData.baseScale = 1
  group.userData.baseSpin = spin
  if (isWhite) whiteHoleGroup = group
  else blackHoleGroup = group
  animGroups.push(group)
  return material
}

function buildScene(sceneRef: THREE.Scene) {
  softAlphaTexture = makeSoftAlphaTexture()
  nebulaSharedTexture = makeNebulaCloudTexture(42)
  orionNebulaTexture = makeOrionNebulaTexture()
  pillarNebulaTexture = makePillarNebulaTexture()
  coreTexture = makeCoreTexture(true)

  createSkyStars(sceneRef)
  createCosmicDust(sceneRef)
  createAmbientNebulae(sceneRef)

  const holeSize = props.side === 'full' ? 400 : 280
  if (props.side === 'full') {
    placeLensingHole(sceneRef, false, lensingHolePlacement(false), holeSize)
    placeLensingHole(sceneRef, true, lensingHolePlacement(true), holeSize)
  } else if (props.side === 'left') {
    placeLensingHole(sceneRef, false, lensingHolePlacement(false), holeSize)
  } else {
    placeLensingHole(sceneRef, true, lensingHolePlacement(true), holeSize)
  }

  for (const def of getGalaxyDefs()) {
    createGalaxy(def, sceneRef)
  }
  createStandaloneNebulae(sceneRef)
}

function resizeFx() {
  if (!fxCanvas.value || !rootEl.value) return
  const rect = rootEl.value.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  fxW = Math.max(1, Math.floor(rect.width))
  fxH = Math.max(1, Math.floor(rect.height))
  fxCanvas.value.width = Math.floor(fxW * dpr)
  fxCanvas.value.height = Math.floor(fxH * dpr)
  fxCanvas.value.style.width = `${fxW}px`
  fxCanvas.value.style.height = `${fxH}px`
  fxCtx = fxCanvas.value.getContext('2d')
  if (fxCtx) fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function resizeGl() {
  if (!camera || !renderer || !glCanvas.value || !rootEl.value) return
  const rect = rootEl.value.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (props.side === 'full') {
    updateFullLayoutMetrics(width, height)
    relayoutPlacedObjects()
  }
  resizeFx()
}

function rotateGalaxies(t: number, blend: number) {
  const mult = 1 + blend * 2.1
  for (const { group, rotSpeed } of galaxyGroups) {
    group.rotation.z += rotSpeed * mult
    const basePos = group.userData.basePos as THREE.Vector3 | undefined
    if (!basePos) continue
    const phase = (group.userData.motionPhase as number) ?? 0
    const zDepth = Math.max(140, Math.abs(basePos.z))
    const parallax = THREE.MathUtils.clamp(420 / zDepth, 0.28, 1.2)
    group.position.x = basePos.x + Math.sin(t * 0.12 + phase) * 3.5 * parallax * (1 + blend * 0.5)
    group.position.y = basePos.y + Math.cos(t * 0.09 + phase * 1.3) * 2.2 * parallax * (1 + blend * 0.35)
  }
}

function pulseNebulaGroup(group: THREE.Group | null, t: number, blend: number) {
  if (!group) return
  const amp = MOTION_PROFILE.nebulaPulse * (0.3 + blend * 0.7)
  for (const child of group.children) {
    const base = child.userData.baseScale as { x: number; y: number; phase: number } | undefined
    if (!base) continue
    const wobble = 1 + amp * Math.sin(t * (0.82 + (base.phase % 1) * 0.3) + base.phase)
    child.scale.set(base.x * wobble, base.y * wobble, 1)
    const basePos = child.userData.basePos as THREE.Vector3 | undefined
    if (basePos) {
      child.position.x = basePos.x + Math.sin(t * 0.05 + base.phase) * (1.1 + blend * 0.5)
      child.position.y = basePos.y + Math.cos(t * 0.04 + base.phase * 0.7) * (0.8 + blend * 0.35)
      child.position.z = basePos.z
    }
  }
}

function pulseGalaxyArmNebulae(t: number, blend: number) {
  const amp = MOTION_PROFILE.galaxyPulse * (0.35 + blend)
  for (const { group } of galaxyGroups) {
    for (const child of group.children) {
      if (!(child instanceof THREE.Sprite)) continue
      const base = child.userData.baseScale as { x: number; y: number; phase: number } | undefined
      if (!base) continue
      const wobble = 1 + amp * Math.sin(t * 1.05 + base.phase)
      child.scale.set(base.x * wobble, base.y * wobble, 1)
    }
  }
}

function animateHoles(t: number, blend: number) {
  const spinBoost = 1 + blend * 2.6
  const breathe = 1 + (0.035 + blend * 0.11) * Math.sin(t * 0.72)
  const surge = 1 + blend * (0.12 + 0.08 * Math.sin(t * 1.25))
  const tick = (g: THREE.Group | null) => {
    if (!g || !camera) return
    orientHoleToCamera(g, camera)
    const mat = g.userData.lensMat as THREE.ShaderMaterial | undefined
    if (mat) {
      mat.uniforms.uTime.value = t
      const baseSpin = (g.userData.baseSpin as number) || 1.5
      mat.uniforms.uSpin.value = baseSpin * spinBoost
    }
    animateHoleParticles(g, t, spinBoost)
    const base = (g.userData.baseScale as number) || 1
    const isWhite = g.userData.holeType === 'white'
    const basePos = g.userData.basePos as THREE.Vector3 | undefined
    const phase = (g.userData.motionPhase as number) ?? 0
    if (basePos) {
      const direction = isWhite ? 1 : -1
      const laneAmp = 3.2 + blend * 4.6
      const yAmp = 1.1 + blend * 1.2
      const zAmp = 0.45 + blend * 0.55
      g.position.x = basePos.x + direction * Math.sin(t * 0.18 + phase) * laneAmp
      g.position.y = basePos.y + Math.cos(t * 0.14 + phase * 0.8) * yAmp
      g.position.z = basePos.z + Math.sin(t * 0.1 + phase * 0.5) * zAmp
    }
    clampObjectToViewBand(g, 42)
    g.scale.setScalar(base * breathe * surge)

    const pulse = (0.9 + 0.1 * Math.sin(t * 1.05)) * (1 + blend * 0.4)
    const bloomOuter = g.userData.bloomOuter as THREE.Sprite | undefined
    const bloomInner = g.userData.bloomInner as THREE.Sprite | undefined
    if (bloomOuter?.material) bloomOuter.material.opacity = (isWhite ? 0.11 : 0.09) * pulse * (1 + blend * 0.55)
    if (bloomInner?.material) bloomInner.material.opacity = (isWhite ? 0.2 : 0.16) * pulse * (1 + blend * 0.5)
    const coreGlow = g.userData.coreGlow as THREE.Sprite | undefined
    if (coreGlow?.material) coreGlow.material.opacity = (0.24 + 0.08 * Math.sin(t * 2.4)) * pulse

    if (isWhite) {
      const jetUp = g.userData.jetUp as THREE.Sprite | undefined
      const jetDown = g.userData.jetDown as THREE.Sprite | undefined
      const jetPulse = 0.88 + 0.12 * Math.sin(t * 1.7 + phase)
      if (jetUp?.material) {
        jetUp.material.opacity = (0.1 + blend * 0.08) * jetPulse
        const baseUp = (jetUp.userData.baseScaleY as number) || jetUp.scale.y
        jetUp.scale.y = baseUp * (0.94 + 0.06 * Math.sin(t * 0.8 + phase))
      }
      if (jetDown?.material) {
        jetDown.material.opacity = (0.085 + blend * 0.065) * jetPulse
        const baseDown = (jetDown.userData.baseScaleY as number) || jetDown.scale.y
        jetDown.scale.y = baseDown * (0.93 + 0.07 * Math.cos(t * 0.85 + phase))
      }
    }
  }
  tick(blackHoleGroup)
  tick(whiteHoleGroup)
}

function maybeSpawnMeteor(now: number, blend = 0) {
  const interval = props.side === 'full' ? 0.16 - blend * 0.08 : 0.28 - blend * 0.14
  const chance = props.side === 'full' ? 0.32 + blend * 0.42 : 0.22 + blend * 0.38
  if (now - lastMeteorAt < interval || Math.random() > chance) return
  lastMeteorAt = now
  const angle = -0.75 + Math.random() * 0.65
  const speed = 10 + Math.random() * 14
  const palette = METEOR_COLORS[Math.floor(Math.random() * METEOR_COLORS.length)]
  meteors.push({
    x: Math.random() * fxW,
    y: Math.random() * fxH * 0.85,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 0,
    maxLife: 36 + Math.random() * 48,
    head: palette.head,
    mid: palette.mid,
    width: 1.8 + Math.random() * 2.2
  })
}

function drawMeteors(now: number, blend: number) {
  if (!fxCtx) return
  fxCtx.clearRect(0, 0, fxW, fxH)
  maybeSpawnMeteor(now, blend)
  maybeSpawnMeteor(now + 0.01, blend)
  if (blend > 0.35) maybeSpawnMeteor(now + 0.02, blend)
  meteors = meteors.filter((m) => {
    m.life++
    m.x += m.vx
    m.y += m.vy
    if (m.life > m.maxLife || m.x < -200 || m.x > fxW + 200 || m.y < -100 || m.y > fxH + 100) return false
    const t = 1 - m.life / m.maxLife
    const len = (120 + m.width * 25) * t
    const mag = Math.hypot(m.vx, m.vy) || 1
    const nx = m.vx / mag
    const ny = m.vy / mag
    const g = fxCtx!.createLinearGradient(m.x, m.y, m.x - nx * len, m.y - ny * len)
    g.addColorStop(0, `rgba(${m.head},${0.98 * t})`)
    g.addColorStop(0.25, `rgba(${m.mid},${0.65 * t})`)
    g.addColorStop(0.55, `rgba(${m.mid},${0.2 * t})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    fxCtx!.strokeStyle = g
    fxCtx!.lineWidth = m.width * t
    fxCtx!.lineCap = 'round'
    fxCtx!.shadowColor = `rgba(${m.head},${0.4 * t})`
    fxCtx!.shadowBlur = 10 * t
    fxCtx!.beginPath()
    fxCtx!.moveTo(m.x, m.y)
    fxCtx!.lineTo(m.x - nx * len, m.y - ny * len)
    fxCtx!.stroke()
    fxCtx!.shadowBlur = 0
    return true
  })
}

function initThree() {
  if (!glCanvas.value || !rootEl.value) return

  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x060810, props.side === 'full' ? 0.000026 : 0.00014)
  scene.background = new THREE.Color(0x060810)

  camera = new THREE.PerspectiveCamera(props.side === 'full' ? 50 : 48, 1, 0.1, 12000)

  if (props.side === 'full') {
    updateFullLayoutMetrics(rootEl.value.clientWidth || 1920, rootEl.value.clientHeight || 1080)
    camera.position.set(0, 420, 880)
    camera.lookAt(0, 0, 0)
  } else if (props.side === 'left') {
    camera.position.set(120, 520, 640)
    camera.lookAt(180, 0, -60)
  } else {
    camera.position.set(-120, 520, 640)
    camera.lookAt(-180, 0, -60)
  }

  renderer = new THREE.WebGLRenderer({
    canvas: glCanvas.value,
    alpha: false,
    antialias: true,
    powerPreference: 'high-performance'
  })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.55
  renderer.setClearColor(0x050810, 1)

  resizeGl()
  buildScene(scene)
  if (props.side === 'full') relayoutPlacedObjects()

  let lastFrame = 0
  const tick = (now: number) => {
    animationId = requestAnimationFrame(tick)
    if (!running || !renderer || !scene || !camera) return
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) * 0.001) : 0.016
    lastFrame = now
    const t = now * 0.001

    const target = props.agentThinking ? 1 : 0
    thinkingBlend.value += (target - thinkingBlend.value) * Math.min(1, dt * 5.2)
    const blend = thinkingBlend.value

    const timeMul = 1 + blend * 1.65
    if (skyMaterial) {
      skyMaterial.uniforms.uTime.value = t * timeMul
      skyMaterial.uniforms.uWarp.value = blend * 1.05
    }
    if (skyPoints) {
      const drift = 1 + blend * 2.4
      skyPoints.position.x = Math.sin(t * MOTION_PROFILE.starDriftX * drift) * MOTION_PROFILE.starDriftAmpX * (1 + blend * 1.1)
      skyPoints.position.y = Math.cos(t * MOTION_PROFILE.starDriftY * drift) * MOTION_PROFILE.starDriftAmpY * (1 + blend * 0.9)
      skyPoints.rotation.z = t * 0.007 * (0.55 + blend)
      skyPoints.rotation.y = Math.sin(t * 0.0035) * 0.018 * (1 + blend * 0.6)
    }
    if (dustPoints) {
      const drift = 1 + blend * 1.8
      dustPoints.position.x = Math.sin(t * MOTION_PROFILE.dustDriftX * drift) * MOTION_PROFILE.dustDriftAmpX * (1 + blend * 0.7)
      dustPoints.position.y = Math.cos(t * MOTION_PROFILE.dustDriftY * drift) * MOTION_PROFILE.dustDriftAmpY * (1 + blend * 0.5)
      dustPoints.rotation.z = t * 0.0022
    }

    animateHoles(t, blend)
    rotateGalaxies(t, blend)
    pulseNebulaGroup(standaloneNebulaGroup, t, blend)
    pulseNebulaGroup(ambientNebulaGroup, t, blend)
    pulseGalaxyArmNebulae(t, blend)
    renderer.render(scene, camera)
    drawMeteors(t, blend)
  }
  tick(0)
}

function cleanup() {
  running = false
  if (animationId) cancelAnimationFrame(animationId)
  resizeObserver?.disconnect()
  resizeObserver = null

  for (const g of animGroups) {
    disposeObjectDeep(g)
    scene?.remove(g)
  }
  animGroups.length = 0
  galaxyGroups.length = 0
  blackHoleGroup = null
  whiteHoleGroup = null

  if (dustPoints) {
    dustPoints.geometry.dispose()
    if (dustPoints.material) disposeMaterial(dustPoints.material as THREE.Material)
    scene?.remove(dustPoints)
    dustPoints = null
  }

  if (ambientNebulaGroup) {
    disposeObjectDeep(ambientNebulaGroup)
    scene?.remove(ambientNebulaGroup)
    ambientNebulaGroup = null
  }

  if (standaloneNebulaGroup) {
    disposeObjectDeep(standaloneNebulaGroup)
    scene?.remove(standaloneNebulaGroup)
    standaloneNebulaGroup = null
  }

  if (skyPoints) {
    skyPoints.geometry.dispose()
    skyMaterial?.dispose()
    scene?.remove(skyPoints)
    skyPoints = null
    skyMaterial = null
  }

  softAlphaTexture?.dispose()
  softAlphaTexture = null
  nebulaSharedTexture?.dispose()
  nebulaSharedTexture = null
  orionNebulaTexture?.dispose()
  orionNebulaTexture = null
  pillarNebulaTexture?.dispose()
  pillarNebulaTexture = null
  coreTexture?.dispose()
  coreTexture = null
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  fxCtx = null
  meteors = []
}

onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    return
  }
  initThree()
  if (rootEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => resizeGl())
    resizeObserver.observe(rootEl.value)
  } else {
    window.addEventListener('resize', resizeGl, { passive: true })
  }
  onVisibility = () => {
    running = !document.hidden
  }
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  if (onVisibility) document.removeEventListener('visibilitychange', onVisibility)
  cleanup()
  window.removeEventListener('resize', resizeGl)
})
</script>

<style scoped>
.cosmic-lane {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #030508;
}
.cosmic-lane-gl,
.cosmic-lane-fx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.cosmic-lane-fx {
  pointer-events: none;
}
.cosmic-lane--left .cosmic-lane-gl {
  mask-image: linear-gradient(90deg, #000 80%, transparent 100%);
}
.cosmic-lane--right .cosmic-lane-gl {
  mask-image: linear-gradient(270deg, #000 80%, transparent 100%);
}
.cosmic-lane--thinking .cosmic-lane-fx {
  filter: brightness(1.06) saturate(1.12);
  transition: filter 0.6s ease;
}
.cosmic-lane--full {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background:
    radial-gradient(ellipse 180% 150% at 50% 46%, rgba(14, 20, 48, 0.22), rgba(4, 6, 14, 0.82) 74%),
    radial-gradient(ellipse 40% 55% at 14% 48%, rgba(120, 60, 140, 0.08), transparent 62%),
    radial-gradient(ellipse 40% 55% at 86% 48%, rgba(40, 100, 160, 0.07), transparent 62%),
    radial-gradient(ellipse 70% 35% at 50% 8%, rgba(56, 189, 248, 0.04), transparent 68%),
    radial-gradient(ellipse 60% 30% at 50% 96%, rgba(167, 139, 250, 0.05), transparent 72%),
    #030508;
}
.cosmic-lane--full .cosmic-lane-gl,
.cosmic-lane--full .cosmic-lane-fx {
  mask-image: none;
}
</style>
