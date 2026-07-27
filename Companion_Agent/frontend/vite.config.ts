import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../data");
const BACKEND = "http://127.0.0.1:13115";

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function buildLocalPresets() {
  const roleData = readJson<{ bases?: unknown[] }>(path.join(DATA_ROOT, "model_roles.json"));
  const presets = readJson<unknown[]>(path.join(DATA_ROOT, "presets.json")) ?? [];
  const voiceCatalog = readJson<{ voices?: unknown[]; default_voice?: string }>(
    path.join(DATA_ROOT, "voice_catalog.json"),
  );
  const relationshipStages = readJson<{ stages?: unknown[] }>(
    path.join(DATA_ROOT, "relationship_stages.json"),
  );

  return {
    presets,
    character_bases: roleData?.bases ?? [],
    relationship_stages: relationshipStages?.stages ?? [],
    voices: voiceCatalog?.voices ?? [],
    tts_enabled: true,
    avatar_mode: "sprite",
    daily_ap_enabled: true,
    daily_ap_max: 3,
    tts_browser_fallback: false,
  };
}

async function fetchBackend(pathname: string, timeoutMs = 700): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${BACKEND}${pathname}`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

function devApiFallback(): Plugin {
  return {
    name: "dev-api-fallback",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (req.method !== "GET" || !url.startsWith("/api/")) return next();

        const backend = await fetchBackend(url);
        if (backend) {
          const body = Buffer.from(await backend.arrayBuffer());
          res.statusCode = backend.status;
          res.setHeader("Content-Type", backend.headers.get("content-type") ?? "application/json");
          res.end(body);
          return;
        }

        if (url === "/api/presets") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(buildLocalPresets()));
          return;
        }

        if (url === "/api/health") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, offline: true, note: "后端未启动；立绘由 /api/sprites 提供" }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApiFallback()],
  server: {
    port: 5175,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
    },
  },
});
