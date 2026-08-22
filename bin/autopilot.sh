#!/bin/sh
# Portable autopilot launcher: works from any directory, on macOS and Linux.
# Extra arguments are appended, and later flags win, so
#   ./bin/autopilot.sh --threads=2
# overrides the default below.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

NODE=${NODE_BIN:-}
if [ -z "$NODE" ]; then
  NODE=$(command -v node || true)
fi
if [ -z "$NODE" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then NODE=$candidate; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "node not found on PATH. Install Node 22.13+ or set NODE_BIN to its path." >&2
  exit 1
fi

exec "$NODE" bin/generator.mjs tui --autopilot --threads=4 --wave-size=100 "$@"
