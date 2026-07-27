# Admin MCP 侧车网关：Phase 2（国内镜像）+ Phase 3（npx/uvx）
ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:20-bookworm
FROM ${NODE_BASE_IMAGE}

RUN sed -i "s|deb.debian.org/debian|mirrors.tuna.tsinghua.edu.cn/debian|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true \
    && sed -i "s|deb.debian.org/debian|mirrors.tuna.tsinghua.edu.cn/debian|g" /etc/apt/sources.list 2>/dev/null || true \
    && sed -i "s|security.debian.org/debian-security|mirrors.tuna.tsinghua.edu.cn/debian-security|g" /etc/apt/sources.list 2>/dev/null || true \
    && sed -i "s|security.debian.org/debian-security|mirrors.tuna.tsinghua.edu.cn/debian-security|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv git curl ca-certificates nginx jq \
    && rm -rf /var/lib/apt/lists/*

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ENV PIP_INDEX_URL=${PIP_INDEX_URL}
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

RUN python3 -m venv /opt/mcp-venv \
    && /opt/mcp-venv/bin/pip install --no-cache-dir -i "${PIP_INDEX_URL}" uv httpx mcp \
    && npm install -g supergateway@3.4.3

ENV PATH="/opt/mcp-venv/bin:${PATH}"

WORKDIR /app
COPY vendor/ /app/vendor/
COPY mcp-servers.json nginx.conf proxy-mcp.conf start.sh /app/
COPY nginx.conf /etc/nginx/nginx.conf
COPY proxy-mcp.conf /etc/nginx/proxy-mcp.conf
RUN chmod +x /app/start.sh

RUN mkdir -p /data/memory /data/cron
VOLUME ["/data/memory", "/data/cron"]

EXPOSE 8790

HEALTHCHECK --interval=20s --timeout=8s --retries=6 --start-period=180s \
  CMD curl -fsS http://127.0.0.1:8790/health || exit 1

CMD ["/app/start.sh"]
