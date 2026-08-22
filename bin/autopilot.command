#!/bin/sh
# Double-clickable wrapper for macOS Finder; the real launcher is autopilot.sh.
exec "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/autopilot.sh" "$@"
