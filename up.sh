#!/usr/bin/env bash
# up.sh — start the Sigil app cleanly.
#
# Kills any stale local-inference children from a previous session (the
# Python sidecar and the llama-cpp-python server it spawns), frees the
# local-LLM port if something is still holding it, then launches
# `npm run tauri dev`. Use when a previous run left a sidecar behind
# after Ctrl-C or a crash.

set -euo pipefail

PORT="${SIGIL_LLM_PORT:-8765}"

echo "[up] cleaning stale sidecars"
pkill -f "sidecar/main.py"   2>/dev/null || true
pkill -f "llama_cpp.server"  2>/dev/null || true
# Earlier mlx-lm sidecar — kill if it somehow survived the swap.
pkill -f "mlx_lm"            2>/dev/null || true

# Free the local-LLM port if still held.
if lsof -i "tcp:${PORT}" -t >/dev/null 2>&1; then
  echo "[up] freeing port ${PORT}"
  lsof -i "tcp:${PORT}" -t | xargs -r kill -9 || true
fi

# Give the OS a moment to reap children before we spawn new ones.
sleep 0.5

echo "[up] starting tauri dev"
exec npm run tauri dev
