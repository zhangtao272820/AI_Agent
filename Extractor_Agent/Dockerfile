# Extractor_Agent 生产镜像（Nuxt 4 + Playwright Chromium）
# build context = Agent 仓库根目录（含 shared/）
# 运行时基于 Node 镜像 + npmmirror 安装浏览器，避免 mcr.microsoft.com 拉取失败
ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-bullseye
ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ARG DEBIAN_APT_MIRROR=mirrors.aliyun.com
ARG DEFAULT_PORT=13104
ARG PLAYWRIGHT_VERSION=1.59.1

FROM ${NODE_BASE_IMAGE} AS build
WORKDIR /app
ARG NPM_CONFIG_REGISTRY
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY} \
    NUXT_TELEMETRY_DISABLED=1
COPY Extractor_Agent/package.json Extractor_Agent/package-lock.json ./
RUN npm ci --legacy-peer-deps --include=dev 2>/dev/null || npm install --legacy-peer-deps
COPY shared ./agent-repo-shared
COPY Extractor_Agent/ .
# 再次覆盖：防止 Extractor_Agent 内本地 junction 把目录换成文件
COPY shared ./agent-repo-shared
ENV NODE_ENV=production
RUN npm run build

FROM ${NODE_BASE_IMAGE} AS runtime
WORKDIR /app
ARG DEFAULT_PORT
ARG NPM_CONFIG_REGISTRY
ARG PLAYWRIGHT_VERSION
ARG DEBIAN_APT_MIRROR
ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    NITRO_HOST=0.0.0.0 \
    PORT=${DEFAULT_PORT} \
    NITRO_PORT=${DEFAULT_PORT} \
    CRAWLER_PORT=${DEFAULT_PORT} \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}

COPY --from=build /app/node_modules/playwright ./node_modules/playwright
COPY --from=build /app/node_modules/playwright-core ./node_modules/playwright-core

RUN set -eux; \
  printf '%s\n' 'Acquire::Retries "8";' 'Acquire::http::Timeout "120";' > /etc/apt/apt.conf.d/80-retries; \
  install_browser_stack() { \
    node node_modules/playwright/cli.js install-deps chromium; \
    apt-get install -y --no-install-recommends chromium; \
    test -x /usr/bin/chromium || test -x /usr/bin/chromium-browser; \
  }; \
  ok=0; \
  for mirror in ${DEBIAN_APT_MIRROR} mirrors.tuna.tsinghua.edu.cn mirrors.ustc.edu.cn deb.debian.org; do \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      if [ -f "$f" ]; then \
        sed -i "s|deb.debian.org|${mirror}|g; s|security.debian.org|${mirror}|g; s|mirrors.aliyun.com|${mirror}|g; s|mirrors.tuna.tsinghua.edu.cn|${mirror}|g; s|mirrors.ustc.edu.cn|${mirror}|g" "$f"; \
      fi; \
    done; \
    echo "try apt mirror: ${mirror}"; \
    apt-get update || continue; \
    n=0; \
    until install_browser_stack; do \
      n=$((n + 1)); \
      if [ "$n" -ge 4 ]; then break; fi; \
      echo "browser stack install retry ${n} on ${mirror}"; \
      apt-get update || true; \
      sleep 12; \
    done; \
    if [ "$n" -lt 4 ]; then ok=1; break; fi; \
  done; \
  [ "$ok" -eq 1 ]; \
  if [ -x /usr/bin/chromium-browser ] && [ ! -e /usr/bin/chromium ]; then ln -s /usr/bin/chromium-browser /usr/bin/chromium; fi; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.output ./.output
COPY --from=build /app/patches ./patches
EXPOSE ${DEFAULT_PORT}
HEALTHCHECK --interval=15s --timeout=8s --start-period=90s --retries=8 \
  CMD node -e "const p=process.env.CRAWLER_PORT||process.env.PORT||13104;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
