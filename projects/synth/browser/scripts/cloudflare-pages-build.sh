#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BROWSER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
EMSDK_DIR="${EMSDK:-$HOME/.local/emsdk}"

if ! command -v em++ >/dev/null 2>&1 && [ ! -x "$EMSDK_DIR/upstream/emscripten/em++" ]; then
  mkdir -p "$(dirname "$EMSDK_DIR")"
  if [ ! -d "$EMSDK_DIR/.git" ]; then
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK_DIR"
  fi
  "$EMSDK_DIR/emsdk" install latest
  "$EMSDK_DIR/emsdk" activate latest
fi

if [ -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  # shellcheck disable=SC1091
  . "$EMSDK_DIR/emsdk_env.sh" >/dev/null
fi

npm --prefix "$BROWSER_ROOT" install
make -C "$BROWSER_ROOT" EMSDK="$EMSDK_DIR" browser-miniapp
npm --prefix "$BROWSER_ROOT" run publish:site
