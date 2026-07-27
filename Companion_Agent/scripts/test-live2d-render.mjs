#!/usr/bin/env node
/**
 * 浏览器实测 Live2D 模型能否渲染（需先启动 companion 服务）。
 * node scripts/test-live2d-render.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";
const MODELS = [
  { id: "hiyori", url: "/live2d/models/hiyori/Hiyori.model3.json" },
  { id: "shizuku", url: "/live2d/models/shizuku/shizuku.model3.json" },
  { id: "epsilon", url: "/live2d/models/epsilon/Epsilon.model3.json" },
];

const html = (modelUrl) => `<!doctype html><html><body>
<script src="/live2dcubismcore.min.js"></script>
<script type="module">
import * as PIXI from "https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.mjs";
import { Live2DModel } from "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js";
window.PIXI = PIXI;
const app = new PIXI.Application({ width: 400, height: 600, backgroundAlpha: 0 });
document.body.appendChild(app.view);
const logs = [];
window.__result = { logs };
try {
  const model = await Live2DModel.from("${modelUrl}", { autoUpdate: true });
  app.stage.addChild(model);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const b = model.getBounds();
  window.__result.ok = true;
  window.__result.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  window.__result.size = { w: model.internalModel?.width, h: model.internalModel?.height };
} catch (e) {
  window.__result.ok = false;
  window.__result.error = String(e?.message || e);
}
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleLogs = [];
page.on("console", (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => consoleLogs.push(`[pageerror] ${err.message}`));

for (const m of MODELS) {
  consoleLogs.length = 0;
  await page.setContent(html(m.url), { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const result = await page.evaluate(() => window.__result);
  console.log(`\n=== ${m.id} ===`);
  console.log(JSON.stringify(result, null, 2));
  const errs = consoleLogs.filter((l) => /error|warn|moc|cubism/i.test(l));
  if (errs.length) console.log("console:", errs.slice(0, 8).join("\n"));
}

await browser.close();
