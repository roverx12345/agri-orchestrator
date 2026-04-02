#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${HOME:-}" && -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || true
fi

exec openclaw gateway
