#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/.env.production"}
COMPOSE_ARGS=(--env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.yml" -f "$ROOT_DIR/docker-compose.prod.yml")
DOCKER_BIN=(docker)

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required env: $name" >&2
    exit 1
  fi
}

docker_cmd() {
  "${DOCKER_BIN[@]}" "$@"
}

compose_cmd() {
  docker_cmd compose "${COMPOSE_ARGS[@]}" "$@"
}

wait_for_health() {
  local service="$1"
  local timeout_seconds="${2:-120}"
  local deadline=$((SECONDS + timeout_seconds))
  local container_id
  container_id=$(compose_cmd ps -q "$service")
  if [[ -z "$container_id" ]]; then
    echo "service $service has no container id" >&2
    exit 1
  fi

  while (( SECONDS < deadline )); do
    local status
    status=$(docker_cmd inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      echo "$service status: $status"
      return 0
    fi
    sleep 2
  done

  echo "timed out waiting for $service health" >&2
  compose_cmd logs "$service" || true
  exit 1
}

need_cmd docker
need_cmd node

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  echo "copy .env.production.example to .env.production and fill secrets first" >&2
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

export BASE_IMAGE=${BASE_IMAGE:-node:22-bookworm-slim}

require_env POSTGRES_DB
require_env POSTGRES_USER
require_env POSTGRES_PASSWORD
require_env DATABASE_URL
require_env BACKEND_HOST
require_env BACKEND_PORT
require_env STORAGE_DIR
require_env REMINDER_SCAN_INTERVAL_MS
require_env REMINDER_LOOKAHEAD_MINUTES
require_env PUBLIC_BASE_URL
require_env PUBLIC_API_PREFIX

if [[ "$POSTGRES_PASSWORD" == "replace-with-strong-password" || "$POSTGRES_PASSWORD" == "change-me" ]]; then
  echo "replace POSTGRES_PASSWORD with a real secret before deploying" >&2
  exit 1
fi

if [[ "$DATABASE_URL" == *"replace-with-strong-password"* || "$DATABASE_URL" == *"change-me"* ]]; then
  echo "replace placeholder credentials in DATABASE_URL before deploying" >&2
  exit 1
fi

cd "$ROOT_DIR"

compose_cmd config >/dev/null

compose_cmd build api worker migrate

compose_cmd up -d postgres
wait_for_health postgres 180

compose_cmd run --rm migrate

compose_cmd up -d api worker proxy
wait_for_health api 180
wait_for_health worker 60
wait_for_health proxy 60

compose_cmd ps

echo
echo "deployment finished"
echo "health: ${PUBLIC_BASE_URL:-http://127.0.0.1}/health"
echo "api:    ${PUBLIC_BASE_URL:-http://127.0.0.1}${PUBLIC_API_PREFIX:-/api}"
