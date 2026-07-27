#!/usr/bin/env node
/**
 * 检查 Live2D 模型文件完整性（不依赖浏览器）。
 * 用法：node scripts/inspect-live2d-models.mjs [modelId...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MODELS = path.join(ROOT, "live2d", "models");

function collectRefs(value, out) {
  if (value == null) return;
  if (typeof value === "string") {
    if (/\.(json|png|moc3)$/i.test(value)) out.add(value.replace(/\\/g, "/"));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) collectRefs(v, out);
  }
}

function inspectModel(id) {
  const dir = path.join(MODELS, id);
  if (!fs.existsSync(dir)) return { id, ok: false, error: "目录不存在" };

  const modelFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".model3.json"));
  if (modelFiles.length === 0) return { id, ok: false, error: "缺少 *.model3.json" };

  const modelPath = path.join(dir, modelFiles[0]);
  const json = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  const refs = new Set([modelFiles[0]]);
  const fileRefs = { ...(json?.FileReferences ?? {}) };
  delete fileRefs.Expressions;
  collectRefs(fileRefs, refs);
  for (const expr of json?.FileReferences?.Expressions ?? []) {
    if (expr?.File) refs.add(String(expr.File).replace(/\\/g, "/"));
  }

  const missing = [];
  for (const rel of refs) {
    const dest = path.join(dir, rel);
    if (!fs.existsSync(dest)) missing.push(rel);
  }

  const moc = json?.FileReferences?.Moc;
  const mocPath = moc ? path.join(dir, moc) : null;
  const mocSize = mocPath && fs.existsSync(mocPath) ? fs.statSync(mocPath).size : 0;
  const mocHead = mocPath && fs.existsSync(mocPath) ? fs.readFileSync(mocPath).subarray(0, 8) : null;

  return {
    id,
    ok: missing.length === 0,
    model: modelFiles[0],
    refs: refs.size,
    missing,
    moc,
    mocSize,
    mocVersion: mocHead ? mocHead.readUInt32LE(4) : null,
    hasPose: Boolean(json?.FileReferences?.Pose),
    motionGroups: Object.keys(json?.FileReferences?.Motions ?? {}),
  };
}

const ids = process.argv.slice(2);
const targets = ids.length ? ids : ["shizuku", "epsilon", "hiyori", "haru", "mao"];

for (const id of targets) {
  const row = inspectModel(id);
  const flag = row.ok ? "OK" : "FAIL";
  console.log(`[${flag}] ${id}`);
  if (row.error) console.log(`  error: ${row.error}`);
  else {
    console.log(`  model=${row.model} refs=${row.refs} moc=${row.moc} (${row.mocSize} bytes, v${row.mocVersion})`);
    console.log(`  motions=${row.motionGroups.join(",")} pose=${row.hasPose}`);
    if (row.missing.length) console.log(`  missing: ${row.missing.join(", ")}`);
  }
}
