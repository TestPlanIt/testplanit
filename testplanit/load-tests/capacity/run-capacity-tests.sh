#!/usr/bin/env bash
#
# Capacity test runner.
#
# Usage:
#   ./run-capacity-tests.sh [TIER] [TEST...]
#
#   TIER:  small | medium | large   (default: medium)
#   TEST:  one or more test file names to run (default: all)
#          use "all" to run everything
#
# Examples:
#   ./run-capacity-tests.sh small all
#   ./run-capacity-tests.sh medium 01-concurrent-users 02-import-rate
#   ./run-capacity-tests.sh large 06-search-at-scale
#
# Environment:
#   BASE_URL   - TestPlanIt URL (required)
#   API_TOKEN  - Bearer token for authentication (required)
#   PROJECT_ID - Project ID for single-project tests (default: 1)
#   INFLUX_URL - InfluxDB endpoint (default: http://localhost:8086/k6)
#
# After all tests complete, runs the report generator to produce a
# consolidated markdown report.
#

set -euo pipefail

TIER="${1:-medium}"
shift || true

if [ $# -eq 0 ] || [ "${1:-}" = "all" ]; then
  TESTS=(
    01-concurrent-users
    02-import-rate
    03-result-ingestion-rate
    04-report-generation
    05-run-creation
    06-search-at-scale
    07-audit-log-throughput
    08-concurrent-runs
  )
else
  TESTS=("$@")
fi

if [ -z "${BASE_URL:-}" ] || [ -z "${API_TOKEN:-}" ]; then
  echo "ERROR: BASE_URL and API_TOKEN must be set."
  echo "  export BASE_URL=http://loadtest.testplanit.com"
  echo "  export API_TOKEN=tpi_..."
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-1}"
INFLUX_URL="${INFLUX_URL:-http://localhost:8086/k6}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."  # run from load-tests/ so relative paths work

START_TIME=$(date +%s)
START_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
RUN_ID="$(date -u +"%Y%m%d-%H%M%S")-${TIER}"

echo "╔══════════════════════════════════════════════════╗"
echo "║  TestPlanIt Capacity Test Suite                  ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Run ID:   $RUN_ID"
echo "║  Tier:     $TIER"
echo "║  Tests:    ${#TESTS[@]} — ${TESTS[*]}"
echo "║  BASE_URL: $BASE_URL"
echo "║  InfluxDB: $INFLUX_URL"
echo "║  Started:  $START_ISO"
echo "╚══════════════════════════════════════════════════╝"
echo ""

FAILED_TESTS=()
SUCCEEDED_TESTS=()

for test in "${TESTS[@]}"; do
  echo ""
  echo "▶ Running: $test"
  echo "─────────────────────────────────────────"

  TEST_START=$(date +%s)
  if k6 run \
    --env "BASE_URL=$BASE_URL" \
    --env "API_TOKEN=$API_TOKEN" \
    --env "PROJECT_ID=$PROJECT_ID" \
    --env "TIER=$TIER" \
    --out "influxdb=$INFLUX_URL" \
    "capacity/${test}.js"; then
    SUCCEEDED_TESTS+=("$test")
    echo "✓ $test completed in $(($(date +%s) - TEST_START))s"
  else
    FAILED_TESTS+=("$test")
    echo "✗ $test FAILED (exit $?)"
  fi

  # Brief gap between tests — let the system settle
  echo "  [cooldown 15s]"
  sleep 15
done

TOTAL_TIME=$(($(date +%s) - START_TIME))

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Capacity Test Suite Complete                    ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Duration:   $(($TOTAL_TIME / 60))m $(($TOTAL_TIME % 60))s"
echo "║  Succeeded:  ${#SUCCEEDED_TESTS[@]}/${#TESTS[@]}"
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo "║  Failed:     ${FAILED_TESTS[*]}"
fi
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Generate the report
if command -v node >/dev/null 2>&1; then
  echo "Generating capacity report..."
  node "$SCRIPT_DIR/generate-report.js" "$RUN_ID" "$TIER"
  echo "Report written to: capacity/results/${RUN_ID}-report.md"
else
  echo "⚠  node not available — skipping report generation"
  echo "   To generate later: node capacity/generate-report.js $RUN_ID $TIER"
fi
