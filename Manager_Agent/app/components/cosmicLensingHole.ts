import * as THREE from 'three'

export const LENSING_HOLE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** 更写实：黑洞阴影 + 光子环 + 多普勒增亮薄吸积盘 */
export const LENSING_HOLE_FRAGMENT = `
  uniform float uTime;
  uniform float uIsWhite;
  uniform float uSpin;
  uniform float uSquash;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v=0.0, a=0.5;
    for(int i=0;i<5;i++){ v += a*noise(p); p*=2.03; a*=0.52; }
    return v;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    p.y *= uSquash;
    float r = length(p);
    float a = atan(p.y, p.x);

    float shadowR = 0.19;
    if (r < shadowR) discard;

    float t = uTime * uSpin;
    float diskY = exp(-pow(p.y / 0.036, 2.0));
    float radialIn = smoothstep(shadowR + 0.01, shadowR + 0.045, r);
    float radialOut = 1.0 - smoothstep(0.82, 1.02, r);
    float diskMask = diskY * radialIn * radialOut;

    float spinPhase = a + t * (uIsWhite > 0.5 ? -1.0 : 1.0);
    float doppler = pow(max(0.0, cos(spinPhase - 0.45)), 2.5);
    float beaming = 0.45 + 1.35 * doppler;
    float turb = 0.84 + 0.22 * fbm(vec2(spinPhase * 4.8, r * 15.0 - t * 0.12));

    vec3 bhInner = vec3(1.00, 0.93, 0.75);
    vec3 bhOuter = vec3(0.98, 0.53, 0.18);
    vec3 whInner = vec3(0.95, 0.98, 1.00);
    vec3 whOuter = vec3(0.74, 0.84, 0.98);

    float rt = clamp((r - shadowR) / 0.65, 0.0, 1.0);
    vec3 diskCol = uIsWhite > 0.5 ? mix(whInner, whOuter, pow(rt, 0.7)) : mix(bhInner, bhOuter, pow(rt, 0.6));
    diskCol *= beaming * turb;

    float ringR = 0.295;
    float ring = exp(-pow((r - ringR) / 0.010, 2.0)) * 2.5 + exp(-pow((r - ringR) / 0.022, 2.0)) * 0.9;
    vec3 ringCol = uIsWhite > 0.5 ? vec3(0.82, 0.9, 1.0) : vec3(1.0, 0.84, 0.52);

    float lensHalo = exp(-pow((r - 0.36) / 0.07, 2.0)) * (0.22 + 0.18 * fbm(vec2(a * 2.0, t * 0.15)));

    vec3 col = vec3(0.0);
    float alpha = 0.0;

    float disk = diskMask * (uIsWhite > 0.5 ? 0.7 : 1.0);
    col += diskCol * disk;
    alpha = max(alpha, disk * 0.92);

    col += ringCol * ring;
    alpha = max(alpha, ring * 0.85);

    col += ringCol * lensHalo * (uIsWhite > 0.5 ? 0.55 : 0.42);
    alpha = max(alpha, lensHalo * 0.35);

    if (uIsWhite > 0.5) {
      float core = exp(-pow(r / 0.25, 2.0));
      col += vec3(0.9, 0.95, 1.0) * core * 0.24;
      alpha = max(alpha, core * 0.16);
    }

    col = min(col, vec3(4.0));
    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`

const SHADOW_FRAGMENT = `
  varying vec2 vUv;
  uniform float uSquash;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    p.y *= uSquash;
    float r = length(p);
    float Rs = 0.178;
    float core = smoothstep(Rs + 0.035, Rs - 0.02, r);
    float edge = smoothstep(Rs + 0.08, Rs + 0.02, r) * (1.0 - core);
    float alpha = core + edge * 0.35;
    if (alpha < 0.008) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
  }
`

export function createLensingHoleMaterial(isWhite: boolean, spin = 1.4): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: LENSING_HOLE_VERTEX,
    fragmentShader: LENSING_HOLE_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uIsWhite: { value: isWhite ? 1 : 0 },
      uSpin: { value: spin },
      uSquash: { value: 0.68 }
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  })
}

function createShadowDisk(size: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: LENSING_HOLE_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      uniforms: { uSquash: { value: 0.68 } },
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  mesh.scale.set(size, size * 0.72, 1)
  mesh.renderOrder = 21
  return mesh
}

function createAccretionParticles(isWhite: boolean, radius: number, count: number): THREE.Points {
  const pos = new Float32Array(count * 3)
  const col = new Float32Array(count * 3)
  const ptSize = new Float32Array(count)
  const alpha = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const t = Math.random()
    const r = radius * (0.25 + t * 0.7)
    const a = Math.random() * Math.PI * 2
    pos[i * 3] = Math.cos(a) * r
    pos[i * 3 + 1] = (Math.random() - 0.5) * radius * 0.05
    pos[i * 3 + 2] = Math.sin(a) * r * 0.25

    if (isWhite) {
      col[i * 3] = 0.88 + Math.random() * 0.12
      col[i * 3 + 1] = 0.92 + Math.random() * 0.08
      col[i * 3 + 2] = 1.0
    } else {
      const hot = Math.random()
      col[i * 3] = 1.0
      col[i * 3 + 1] = 0.42 + hot * 0.48
      col[i * 3 + 2] = 0.08 + hot * 0.3
    }
    ptSize[i] = 3.0 + Math.random() * 5.5
    alpha[i] = 0.4 + Math.random() * 0.5
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(ptSize, 1))
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1))

  return new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (520.0 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          float a = pow(smoothstep(0.5, 0.0, d), 2.0) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true
    })
  )
}

export function createGargantuaHole(
  isWhite: boolean,
  spin: number,
  size: number,
  nebulaTex: THREE.Texture | null = null
): { group: THREE.Group; material: THREE.ShaderMaterial } {
  const group = new THREE.Group()
  group.userData.holeType = isWhite ? 'white' : 'black'
  group.renderOrder = 20

  const material = createLensingHoleMaterial(isWhite, spin)

  const bloomOuter = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nebulaTex,
      color: isWhite ? 0x6699bb : 0xcc6622,
      transparent: true,
      opacity: isWhite ? 0.1 : 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  bloomOuter.scale.set(size * 1.85, size * 1.85 * 0.72, 1)
  bloomOuter.renderOrder = 16
  group.add(bloomOuter)
  group.userData.bloomOuter = bloomOuter

  const bloomInner = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nebulaTex,
      color: isWhite ? 0xbbddff : 0xff9944,
      transparent: true,
      opacity: isWhite ? 0.18 : 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  bloomInner.scale.set(size * 1.15, size * 1.15 * 0.72, 1)
  bloomInner.renderOrder = 17
  group.add(bloomInner)
  group.userData.bloomInner = bloomInner

  if (isWhite) {
    const coreGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nebulaTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    coreGlow.scale.set(size * 0.48, size * 0.48 * 0.72, 1)
    coreGlow.renderOrder = 23
    group.add(coreGlow)
    group.userData.coreGlow = coreGlow

    const jetUp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nebulaTex,
        color: 0xcfe8ff,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    jetUp.position.set(0, size * 0.42, 0)
    jetUp.scale.set(size * 0.18, size * 0.9, 1)
    jetUp.userData.baseScaleY = size * 0.9
    jetUp.renderOrder = 19
    group.add(jetUp)

    const jetDown = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: nebulaTex,
        color: 0xbddcff,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    jetDown.position.set(0, -size * 0.42, 0)
    jetDown.scale.set(size * 0.16, size * 0.78, 1)
    jetDown.userData.baseScaleY = size * 0.78
    jetDown.renderOrder = 19
    group.add(jetDown)

    group.userData.jetUp = jetUp
    group.userData.jetDown = jetDown
  }

  const particles = createAccretionParticles(isWhite, size * 0.44, isWhite ? 700 : 850)
  particles.renderOrder = 22
  group.add(particles)
  group.userData.particles = particles

  const disk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  disk.scale.set(size, size * 0.72, 1)
  disk.renderOrder = 23
  group.add(disk)

  if (!isWhite) {
    const shadow = createShadowDisk(size)
    group.add(shadow)
    group.userData.shadowDisk = shadow
  }

  group.userData.lensMat = material
  return { group, material }
}

export function animateHoleParticles(group: THREE.Group, t: number, spinBoost = 1) {
  const pts = group.userData.particles as THREE.Points | undefined
  if (!pts) return
  const base = group.userData.holeType === 'white' ? -0.42 : 0.48
  pts.rotation.z = t * base * spinBoost
}

export function orientHoleToCamera(group: THREE.Group, camera: THREE.Camera) {
  group.quaternion.copy(camera.quaternion)
}
