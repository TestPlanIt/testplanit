#!/usr/bin/env bash
#
# check-effective-case-status.sh
#
# Guards the effective-case-status convention
# (https://github.com/TestPlanIt/testplanit/issues/591).
#
# A run-case's completion lives in one of two tables depending on how the
# run was produced: manual runs denormalise it onto TestRunCases.statusId,
# while automated runs (JUnit, TestNG, Mocha, etc.) record it in
# JUnitTestResult and may leave the run-case row completely empty. Raw SQL
# that reads trc."statusId" without branching on run type silently treats
# every automated case as never executed — a bug class that shipped eight
# separate times before the accessor existed.
#
# Raw SQL should read the "EffectiveCaseStatus" view; ORM callers should use
# the helpers in lib/services/effectiveCaseStatus.ts. The files below are the
# only permitted direct readers.
#
# Exits non-zero on any new direct read.
#
# Invocation:   pnpm check:case-status
# Or directly:  bash scripts/check-effective-case-status.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# Files allowed to read trc."statusId" directly, each for a reason:
ALLOWLIST=(
  # The accessor itself — the one place that owns the split.
  "lib/services/effectiveCaseStatus.ts"
  # Branches manual vs automated by run type before reading (manual segments
  # only; automated segments read JUnitTestResult).
  "lib/services/milestoneSummary.ts"
  # Branches to getJUnitRunSummary for automated runs before reading.
  "lib/services/testRunSummary.ts"
  # Excludes automated runs by design — readiness only gates manual work.
  "lib/services/runReadyCheck.ts"
  # Branches per run type (mirrors testRunSummary).
  "app/api/test-runs/summaries/route.ts"
)

MATCHES=$(
  grep -rn 'trc\."statusId"' \
    --include='*.ts' --include='*.tsx' \
    --exclude='*.test.ts' --exclude='*.test.tsx' \
    app components hooks lib server services utils workers 2>/dev/null \
  || true
)

VIOLATIONS=()
if [ -n "$MATCHES" ]; then
  while IFS= read -r line; do
    file="${line%%:*}"
    allowed=false
    for allowed_file in "${ALLOWLIST[@]}"; do
      if [ "$file" = "$allowed_file" ]; then
        allowed=true
        break
      fi
    done
    if [ "$allowed" = false ]; then
      VIOLATIONS+=("$line")
    fi
  done <<< "$MATCHES"
fi

if [ ${#VIOLATIONS[@]} -gt 0 ]; then
  echo 'ERROR: direct read of TestRunCases."statusId" outside the accessor:'
  printf '  - %s\n' "${VIOLATIONS[@]}"
  echo
  echo "That column is EMPTY for reporter-SDK automated runs (JUnit, TestNG,"
  echo "Mocha, etc.) — their outcome lives in JUnitTestResult — so reading it"
  echo "without branching on run type treats every automated case as never"
  echo "executed."
  echo
  echo "Use the \"EffectiveCaseStatus\" view in raw SQL, or the helpers in"
  echo "lib/services/effectiveCaseStatus.ts from ORM code. If this read is"
  echo "genuinely run-type-aware, add the file to ALLOWLIST in"
  echo "scripts/check-effective-case-status.sh with a comment explaining why."
  echo
  echo "Background: https://github.com/TestPlanIt/testplanit/issues/591"
  exit 1
fi

echo "ok: effective-case-status check passed"
