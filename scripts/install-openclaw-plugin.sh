#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PLUGIN_ID=agri-orchestrator
DISPLAY_ROOT="$ROOT_DIR"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd npm
need_cmd openclaw

node -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 22) { console.error("Node 22+ is required for host-side OpenClaw"); process.exit(1); }'
openclaw config validate >/dev/null

if [[ -n "${HOME:-}" && "$ROOT_DIR" == "$HOME/"* ]]; then
  DISPLAY_ROOT="~/${ROOT_DIR#"$HOME/"}"
fi

cd "$ROOT_DIR"
npm run build

PLUGIN_INFO=$(openclaw plugins info "$PLUGIN_ID" 2>/dev/null || true)

if printf '%s\n' "$PLUGIN_INFO" | grep -F "Source path: ${DISPLAY_ROOT}" >/dev/null || printf '%s\n' "$PLUGIN_INFO" | grep -F "Source path: ${ROOT_DIR}" >/dev/null; then
  echo "plugin already linked from $ROOT_DIR"
else
  openclaw plugins install -l "$ROOT_DIR"
  PLUGIN_INFO=$(openclaw plugins info "$PLUGIN_ID" 2>/dev/null || true)
fi

if printf '%s\n' "$PLUGIN_INFO" | grep -F "Status: loaded" >/dev/null; then
  echo "plugin $PLUGIN_ID already enabled"
else
  openclaw plugins enable "$PLUGIN_ID"
fi

openclaw plugins info "$PLUGIN_ID"
