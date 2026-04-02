#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
TARGET_FILE="$TARGET_DIR/openclaw-gateway.service"

mkdir -p "$TARGET_DIR"
mkdir -p "$HOME/.openclaw/logs"

sed "s#%h/agri-orchestrator-main#$ROOT_DIR#g" "$ROOT_DIR/deploy/systemd/openclaw-gateway.service" > "$TARGET_FILE"

echo "installed user unit: $TARGET_FILE"

echo "attempting systemctl --user daemon-reload and enable --now"
if systemctl --user daemon-reload >/dev/null 2>&1 && systemctl --user enable --now openclaw-gateway.service >/dev/null 2>&1; then
  systemctl --user status openclaw-gateway.service --no-pager || true
else
  echo "systemctl --user is not available in this shell." >&2
  echo "manual follow-up:" >&2
  echo "  systemctl --user daemon-reload" >&2
  echo "  systemctl --user enable --now openclaw-gateway.service" >&2
  echo "if you need the user service to survive logout, run once as root:" >&2
  echo "  sudo loginctl enable-linger $USER" >&2
fi
