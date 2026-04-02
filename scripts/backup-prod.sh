#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/.env.production"}
BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/.backups/$(date +%Y%m%d-%H%M%S)"}
COMPOSE_ARGS=(--env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")
DOCKER_BIN=(docker)

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

docker_cmd() {
  "${DOCKER_BIN[@]}" "$@"
}

compose_cmd() {
  docker_cmd compose "${COMPOSE_ARGS[@]}" "$@"
}

need_cmd docker

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1; then
    DOCKER_BIN=(sudo docker)
  else
    echo "docker daemon is not directly accessible and sudo is unavailable" >&2
    exit 1
  fi
fi

set -a
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

cd "$ROOT_DIR"
compose_cmd exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$BACKUP_DIR/postgres.sql"
compose_cmd exec -T api sh -lc 'tar -czf - -C "$STORAGE_DIR" .' > "$BACKUP_DIR/storage.tgz"

echo "backup written to $BACKUP_DIR"
