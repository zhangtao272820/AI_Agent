#!/usr/bin/env node
/**
 * 直接加载 model3.json 探测 canvas/角色 bounds（不依赖 UI）。
 * cd frontend && node scripts/verify-live2d-bounds.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(__dirname, "..");
const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";

const MODELS = [
  { id: "hiyori", url: `${BASE}/live2d/models/hiyori/Hiyori.model3.json` },
  { id: "shizuku", url: `${BASE}/live2d/models/shizuku/shizuku.model3.json` },
  { id: "epsilon", url: `${BASE}/live2d/models/epsilon/Epsilon.model3.json` },
];

const cubismCore = readFileSync(path.join(FRONT, "public/live2dcubismcore.min.js"), "utf8")
  .replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html><html><head>
<script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pixi-live2d-display-lipsyncpatch@0.5.0-ls-8/dist/cubism4.min.js"></script>
<script>${cubismCore}</script>
</head><body><script>
window.__run = async (modelUrl) => {
  const HIDDEN = [/^PARTS_01_SKETCH$/i, /^ROUGH$/i, /^PARTS_01_BACKGROUND/i];
  const hide = (core) => {
    for (let i = 0; i < core.getPartCount(); i++) {
      const id = core.getPartId(i);
      if (HIDDEN.some((re) => re.test(id))) core.setPartOpacityById(id, 0);
    }
  };
  const charBounds = (core) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, found = false;
    for (let i = 0; i < core.getDrawableCount(); i++) {
      const pi = core.getDrawableParentPartIndex(i);
      if (pi >= 0) {
        const pid = core.getPartId(pi);
        if (HIDDEN.some((re) => re.test(pid))) continue;
        if (core.getPartOpacityByIndex(pi) <= 0.01) continue;
      }
      const v = core.getDrawableVertices(i);
      for (let j = 0; j < v.length; j += 2) {
        minX = Math.min(minX, v[j]); maxX = Math.max(maxX, v[j]);
        minY = Math.min(minY, v[j + 1]); maxY = Math.max(maxY, v[j + 1]);
        found = true;
      }
    }
    return found ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY } : null;
  };

  const Live2DModel = PIXI.live2d.Live2DModel;
  const app = new PIXI.Application({ width: 400, height: 600, backgroundAlpha: 0, preserveDrawingBuffer: true });
  document.body.appendChild(app.view);
  const model = await Live2DModel.from(modelUrl, { autoUpdate: true, autoInteract: false });
  app.stage.addChild(model);
  await model.motion("Idle", 0, 1).catch(() => {});
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const im = model.internalModel;
  const before = { canvas: { w: im.width, h: im.height }, char: charBounds(im.coreModel), bounds: model.getBounds() };
  hide(im.coreModel);
  im.update(performance.now());
  await new Promise((r) => requestAnimationFrame(r));
  const afterChar = charBounds(im.coreModel);
  const b = model.getBounds();

  const scale = Math.min((400 * 0.72) / afterChar.w, (600 * 0.94) / afterChar.h) * 1.15;
  model.scale.set(scale, scale);
  model.anchor.set(0.5, 1);
  model.x = 200;
  model.y = 580;
  im.update(performance.now());
  await new Promise((r) => requestAnimationFrame(r));
  app.render();

  const gl = app.view.getContext("webgl2") || app.view.getContext("webgl");
  const buf = new Uint8Array(400 * 600 * 4);
  gl.readPixels(0, 0, 400, 600, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let alpha = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 12) alpha++;

  return { before, afterChar, bounds: { x: b.x, y: b.y, w: b.width, h: b.height }, alpha, scale };
};
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const m of MODELS) {
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__run === "function");
  const result = await page.evaluate(async (url) => window.__run(url), m.url);
  const ok = result.afterChar && result.afterChar.w > 50 && result.alpha > 500;
  console.log(`[${ok ? "OK" : "FAIL"}] ${m.id}`, JSON.stringify(result, null, 2));
}

await browser.close();
