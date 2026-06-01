---
title: Test Case Health
sidebar_position: 7
---

# Test Case Health

Scores test cases on a 0–100 scale combining staleness, execution frequency, and pass-rate pattern detection. Use it to find stale or abandoned tests and to spot suspicious pass-rate patterns (e.g., tests that have only ever passed and may not be exercising the system at all).

## Health Status

Each case is classified into one of four buckets:

| Status | Criteria |
| --- | --- |
| **Never Executed** | 0 executions in the lookback window |
| **Always Failing** | 0% pass rate, with at least the minimum-executions threshold met |
| **Always Passing** | 100% pass rate, with at least the minimum-executions threshold met — flagged as suspicious, since a never-failing test may not be exercising anything |
| **Healthy** | Mixed results, or fewer executions than the minimum-executions threshold |

## Staleness

Independent of the health bucket, a case is flagged as **stale** when `daysSinceLastExecution > staleDaysThreshold` (default 30 days).

## Filters

At generation time:

- **Include** — Both, Manual only, or Automated only
- **Health Status** — All, Healthy, Always Passing, Always Failing, or Never Executed
- **Staleness** — All, Stale, or Not Stale
- **Stale Days Threshold** — 7–90 days (default 30)
- **Min Executions for Rate** — 3–20 executions needed before a case can be classified as Always Passing or Always Failing (default 5)
- **Lookback Days** — 0–365; `0` means all-time

## Sort Order

Results are sorted by health-status priority (Always Failing first), then by staleness, then by score.
