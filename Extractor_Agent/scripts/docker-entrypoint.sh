#!/bin/sh
set -e

PORT="${CRAWLER_PORT:-13104}"

log() {
  printf '[extractor_agent] %s\n' "$*" >&2
}

# 卷里依赖已齐但上次在 install-deps 阶段被中断时，.docker-deps-ok 不会存在
bootstrap_needed() {
  if [ -f node_modules/.docker-deps-ok ]; then
    return 1
  fi
  if [ -d node_modules/nuxt ] && [ -d node_modules/playwright ] && ls /ms-playwright/chromium-* >/dev/null 2>&1; then
    log 'node_modules + Playwright 已存在，跳过重复安装'
    touch node_modules/.docker-deps-ok
    return 1
  fi
  return 0
}

if bootstrap_needed; then
  log '首次启动：安装系统依赖…'
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 \
    libwayland-client0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 \
    libxfixes3 libxkbcommon0 libxrandr2 fonts-liberation \
    >/dev/null 2>&1 || true

  log 'npm install…'
  npm install --legacy-peer-deps

  if ls /ms-playwright/chromium-* >/dev/null 2>&1; then
    log 'Playwright chromium 已缓存，跳过下载'
  else
    log 'playwright chromium（首次下载可能较慢）…'
    if ! PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST:-https://npmmirror.com/mirrors/playwright}" \
      npx playwright install chromium; then
      log '镜像源失败，尝试官方 CDN…'
      if ! PLAYWRIGHT_DOWNLOAD_HOST=https://playwright.download.prss.microsoft.com \
        npx playwright install chromium; then
        PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.playwright.dev \
          npx playwright install chromium \
          || log 'playwright chromium 全部源失败，继续无浏览器模式'
      fi
    fi
  fi

  touch node_modules/.docker-deps-ok
  log '依赖就绪'
fi

log "启动 Nuxt dev :${PORT} …"
exec npm run dev -- --host 0.0.0.0 --port "$PORT"
