#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";
const MODELS = [
  ["hiyori", `${BASE}/live2d/models/hiyori/Hiyori.model3.json`],
  ["shizuku", `${BASE}/live2d/models/shizuku/shizuku.model3.json`],
  ["epsilon", `${BASE}/live2d/models/epsilon/Epsilon.model3.json`],
  ["miara", `${BASE}/live2d/models/miara/miara_pro_t03.model3.json`],
];

const html = `<!doctype html><html><head>
<script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js"></script>
<script src="${BASE}/live2dcubismcore.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi-live2d-display-lipsyncpatch@0.5.0-ls-8/dist/cubism4.min.js"></script>
</head><body><script>
window.run = async (url) => {
  window.PIXI = PIXI;
  const Live2DModel = PIXI.live2d.Live2DModel;
  const app = new PIXI.Application({ width: 700, height: 740, backgroundAlpha: 0, preserveDrawingBuffer: true });
  document.body.appendChild(app.view);
  const model = await Live2DModel.from(url, { autoUpdate: true });
  app.stage.addChild(model);
  await model.motion("Idle", 0, 1).catch(() => {});
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const im = model.internalModel;
  const info = (tag) => {
    const b = model.getBounds();
    return { tag, canvas: { w: im.width, h: im.height, ow: im.originalWidth, oh: im.originalHeight }, bounds: { x: b.x, y: b.y, w: b.width, h: b.height } };
  };
  const out = [info("raw")];
  const H = [/^PARTS_01_SKETCH$/i, /^ROUGH$/i, /^PARTS_01_BACKGROUND/i];
  const core = im.coreModel;
  let hidden = 0;
  for (let i = 0; i < core.getPartCount(); i++) {
    const id = core.getPartId(i);
    if (H.some((re) => re.test(id))) { core.setPartOpacityById(id, 0); hidden++; }
  }
  im.update(performance.now());
  await new Promise((r) => requestAnimationFrame(r));
  out.push({ ...info("hidden"), hiddenParts: hidden });
  const scales = [0.15, 0.25, 0.35, 0.5, 0.8, 1.0];
  for (const s of scales) {
    model.scale.set(s, s);
    model.anchor.set(0.5, 1);
    model.x = 350;
    model.y = 720;
    im.update(performance.now());
    app.render();
    const buf = new Uint8Array(700 * 740 * 4);
    const gl = app.view.getContext("webgl") || app.view.getContext("webgl2");
    gl.readPixels(0, 0, 700, 740, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let rgb = 0;
    for (let i = 0; i < buf.length; i += 16) if (buf[i] + buf[i + 1] + buf[i + 2] > 40) rgb++;
    out.push({ scale: s, rgbSamples: rgb, bounds: model.getBounds() });
  }
  return out;
};
</script></body></html>`;

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage();
await page.setContent(html);
await page.waitForFunction(() => typeof window.run === "function");

for (const [id, url] of MODELS) {
  try {
    const r = await page.evaluate(async (u) => window.run(u), url);
    console.log(`\n=== ${id} ===`);
    for (const row of r) console.log(JSON.stringify(row));
  } catch (e) {
    console.log(`\n=== ${id} FAIL ===`, e.message);
  }
}

await browser.close();
