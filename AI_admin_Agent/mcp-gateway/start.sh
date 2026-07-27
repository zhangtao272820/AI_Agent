#!/usr/bin/env bash
set -euo pipefail

export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
export UV_INDEX_URL="${UV_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

mkdir -p /data/memory /data/cron /var/log/nginx

start_gateway() {
  local id="$1"
  local port="$2"
  local stdio_cmd="$3"
  echo "[gateway] starting ${id} on :${port}"
  npx -y supergateway \
    --stdio "${stdio_cmd}" \
    --outputTransport streamableHttp \
    --stateful \
    --sessionTimeout "${MCP_SESSION_TIMEOUT_MS:-120000}" \
    --port "${port}" \
    --streamableHttpPath /mcp \
    --logLevel info &
}

# shellcheck disable=SC2016
while IFS= read -r row; do
  id=$(echo "$row" | jq -r '.id')
  port=$(echo "$row" | jq -r '.port')
  stdio=$(echo "$row" | jq -r '.stdio')
  start_gateway "$id" "$port" "$stdio"
done < <(jq -c '.[]' /app/mcp-servers.json)

sleep 3
echo "[gateway] nginx on :8790"
exec nginx -g 'daemon off;'
