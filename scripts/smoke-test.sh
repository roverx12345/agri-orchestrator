#!/usr/bin/env bash
set -euo pipefail

PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-http://127.0.0.1}
PUBLIC_API_PREFIX=${PUBLIC_API_PREFIX:-/api}
API_BASE="${PUBLIC_BASE_URL%/}${PUBLIC_API_PREFIX}"
HEALTH_URL="${PUBLIC_BASE_URL%/}/health"
STAMP=$(date +%Y%m%d%H%M%S)

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

json_field() {
  local field="$1"
  node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); const value=data[process.argv[1]]; if (value === undefined) process.exit(1); process.stdout.write(String(value));' "$field"
}

api_post() {
  local path="$1"
  local payload="$2"
  curl -fsS -X POST "${API_BASE}${path}" -H 'content-type: application/json' --data "$payload"
}

need_cmd curl
need_cmd node

curl -fsS "$HEALTH_URL" >/dev/null

unit_json=$(api_post "/units" "{\"name\":\"Smoke Unit ${STAMP}\",\"type\":\"container\",\"locationText\":\"prod smoke\"}")
unit_id=$(printf '%s' "$unit_json" | json_field id)

plan_json=$(api_post "/units/${unit_id}/crop-plans" "{\"crop\":\"hyacinth\",\"cultivar\":\"Smoke\",\"currentStage\":\"flowering\",\"target\":\"ornamental\"}")
plan_id=$(printf '%s' "$plan_json" | json_field id)

api_post "/units/${unit_id}/observations/user" "{\"cropPlanId\":\"${plan_id}\",\"type\":\"soil_moisture\",\"payload\":{\"status\":\"dry\"}}" >/dev/null
care_json=$(api_post "/units/${unit_id}/care-check" '{"persist":true}')
reminder_count=$(printf '%s' "$care_json" | node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String((data.savedReminders || []).length));')
if [[ "$reminder_count" -lt 1 ]]; then
  echo "care-check did not persist a reminder" >&2
  exit 1
fi

api_post "/units/${unit_id}/operations" '{"type":"spraying","confirmed":true,"confirmedBy":"smoke-test","details":{"product":"demo-safe"}}' >/dev/null

echo "smoke test passed for unit ${unit_id}"
