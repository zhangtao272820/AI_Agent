#!/usr/bin/env bash
# 写入 CLAWHIVE_IMAGE_TAG=0.1.0-<gitsha> 到 .env.agents-lan
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.agents-lan}"
REPO="$(cd "$ROOT/.." && pwd)"
SEMVER="${CLAWHIVE_IMAGE_SEMVER:-0.1.0}"
if command -v git >/dev/null 2>&1 && git -C "$REPO" rev-parse --short HEAD >/dev/null 2>&1; then
  SHA="$(git -C "$REPO" rev-parse --short HEAD)"
else
  SHA="local"
fi
TAG="${SEMVER}-${SHA}"
touch "$ENV_FILE"
if grep -q '^CLAWHIVE_IMAGE_TAG=' "$ENV_FILE"; then
  sed -i.bak "s|^CLAWHIVE_IMAGE_TAG=.*|CLAWHIVE_IMAGE_TAG=${TAG}|" "$ENV_FILE"
else
  echo "CLAWHIVE_IMAGE_TAG=${TAG}" >> "$ENV_FILE"
fi
echo "$TAG"
