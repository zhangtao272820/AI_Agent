#!/usr/bin/env bash
# 从 backups/*.sql.gz（或 .sql）恢复 ClawHive PostgreSQL
# 用法:
#   bash scripts/restore-postgres.sh backups/clawhive-pg-20260723-120000.sql.gz
#   bash scripts/restore-postgres.sh backups/clawhive-pg-xxx.sql.gz --yes
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.agents-lan"
COMPOSE_FILE="$ROOT/docker-compose.agents-lan.yml"
YES=0
BACKUP=""

for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    -h|--help)
      echo "用法: bash scripts/restore-postgres.sh <backup.sql[.gz]> [--yes]"
      exit 0
      ;;
    *)
      if [[ -z "$BACKUP" ]]; then BACKUP="$arg"
      else echo "未知参数: $arg"; exit 1
      fi
      ;;
  esac
done

if [[ -z "$BACKUP" ]]; then
  echo "用法: bash scripts/restore-postgres.sh <backup.sql[.gz]> [--yes]"
  exit 1
fi
if [[ ! -f "$BACKUP" ]]; then
  echo "错误: 文件不存在: $BACKUP"
  exit 1
fi

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
if [[ -z "$SVC" ]]; then
  echo "错误: 未找到 PostgreSQL compose 服务"
  exit 1
fi

if (( ! YES )); then
  echo "将用 $BACKUP 覆盖数据库 ${PG_DB}（服务 $SVC）。"
  echo "继续请加 --yes"
  exit 1
fi

echo "恢复 $BACKUP → $SVC / $PG_DB"
if [[ "$BACKUP" == *.gz ]]; then
  gunzip -c "$BACKUP" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$SVC" \
    psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1
else
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T "$SVC" \
    psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 < "$BACKUP"
fi

echo "恢复完成。建议: curl -fsS http://127.0.0.1:${CLAWHIVE_BACKEND_PORT:-18000}/health/ready"
echo "演练清单: 备份 → 改数据 → 恢复 → 登录控制台核对租户/审计 → /health/ready"
