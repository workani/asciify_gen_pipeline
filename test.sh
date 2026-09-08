#!/bin/sh
# One real pass through the current record pipeline. This intentionally has no
# retry loop and disables structural model repairs: at most one factual draft, factual review,
# blind discovery and vocabulary assessment per character (four requests per selected entity).
set -eu

GENERATOR_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RUN_STAMP=$(date -u +%Y%m%dT%H%M%SZ)-$$
LATEST_CPS=27bb,27a6,21af,2022,2003,2014,229e,1f972,261e,1f64f,2661,1f494,250c,256c,2260,2297
OLD_CPS=1faac,1f9ff,2660,2666,2696,2318,203b,2e2e,2299
RUN_MODE=latest
case "${1:-}" in
  --old) RUN_MODE=old; shift ;;
  --100|—100) RUN_MODE=100; shift ;;
  --hand|—hand) RUN_MODE=hand; shift ;;
esac

if [ "$RUN_MODE" = 100 ] || [ "$RUN_MODE" = hand ]; then
  # Keep fixed cohorts intact even when presentation options are supplied.
  for argument in "$@"; do
    case "$argument" in
      --cps|--cps=*|--family|--family=*|--old|--100|—100|--hand|—hand)
        echo "--$RUN_MODE cannot be combined with --cps, --family, or another preset" >&2
        exit 2
        ;;
    esac
  done
fi

if [ "$RUN_MODE" = old ]; then
  RUN_DIR="$GENERATOR_ROOT/out/test-runs/$RUN_STAMP-old"
  REPORT_FILE="$GENERATOR_ROOT/out/test-results-old.json"
else
  if [ "$RUN_MODE" = 100 ] || [ "$RUN_MODE" = hand ]; then
    RUN_DIR="$GENERATOR_ROOT/out/test-runs/$RUN_STAMP-$RUN_MODE"
  else
    RUN_DIR="$GENERATOR_ROOT/out/test-runs/$RUN_STAMP"
  fi
  REPORT_FILE="$GENERATOR_ROOT/out/test-results.json"
fi

cd "$GENERATOR_ROOT"
# Remove the previous stable report before Node, model, or renderer startup.
# This prevents an early failure from leaving stale results behind.
if [ -f "$REPORT_FILE" ]; then
  rm -f -- "$REPORT_FILE"
fi
if [ "$RUN_MODE" = 100 ]; then
  # Charset lives in src/fixed-cohorts.mjs, the single source of truth shared
  # with `generator run|tui --100` so both paths exercise the same characters.
  HUNDRED_CPS=$(node -e "import('$GENERATOR_ROOT/src/fixed-cohorts.mjs').then(m => process.stdout.write(m.HUNDRED_COHORT_HEX))")
  set -- "$@" --cps="$HUNDRED_CPS" --print=100
elif [ "$RUN_MODE" = hand ]; then
  set -- "$@" --cps=1faac --print=1
elif [ "$#" -eq 0 ]; then
  if [ "$RUN_MODE" = old ]; then
    # Historical comparison cohort from the alias generator screenshot. This
    # still runs the current records pipeline; only the characters differ.
    set -- --cps="$OLD_CPS" \
    --print=9 \
    --print-cps="$OLD_CPS"
  else
    set -- --cps="$LATEST_CPS" \
    --print=5 \
    --print-cps=27bb,2022,2014,229e,1f972
  fi
fi
GEN_RECORD_CONTRACT_REPAIRS=0 exec node scripts/live-records.mjs "$@" \
  --threads="${TEST_THREADS:-4}" \
  --out="$RUN_DIR" \
  --report="$REPORT_FILE"
