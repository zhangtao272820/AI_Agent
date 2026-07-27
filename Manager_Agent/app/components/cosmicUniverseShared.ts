import * as THREE from 'three'

/** 星空点着色器（Hubble 深空场风格：白/蓝/黄星） */
export const STAR_VERTEX = `
  attribute float size;
  attribute float alpha;
  attribute float twinkleSpeed;
  attribute float twinklePhase;
  uniform float uTime;
  uniform float uWarp;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkleSpeed;
  varying float vTwinklePhase;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vTwinkleSpeed = twinkleSpeed;
    vTwinklePhase = twinklePhase;
    vec3 p = position;
    float w = uWarp;
    p.x += sin(uTime * twinkleSpeed * 0.42 + twinklePhase) * w * 32.0;
    p.y += cos(uTime * twinkleSpeed * 0.36 + twinklePhase * 1.25) * w * 20.0;
    p.z += sin(uTime * twinkleSpeed * 0.5 + twinklePhase * 0.8) * w * 26.0;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    float dist = max(0.001, -mvPosition.z);
    gl_PointSize = size * (920.0 / dist);
    gl_Position = projectionMatrix * mvPosition;
  }
`

export const STAR_FRAGMENT = `
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vTwinkleSpeed;
  varying float vTwinklePhase;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float core = pow(smoothstep(0.5, 0.0, d), 1.75);
    float halo = smoothstep(0.5, 0.05, d) * 0.75;
    float tw = 0.5 + 0.5 * sin(uTime * vTwinkleSpeed + vTwinklePhase);
    float shimmer = 0.82 + 0.18 * sin(uTime * (vTwinkleSpeed * 1.5) + vTwinklePhase * 1.2);
    float a = (core + halo) * vAlpha * tw * shimmer;
    gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0));
  }
`

export const POINT_VERTEX = `
  attribute float size;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.001, -mvPosition.z);
    gl_PointSize = size * (520.0 / dist);
    gl_Position = projectionMatrix * mvPosition;
  }
`

/** RAG 同款：smoothstep + pow 叠加增亮，旋臂重叠处自然发光 */
export const POINT_FRAGMENT = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = smoothstep(0.5, 0.0, d);
    a = pow(a, 2.2);
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`

/** 吸积盘 — 参照 M87* / GRMHD：多普勒增亮、红移侧 */
export const ACCRETION_VERTEX = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const ACCRETION_FRAGMENT = `
  uniform float uTime;
  uniform float uSpin;
  uniform vec3 uHotColor;
  uniform vec3 uCoolColor;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float a = atan(c.y, c.x);
    float inner = 0.22;
    float outer = 0.98;
    if (r < inner || r > outer) discard;
    float spin = a + uTime * uSpin;
    float doppler = 0.5 + 0.5 * cos(spin);
    float turbulence = sin(spin * 5.0 + uTime * 1.8) * 0.08 + sin(spin * 11.0 - uTime * 2.4) * 0.04;
    float band = smoothstep(inner, inner + 0.12, r) * (1.0 - smoothstep(outer - 0.08, outer, r));
    float t = (r - inner) / (outer - inner);
    vec3 hot = uHotColor;
    vec3 cool = uCoolColor;
    vec3 col = mix(hot, cool, pow(t, 0.65));
    col *= (0.55 + 0.85 * doppler) + turbulence;
    col += vec3(1.0, 0.92, 0.75) * pow(1.0 - abs(sin(spin * 2.0)), 12.0) * 0.35 * band;
    float alpha = band * (0.75 + 0.25 * doppler);
    gl_FragColor = vec4(col, alpha);
  }
`

/** 光子环 / 爱因斯坦环 */
export const PHOTON_RING_FRAGMENT = `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    float ring = exp(-pow((r - 0.72) / 0.028, 2.0)) * 1.4;
    ring += exp(-pow((r - 0.68) / 0.045, 2.0)) * 0.35;
    float pulse = 0.88 + 0.12 * sin(uTime * 2.2);
    float alpha = ring * pulse;
    gl_FragColor = vec4(uColor * ring * pulse, alpha);
  }
`

export function randomNormal() {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function makeSoftAlphaTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.08, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.42)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.1)')
  g.addColorStop(0.78, 'rgba(255,255,255,0.025)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

/** Hubble 深空场 / 猎户座星云风格 — 有机云气纹理 */
export function makeNebulaCloudTexture(seed = 0) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, size, size)

  const rng = (n: number) => {
    const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453
    return x - Math.floor(x)
  }

  const blobs: { x: number; y: number; r: number; hue: number; sat: number; light: number; alpha: number }[] = []
  for (let i = 0; i < 28; i++) {
    blobs.push({
      x: rng(i * 3) * size,
      y: rng(i * 3 + 1) * size,
      r: 60 + rng(i * 3 + 2) * 180,
      hue: rng(i * 7) * 360,
      sat: 35 + rng(i * 7 + 1) * 55,
      light: 35 + rng(i * 7 + 2) * 35,
      alpha: 0.04 + rng(i * 11) * 0.12
    })
  }

  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
    const c = `hsla(${b.hue},${b.sat}%,${b.light}%,`
    g.addColorStop(0, `${c}${b.alpha})`)
    g.addColorStop(0.35, `${c}${b.alpha * 0.55})`)
    g.addColorStop(0.7, `${c}${b.alpha * 0.15})`)
    g.addColorStop(1, `${c}0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

/** 猎户座 M42 / 鹰状星云 — 粉紫 + 青蓝 H-alpha 风 */
export function makeOrionNebulaTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, size, size)

  const layers = [
    { x: 0.42, y: 0.48, r: 0.55, color: 'rgba(180,60,120,', a: 0.14 },
    { x: 0.58, y: 0.52, r: 0.48, color: 'rgba(220,80,140,', a: 0.1 },
    { x: 0.35, y: 0.38, r: 0.35, color: 'rgba(60,120,220,', a: 0.08 },
    { x: 0.65, y: 0.42, r: 0.3, color: 'rgba(80,160,240,', a: 0.07 },
    { x: 0.5, y: 0.55, r: 0.65, color: 'rgba(140,50,100,', a: 0.06 },
    { x: 0.48, y: 0.35, r: 0.25, color: 'rgba(255,200,180,', a: 0.05 }
  ]

  for (const l of layers) {
    const cx = l.x * size
    const cy = l.y * size
    const rad = l.r * size
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, `${l.color}${l.a})`)
    g.addColorStop(0.4, `${l.color}${l.a * 0.5})`)
    g.addColorStop(0.75, `${l.color}${l.a * 0.12})`)
    g.addColorStop(1, `${l.color}0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

/** 创生之柱 / 鹰状 — 暖褐 + 橙红尘埃 */
export function makePillarNebulaTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0)'
  ctx.fillRect(0, 0, size, size)

  const pillars = [
    { x: 0.3, y: 0.5, w: 0.08, h: 0.6, color: 'rgba(120,80,50,' },
    { x: 0.5, y: 0.45, w: 0.1, h: 0.65, color: 'rgba(140,90,55,' },
    { x: 0.7, y: 0.52, w: 0.07, h: 0.55, color: 'rgba(100,70,45,' }
  ]

  for (const p of pillars) {
    const cx = p.x * size
    const cy = p.y * size
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.w * size * 2)
    g.addColorStop(0, `${p.color}0.12)`)
    g.addColorStop(0.5, `${p.color}0.06)`)
    g.addColorStop(1, `${p.color}0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }

  const glow = ctx.createRadialGradient(size * 0.5, size * 0.3, 0, size * 0.5, size * 0.3, size * 0.45)
  glow.addColorStop(0, 'rgba(255,180,100,0.08)')
  glow.addColorStop(0.5, 'rgba(200,100,60,0.04)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

export function makeCoreTexture(warm = false) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  if (warm) {
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.15, 'rgba(255,248,240,0.98)')
    g.addColorStop(0.4, 'rgba(255,220,180,0.5)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
  } else {
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.2, 'rgba(230,240,255,0.85)')
    g.addColorStop(0.55, 'rgba(120,160,255,0.2)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  return tex
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (!material) return
  const list = Array.isArray(material) ? material : [material]
  for (const m of list) {
    if ('map' in m && m.map) (m.map as THREE.Texture).dispose()
    m.dispose()
  }
}

export function disposeObjectDeep(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh & THREE.Points & THREE.Sprite
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) disposeMaterial(mesh.material as THREE.Material | THREE.Material[])
  })
}

export function createPointMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true
  })
}

/** RAG 同款螺旋星系粒子填充：尘埃带 / 星族混合 / 旋臂着色 */
export interface GalaxySpiralFillParams {
  offset: number
  count: number
  radius: number
  arms: number
  twist: number
  armSpread: number
  armTightness: number
  flatten: number
  diskThickness: number
  bulgeRadius?: number
  innerColor: THREE.Color
  outerColor: THREE.Color
  armTints: THREE.Color[]
  isDust?: boolean
}

export function fillGalaxySpiral(
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  alphas: Float32Array,
  params: GalaxySpiralFillParams
) {
  const {
    offset,
    count,
    radius,
    arms,
    twist,
    armSpread,
    armTightness,
    flatten,
    diskThickness,
    bulgeRadius = radius * 0.55,
    innerColor,
    outerColor,
    armTints,
    isDust = false
  } = params

  const dustLaneOffset = -0.18
  const dustLaneWidth = 0.13
  const tempColor = new THREE.Color()
  const warmStar = new THREE.Color('#ffb788')
  const coolStar = new THREE.Color('#9ad6ff')
  const neutralStar = new THREE.Color('#ffffff')
  const redGiant = new THREE.Color('#ff6b6b')
  const white = new THREE.Color('#ffffff')

  for (let i = 0; i < count; i++) {
    const idx = offset + i
    const isBulge = !isDust && Math.random() < 0.24
    const radiusBase = isBulge ? bulgeRadius : radius
    const radiusPow = isBulge ? 0.55 : isDust ? 1.65 : 1.85
    const r = Math.pow(Math.random(), radiusPow) * radiusBase

    const armIndex = Math.floor(Math.random() * arms)
    const baseAngle = (armIndex / arms) * Math.PI * 2
    const spiralAngle = r * twist
    const spreadMul = isDust ? 0.85 : 1
    const angleJitter = randomNormal() * armSpread * spreadMul * (0.35 + 0.65 * (1 - r / radius))
    const angle = baseAngle + spiralAngle + angleJitter

    const tightness = isDust ? armTightness * 1.15 : armTightness
    const armDensity = Math.exp(-0.5 * Math.pow(angleJitter / tightness, 2))

    let laneFactor = 1
    if (!isDust) {
      const lane = Math.exp(-0.5 * Math.pow((angleJitter - dustLaneOffset) / dustLaneWidth, 2))
      laneFactor = 1 - 0.65 * lane * (0.25 + 0.75 * (1 - r / radius))
    }

    const noiseScale = isDust ? 0.03 : 0.014
    positions[idx * 3] = Math.cos(angle) * r + randomNormal() * (r * noiseScale)
    positions[idx * 3 + 1] =
      Math.sin(angle) * r * flatten +
      randomNormal() * (r * noiseScale) +
      randomNormal() * diskThickness * (isBulge ? 0.75 : 1) * (0.25 + 0.75 * (1 - r / radius))
    positions[idx * 3 + 2] = randomNormal() * (radius * 0.012)

    const t = Math.min(1, r / radius)

    if (isDust) {
      tempColor.copy(armTints[(armIndex + Math.floor(Math.random() * 2)) % armTints.length])
      tempColor.lerp(white, 0.08 + Math.random() * 0.08)
      tempColor.multiplyScalar((0.22 + 0.55 * armDensity) * (0.55 + 0.45 * (1 - t)))
    } else {
      tempColor.copy(innerColor).lerp(outerColor, t * t)
      const hsl = { h: 0, s: 0, l: 0 }
      tempColor.getHSL(hsl)
      tempColor.setHSL(
        hsl.h + (Math.random() - 0.5) * 0.08,
        Math.min(1, hsl.s * (0.8 + Math.random() * 0.5)),
        Math.min(1, hsl.l * (0.92 + Math.random() * 0.22))
      )

      const tempPick = Math.random()
      let starTemp = neutralStar
      if (tempPick < 0.12) starTemp = redGiant
      else if (tempPick < 0.32) starTemp = warmStar
      else if (tempPick < 0.58) starTemp = neutralStar
      else starTemp = coolStar

      tempColor.lerp(starTemp, isBulge ? 0.12 : 0.35)

      if (!isBulge) {
        const armTint = armTints[armIndex % armTints.length]
        tempColor.lerp(armTint, Math.min(0.55, armDensity * (0.18 + 0.55 * (1 - t))))
      }

      tempColor.multiplyScalar((isBulge ? 0.95 : 0.65 + 0.35 * armDensity) * laneFactor)
    }

    colors[idx * 3] = tempColor.r
    colors[idx * 3 + 1] = tempColor.g
    colors[idx * 3 + 2] = tempColor.b

    if (isDust) {
      sizes[idx] = (6 + Math.random() * 18) * (1.05 - 0.45 * t)
      alphas[idx] = Math.min(0.55, (0.12 + 0.38 * armDensity) * (0.65 + Math.random() * 0.35))
    } else {
      const sizeBase = isBulge ? 8.5 : 4.2
      const sparkle = 1 + Math.pow(Math.random(), 10) * 3.5
      sizes[idx] = (sizeBase + Math.random() * (isBulge ? 6 : 5)) * (1.05 - 0.45 * t) * sparkle
      const alphaBase = isBulge ? 0.82 : 0.74
      alphas[idx] = Math.min(1, Math.max(0.05, alphaBase * (0.6 + 0.4 * armDensity) * laneFactor * (0.75 + Math.random() * 0.25)))
    }
  }
}
