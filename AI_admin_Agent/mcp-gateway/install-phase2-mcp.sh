#!/usr/bin/env bash
# Phase 2：国内镜像安装 china-hot-mcp / bilibili-mcp
set -euo pipefail

export GIT_TERMINAL_PROMPT=0
PIP_INDEX="${PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}"

fetch_repo() {
  local repo="$1"
  local dest="$2"
  local branch="${3:-main}"

  clone_repo() {
    local url="$1"
    echo "[phase2] git try: ${url}"
    rm -rf "${dest}"
    git clone --depth 1 --branch "${branch}" "${url}" "${dest}" 2>/dev/null
  }

  for url in \
    "https://gitclone.com/github.com/${repo}.git" \
    "https://mirror.ghproxy.com/https://github.com/${repo}.git" \
    "https://ghproxy.net/https://github.com/${repo}.git" \
    "https://github.com/${repo}.git"
  do
    if clone_repo "${url}"; then
      echo "[phase2] git ok: ${dest}"
      return 0
    fi
  done

  rm -rf "${dest}"
  mkdir -p "${dest}"
  for url in \
    "https://mirror.ghproxy.com/https://github.com/${repo}/archive/refs/heads/${branch}.tar.gz" \
    "https://ghproxy.net/https://github.com/${repo}/archive/refs/heads/${branch}.tar.gz" \
    "https://gitclone.com/github.com/${repo}/archive/refs/heads/${branch}.tar.gz"
  do
    echo "[phase2] tarball try: ${url}"
    if curl -fsSL --connect-timeout 30 --max-time 180 "${url}" | tar -xz -C "${dest}" --strip-components=1 2>/dev/null; then
      echo "[phase2] tarball ok: ${dest}"
      return 0
    fi
  done

  echo "[phase2] fetch failed: ${repo}" >&2
  return 1
}

install_china_hot() {
  echo "[phase2] install china-hot-mcp ..."
  if pip3 install --no-cache-dir -i "${PIP_INDEX}" china-hot-mcp 2>/dev/null; then
    if python3 -c "import china_hot_mcp" 2>/dev/null; then
      return 0
    fi
  fi
  fetch_repo "EA-Studio-SHARK/china-hot-mcp" /opt/china-hot-mcp master
  pip3 install --no-cache-dir -i "${PIP_INDEX}" /opt/china-hot-mcp
  python3 -c "import china_hot_mcp"
}

install_bilibili() {
  echo "[phase2] install bilibili-mcp ..."
  fetch_repo "adoresever/bilibili-mcp" /opt/bilibili-mcp main
  pip3 install --no-cache-dir -i "${PIP_INDEX}" -r /opt/bilibili-mcp/requirements.txt
  test -f /opt/bilibili-mcp/mcp_server.py
}

install_china_hot
install_bilibili
echo "[phase2] china-hot + bilibili ready"
