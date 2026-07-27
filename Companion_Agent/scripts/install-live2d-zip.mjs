#!/usr/bin/env node
/**
 * 将官方下载的 ZIP（shizuku_ja.zip / epsilon_ja.zip 等）安装到 live2d/models/
 *
 * 用法：
 *   node scripts/install-live2d-zip.mjs path/to/shizuku_ja.zip
 *   node scripts/install-live2d-zip.mjs path/to/epsilon_ja.zip path/to/miara_en.zip
 *
 * ZIP 内通常有 runtime/ 目录，本脚本会把 runtime 里的文件复制到对应模型目录。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_ROOT = path.join(ROOT, "live2d", "models");

const ZIP_TO_ID = [
  { re: /shizuku/i, id: "shizuku", expect: "shizuku.model3.json" },
  { re: /epsilon/i, id: "epsilon", expect: "Epsilon.model3.json" },
  { re: /miara/i, id: "miara", expect: "miara_pro_t03.model3.json" },
  { re: /hibiki/i, id: "hibiki", expect: "Hibiki.model3.json" },
];

function guessId(zipPath) {
  const base = path.basename(zipPath);
  for (const row of ZIP_TO_ID) {
    if (row.re.test(base)) return row;
  }
  return null;
}

function findRuntimeDir(dir) {
  const direct = path.join(dir, "runtime");
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const nested = path.join(dir, ent.name, "runtime");
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) return nested;
  }

  const hasModel = entries.some((e) => e.isFile() && e.name.endsWith(".model3.json"));
  if (hasModel) return dir;
  return null;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function installZip(zipPath) {
  const meta = guessId(zipPath);
  if (!meta) {
    console.error(`✗ 无法识别 ZIP 类型: ${zipPath}`);
    console.error("  支持: shizuku / epsilon / miara / hibiki");
    return false;
  }

  if (!fs.existsSync(zipPath)) {
    console.error(`✗ 文件不存在: ${zipPath}`);
    return false;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "live2d-zip-"));
  try {
    execSync(`tar -xf "${zipPath}" -C "${tmp}"`, { stdio: "pipe" });
  } catch {
    try {
      const ps = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`;
      execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: "pipe" });
    } catch (err) {
      console.error(`✗ 解压失败: ${zipPath}`);
      console.error(err instanceof Error ? err.message : err);
      return false;
    }
  }

  const runtime = findRuntimeDir(tmp);
  if (!runtime) {
    console.error(`✗ 未找到 runtime 目录或 *.model3.json: ${zipPath}`);
    console.error("  请确认下载的是 Live2D 官方样本完整 ZIP。");
    return false;
  }

  const dest = path.join(OUT_ROOT, meta.id);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  copyTree(runtime, dest);

  const modelFiles = fs.readdirSync(dest).filter((f) => f.endsWith(".model3.json"));
  const ok = modelFiles.length > 0;
  console.log(`${ok ? "✓" : "✗"} ${meta.id} ← ${path.basename(zipPath)}`);
  console.log(`  目标: ${dest}`);
  console.log(`  model3: ${modelFiles.join(", ") || "(无)"}`);
  if (!ok) console.error("  安装后缺少 *.model3.json，请检查 ZIP 内容。");
  return ok;
}

const zips = process.argv.slice(2);
if (zips.length === 0) {
  console.log(`用法: node scripts/install-live2d-zip.mjs <zip路径> [更多zip...]

示例:
  node scripts/install-live2d-zip.mjs D:/Downloads/shizuku_ja.zip
  node scripts/install-live2d-zip.mjs D:/Downloads/epsilon_ja.zip

也可手动解压：打开 ZIP → 找到 runtime 文件夹 → 把里面所有文件复制到:
  shizuku  → Companion_Agent/live2d/models/shizuku/
  epsilon  → Companion_Agent/live2d/models/epsilon/
  miara    → Companion_Agent/live2d/models/miara/`);
  process.exit(0);
}

let ok = true;
for (const zip of zips) ok = installZip(path.resolve(zip)) && ok;
console.log(ok ? "\n完成。Docker 用户重启 companion_agent 或刷新页面即可。" : "\n部分安装失败。");
process.exit(ok ? 0 : 1);
