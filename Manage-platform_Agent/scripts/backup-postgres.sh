#!/usr/bin/env bash
# 备份 ClawHive PostgreSQL（compose 服务 clawhive_postgres）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.agents-lan"
COMPOSE_FILE="$ROOT/docker-compose.agents-lan.yml"
OUT_DIR="${1:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/clawhive-pg-${STAMP}.sql.gz"

# shellcheck disable=SC1090
[[ -f "$ENV_FILE" ]] && source "$ENV_FILE" 2>/dev/null || true

PG_USER="${CLAWHIVE_PG_USER:-postgres}"
PG_DB="${CLAWHIVE_PG_DB:-clawhive}"

SVC=""
for candidate in clawhive_postgres postgres; do
  if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --services 2>/dev/null | grep -qx "$candidate"; then
    SVC="$candidate"
    break
  fi
done

if [[ -n "$SVC" ]]; then
  echo "备份服务 $SVC → $OUT"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$SVC" \
    pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$OUT"
  echo "已备份: $OUT"
  echo "恢复: bash scripts/restore-postgres.sh $OUT --yes"
  exit 0
fi

CNAME="$(docker ps --format '{{.Names}}' | grep -E '^clawhive_postgres$|postgres' | head -n1 || true)"
if [[ -n "$CNAME" ]]; then
  echo "使用容器: $CNAME → $OUT"
  docker exec "$CNAME" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$OUT"
  echo "已备份: $OUT"
  echo "恢复: bash scripts/restore-postgres.sh $OUT --yes"
  exit 0
fi

echo "错误: 未找到 PostgreSQL 服务/容器"
exit 1
