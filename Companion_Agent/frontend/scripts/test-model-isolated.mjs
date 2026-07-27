#!/usr/bin/env node
/** 独立加载各模型（无 UI 切换），检测 WebGL 错误与可见像素 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";

const MODELS = [
  { id: "shizuku", url: `${BASE}/live2d/models/shizuku/shizuku.model3.json` },
  { id: "epsilon", url: `${BASE}/live2d/models/epsilon/Epsilon_free.model3.json` },
  { id: "hiyori", url: `${BASE}/live2d/models/hiyori/Hiyori.model3.json` },
  { id: "miara", url: `${BASE}/live2d/models/miara/miara_pro_t03.model3.json` },
];

const cubismCore = readFileSync(path.join(__dirname, "../public/live2dcubismcore.min.js"), "utf8")
  .replace(/<\/script/gi, "<\\/script");

const html = `<!doctype html><html><head>
<script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.3/dist/pixi.min.js"></script>
<script>${cubismCore}</script>
<script src="https://cdn.jsdelivr.net/npm/pixi-live2d-display-lipsyncpatch@0.5.0-ls-8/dist/cubism4.min.js"></script>
</head><body><script>
window.__run = async (modelUrl) => {
  const Live2DModel = PIXI.live2d.Live2DModel;
  await PIXI.live2d.cubism4Ready();
  const app = new PIXI.Application({
    width: 400, height: 600, backgroundAlpha: 0, preserveDrawingBuffer: true,
  });
  document.body.appendChild(app.view);
  const model = await Live2DModel.from(modelUrl, {
    autoUpdate: true, autoInteract: false, ticker: app.ticker,
  });
  app.stage.addChild(model);
  await model.motion("Idle", 0, 1).catch(() => {});
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  app.render();

  const gl = app.view.getContext("webgl2") || app.view.getContext("webgl");
  const buf = new Uint8Array(400 * 600 * 4);
  gl.readPixels(0, 0, 400, 600, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let alpha = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 12) alpha++;

  const im = model.internalModel;
  const core = im.coreModel;
  const parts = [];
  for (let i = 0; i < core.getPartCount(); i++) parts.push(core.getPartId(i));

  return {
    canvas: { w: im.width, h: im.height },
    alpha,
    bounds: model.getBounds(),
    parts: parts.slice(0, 12),
    partCount: core.getPartCount(),
    drawableCount: core.getDrawableCount(),
  };
};
</script></body></html>`;

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });

for (const m of MODELS) {
  const page = await browser.newPage();
  const glErrors = [];
  page.on("console", (msg) => {
    if (/WebGL|shader|useProgram/i.test(msg.text())) glErrors.push(msg.text());
  });

  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__run === "function");
  const result = await page.evaluate(async (url) => window.__run(url), m.url);
  const shot = await page.screenshot();
  const hash = createHash("md5").update(shot).digest("hex");
  const ok = result.alpha > 500 && glErrors.length === 0;
  console.log(`[${ok ? "OK" : "FAIL"}] ${m.id}`, {
    hash,
    glErr: glErrors.length,
    sample: glErrors.slice(0, 2),
    ...result,
  });
  await page.close();
}

await browser.close();
