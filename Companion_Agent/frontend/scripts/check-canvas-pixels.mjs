#!/usr/bin/env node
import { chromium } from "playwright";
import { writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.COMPANION_URL || "http://127.0.0.1:13115";

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

for (const label of ["元气少女", "温柔恋人", "成熟姐姐", "奇幻精灵"]) {
  await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: "networkidle" });
  try {
    await page.getByRole("button", { name: label }).first().click({ timeout: 8000 });
  } catch {
    console.log(`[SKIP] ${label} (button not found)`);
    continue;
  }
  await page.waitForTimeout(5000);
  const png = path.join(__dirname, "_canvas.png");
  await page.locator(".live2d-canvas-host canvas").screenshot({ path: png });
  const vis = execSync(
    `python -c "from PIL import Image; im=Image.open(r'${png.replace(/\\/g, "/")}').convert('RGBA'); print(sum(1 for p in im.getdata() if p[3]>20 and sum(p[:3])>40))"`,
    { encoding: "utf8" },
  ).trim();
  console.log(`[${Number(vis) > 5000 ? "OK" : "FAIL"}] ${label} visible_pixels=${vis}`);
  try {
    unlinkSync(png);
  } catch {
    /* ignore */
  }
}

await browser.close();
