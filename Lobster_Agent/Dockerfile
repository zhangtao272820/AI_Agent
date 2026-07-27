# build context = Agent 仓库根目录（含 shared/）
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Install GUI bridge utilities for remote viewing in Docker:
# - xvfb/fluxbox: virtual display + window manager for headed Chromium
# - x11vnc + novnc/websockify: browser-based remote view
USER root
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC
RUN apt-get update \
    && sed -i 's|http://archive.ubuntu.com/ubuntu/|https://archive.ubuntu.com/ubuntu/|g; s|http://security.ubuntu.com/ubuntu/|https://security.ubuntu.com/ubuntu/|g' /etc/apt/sources.list \
    && apt-get update -o Acquire::Retries=5 -o Acquire::https::Timeout=30 \
    && apt-get install -y --no-install-recommends xvfb fluxbox x11vnc novnc websockify x11-utils \
    && rm -rf /var/lib/apt/lists/*

# 以 pwuser 安装依赖，避免后续 chown -R 整个 node_modules（Windows Docker 上极慢）
RUN chown pwuser:pwuser /app
COPY --chown=pwuser:pwuser Lobster_Agent/package.json Lobster_Agent/package-lock.json /app/
USER pwuser
RUN npm install --legacy-peer-deps --no-audit --no-fund

COPY --chown=pwuser:pwuser shared /app/agent-repo-shared
COPY --chown=pwuser:pwuser Lobster_Agent /app

USER pwuser
ENV NODE_ENV=production
ENV NUXT_TELEMETRY_DISABLED=1
RUN npm run build

USER root
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 13108 6080 5900

USER root

CMD ["/app/docker-entrypoint.sh"]
