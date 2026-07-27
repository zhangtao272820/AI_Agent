import { onBeforeUnmount, ref, type Ref } from "vue";

export function useOceanCanvas(canvasRef: Ref<HTMLCanvasElement | null>) {
  let oceanRaf = 0;
  let oceanStop: (() => void) | null = null;
  let oceanResize: (() => void) | null = null;

  async function mountOceanCanvas() {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const THREE = await import("three");
    const {
      Scene,
      OrthographicCamera,
      WebGLRenderer,
      PlaneGeometry,
      ShaderMaterial,
      Mesh,
      Vector2,
    } = THREE;

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);

    const uniforms = {
      uTime: { value: 0 },
      uRes: { value: new Vector2(1, 1) },
    };

    const material = new ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec2 uRes;
        uniform float uTime;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 7; i++) {
            v += a * noise(p);
            p *= 2.15;
            a *= 0.5;
          }
          return v;
        }

        float ridge(vec2 p) {
          float n = noise(p);
          return 1.0 - abs(2.0 * n - 1.0);
        }

        vec3 pickBoltColor(float s) {
          float h = hash(vec2(s, 0.55));
          vec3 c1 = vec3(1.0, 0.98, 0.95);
          vec3 c2 = vec3(0.86, 0.92, 1.0);
          vec3 c3 = vec3(0.95, 0.88, 0.75);
          vec3 c4 = vec3(0.90, 0.84, 1.0);
          vec3 c5 = vec3(0.82, 0.97, 0.95);
          return h < 0.35 ? c1 : (h < 0.6 ? c2 : (h < 0.78 ? c3 : (h < 0.9 ? c4 : c5)));
        }

        float getBolt(vec2 uv, float t, float seed, float xOff, float thick) {
          vec2 p = uv;
          p.x -= xOff;
          float path = p.x;
          path += (noise(vec2(p.y * 0.8, t * 0.11 + seed)) - 0.5) * 1.4;
          path += (noise(vec2(p.y * 4.0, t * 0.7 + seed * 1.7)) - 0.5) * 0.5;
          path += (noise(vec2(p.y * 16.0, t * 1.9 + seed * 3.1)) - 0.5) * 0.15;
          float d = abs(path);
          float core = 1.0 / (d + 0.0008);
          core = pow(core, 1.15);
          float aura = exp(-d * (120.0 / (thick * 550.0)));
          float bolt = core * thick + aura * 0.65;
          for (int i = 0; i < 3; i++) {
            float k = float(i) + 1.0;
            float b = p.x + (noise(vec2(p.y * (2.0 + k * 3.0), t * (0.5 + 0.2 * k) + seed * k)) - 0.5) * (1.2 / k);
            float bd = abs(b);
            float bcore = 1.0 / (bd + 0.0015);
            bolt += bcore * (0.4 / k) * smoothstep(0.85, 0.25, abs(p.y - (0.2 + k * 0.22)));
          }
          return bolt;
        }

        void main() {
          vec2 uv = gl_FragCoord.xy / uRes;
          vec2 p = uv * 2.0 - 1.0;
          p.x *= uRes.x / uRes.y;
          float t = uTime;

          vec3 bgCol = mix(vec3(0.03, 0.05, 0.08), vec3(0.10, 0.11, 0.13), uv.y);
          vec3 col = bgCol;

          float cloud1 = fbm(uv * 1.6 + vec2(t * 0.03, 0.0));
          float cloud2 = fbm(uv * 3.2 - vec2(t * 0.02, t * 0.008));
          float cloud3 = ridge(uv * 6.0 + vec2(t * 0.012, 0.0));
          float stormCloud = smoothstep(0.22, 0.88, cloud1 * 0.45 + cloud2 * 0.35 + cloud3 * 0.25);

          float strikeCycle = fract(t * 0.09);
          float strikeIntensity = 0.0;
          float boltEffect = 0.0;
          float cloudGlowEffect = 0.0;
          vec3 boltCoreCol = vec3(1.0);
          vec3 boltGlowCol = vec3(1.0);
          if (strikeCycle > 0.91) {
            float strikeSeed = floor(t * 4.0);
            if (hash(vec2(strikeSeed, 0.83)) > 0.33) {
              float flicker = step(0.5, sin(t * 190.0)) * 0.7 + 0.3;
              strikeIntensity = flicker * smoothstep(0.91, 0.995, strikeCycle);
              float close = step(0.75, hash(vec2(strikeSeed, 0.21)));
              vec3 baseBoltCol = pickBoltColor(strikeSeed);
              vec3 coreCol = mix(vec3(1.0), baseBoltCol, 0.7);
              vec3 glowCol = baseBoltCol;
              float xOff = (hash(vec2(strikeSeed, 0.22)) > 0.5 ? 1.0 : -1.0) * (0.75 + hash(vec2(strikeSeed, 0.33)) * 0.8);
              float thick = mix(0.005, 0.015, close);
              thick *= mix(0.8, 1.3, hash(vec2(strikeSeed, 0.44)));
              float mainBolt = getBolt(p, t, strikeSeed, xOff, thick);
              boltEffect = mainBolt * strikeIntensity;
              cloudGlowEffect = max(cloudGlowEffect, strikeIntensity * (1.4 - length(p - vec2(xOff, 0.45)) * 0.7));
              float farBand = smoothstep(0.52, 0.94, uv.y);
              strikeIntensity *= farBand * 0.65;
              boltEffect *= farBand * 0.65;
              cloudGlowEffect *= farBand * 0.65;
              boltCoreCol = coreCol;
              boltGlowCol = glowCol;
            }
          }

          vec3 cloudBaseCol = vec3(0.12, 0.14, 0.18);
          vec3 cloudLitCol = vec3(0.9, 0.93, 1.0);
          vec3 currentCloudCol = mix(cloudBaseCol, cloudLitCol, cloudGlowEffect);
          float cloudEdge = fbm(uv * 1.5 + vec2(t * 0.03, 0.0) + vec2(0.015, 0.015));
          float cloudShade = smoothstep(0.2, 0.85, cloudEdge);
          currentCloudCol *= (0.68 + 0.55 * cloudShade);
          col = mix(col, currentCloudCol, stormCloud * 0.9);

          col += boltCoreCol * boltEffect * 0.95;
          col += boltGlowCol * strikeIntensity * 0.4;

          float gust = mix(-0.35, -0.15, fbm(vec2(t * 0.18, 0.0)));
          for (float i = 0.0; i < 6.0; i++) {
            float rainScale = 28.0 + i * 16.0;
            vec2 rUv = uv * vec2(rainScale, 1.0);
            float rainSpeed = 6.5 + i * 4.2;
            rUv.x += rUv.y * gust;
            rUv.y -= t * rainSpeed + hash(vec2(floor(rUv.x), i)) * 10.0;
            float isRain = smoothstep(0.68, 1.0, hash(floor(rUv) + vec2(i, 0.66)));
            float w = mix(0.06, 0.02, i / 6.0);
            float line = smoothstep(w, 0.0, abs(fract(rUv.x) - 0.5));
            float tail = smoothstep(0.35, 0.0, abs(fract(rUv.y) - 0.5));
            float rainLighting = line * tail * (0.55 + 0.15 * strikeIntensity);
            col += vec3(0.62, 0.7, 0.85) * isRain * rainLighting * (0.55 / (i + 1.0));
          }

          float vig = smoothstep(2.5, 0.7, length(uv - 0.5));
          col *= vig;

          float desat = mix(0.22, 0.06, clamp(strikeIntensity * 3.5, 0.0, 1.0));
          float g = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(col, vec3(g), desat);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const geo = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geo, material);
    scene.add(mesh);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      renderer.setPixelRatio(dpr);
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      uniforms.uRes.value.set(w * dpr, h * dpr);
    };

    const render = (ts: number) => {
      uniforms.uTime.value = ts * 0.001;
      renderer.render(scene, camera);
      oceanRaf = window.requestAnimationFrame(render);
    };

    resize();
    oceanResize = resize;
    oceanStop = () => {
      if (oceanRaf) window.cancelAnimationFrame(oceanRaf);
      oceanRaf = 0;
      geo.dispose();
      material.dispose();
      renderer.dispose();
    };
    oceanRaf = window.requestAnimationFrame(render);
    window.addEventListener("resize", resize);
  }

  onBeforeUnmount(() => {
    if (oceanResize) window.removeEventListener("resize", oceanResize);
    oceanResize = null;
    if (oceanStop) oceanStop();
    oceanStop = null;
  });

  return { mountOceanCanvas };
}

export function useOceanCanvasRef() {
  const oceanCanvas = ref<HTMLCanvasElement | null>(null);
  const { mountOceanCanvas } = useOceanCanvas(oceanCanvas);
  return { oceanCanvas, mountOceanCanvas };
}
