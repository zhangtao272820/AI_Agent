#!/usr/bin/env node
/** UI 截图验证 Live2D 是否有可见像素 */
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";
const MODELS = [
  { id: "shizuku", label: "温柔恋人" },
  { id: "epsilon", label: "成熟姐姐" },
  { id: "hiyori", label: "元气少女" },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

for (const m of MODELS) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByRole("button", { name: m.label }).first().click({ timeout: 15000 });
  await page.waitForTimeout(4500);

  const png = path.join(__dirname, `_shot-${m.id}.png`);
  await page.locator(".live2d-canvas-host").screenshot({ path: png });

  const out = execSync(
    `python -c "from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert('RGBA'); px=im.getdata(); vis=sum(1 for p in px if p[3]>20 and sum(p[:3])>30); print(vis)" "${png}"`,
    { encoding: "utf8" },
  ).trim();

  const visible = Number(out);
  console.log(`[${visible > 800 ? "OK" : "FAIL"}] ${m.id} visible_pixels=${visible}`);
  try {
    unlinkSync(png);
  } catch {
    /* ignore */
  }
}

await browser.close();
