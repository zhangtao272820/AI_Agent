#!/usr/bin/env node
/**
 * TTS 预生成 manifest（合成请用 Python）：
 *   node scripts/pregen-tts-cache.mjs [--dry-run]
 *   python scripts/pregen_tts_cache.py [--dry-run | --force]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const pyScript = path.join(ROOT, "scripts", "pregen_tts_cache.py");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const manifestOnly = args.includes("--manifest-only");
const force = args.includes("--force");

const pyArgs = [pyScript];
if (dryRun || manifestOnly) pyArgs.push("--dry-run");
if (force) pyArgs.push("--force");

if (!fs.existsSync(pyScript)) {
  console.error("Missing scripts/pregen_tts_cache.py");
  process.exit(1);
}

const result = spawnSync("python", pyArgs, { stdio: "inherit", cwd: ROOT });
process.exit(result.status ?? 1);
