#!/usr/bin/env node
/** 探测各模型 canvas 尺寸与可见 bounds（headless Chromium） */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(__dirname, "..");
const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";

const MODELS = [
  { id: "hiyori", url: "/live2d/models/hiyori/Hiyori.model3.json" },
  { id: "shizuku", url: "/live2d/models/shizuku/shizuku.model3.json" },
  { id: "epsilon", url: "/live2d/models/epsilon/Epsilon.model3.json" },
];

const cubismCore = readFileSync(path.join(FRONT, "public/live2dcubismcore.min.js"), "utf8")
  .replace(/<\/script/gi, "<\\/script");

const html = (modelUrl) => `<!doctype html><html><body>
<script>${cubismCore}</script>
<script type="module">
const HIDDEN = [/^PARTS_01_SKETCH$/i, /^ROUGH$/i, /^PARTS_01_BACKGROUND/i];

function hideBackground(core) {
  if (!core?.getPartCount) return [];
  const hidden = [];
  for (let i = 0; i < core.getPartCount(); i++) {
    const id = core.getPartId(i);
    if (HIDDEN.some((re) => re.test(id))) {
      core.setPartOpacityById(id, 0);
      hidden.push(id);
    }
  }
  return hidden;
}

function charBounds(core) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
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
}

window.__probe = async (Live2DModel, PIXI, url) => {
  const app = new PIXI.Application({ width: 400, height: 600, backgroundAlpha: 0 });
  document.body.appendChild(app.view);
  const model = await Live2DModel.from(url, { autoUpdate: true, autoInteract: false });
  app.stage.addChild(model);
  await model.motion("Idle", 0, 1).catch(() => {});
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const im = model.internalModel;
  const core = im.coreModel;
  const before = {
    canvas: { w: im.width, h: im.height, ow: im.originalWidth, oh: im.originalHeight },
    bounds: model.getBounds(),
    char: charBounds(core),
  };
  const hidden = hideBackground(core);
  im.update(performance.now());
  await new Promise((r) => requestAnimationFrame(r));
  const after = {
    bounds: model.getBounds(),
    char: charBounds(core),
    hidden,
  };
  return { before, after };
};
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const m of MODELS) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.setContent(html(m.url), { waitUntil: "load" });

  const result = await page.evaluate(async ({ url }) => {
    const PIXI = await import("https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.mjs");
    window.PIXI = PIXI;
    const { Live2DModel } = await import(
      "https://cdn.jsdelivr.net/npm/pixi-live2d-display-lipsyncpatch@0.5.0-ls-8/dist/cubism4.min.js"
    );
    return window.__probe(Live2DModel, PIXI, url);
  }, { url: `${BASE}${m.url}` });

  console.log(`\n=== ${m.id} ===`);
  console.log(JSON.stringify(result, null, 2));
}

await browser.close();
