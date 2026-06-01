---
title: Flaky Tests
sidebar_position: 4
---

# Flaky Tests

Identifies tests with inconsistent pass/fail results. Helps improve test reliability and CI/CD stability by highlighting tests that may need maintenance.

## What It Shows

For each flaky test case, the report surfaces:

- Test case details (name, ID, automation status)
- **Flip count** — number of status transitions within the analyzed window
- **Execution timeline** — recent run statuses (name, color, success/failure indicator, timestamp)
- **Pass rate** for the windowed executions

## How "Flaky" Is Determined

The report analyzes each case's most recent executions within a configurable **sliding window** (default 10 consecutive runs, max 30). A case qualifies as flaky if it shows status instability — specifically:

- Both successful and failing results within the window, **or**
- Any non-success results (Blocked, Retest, Skipped, etc.) mixed with successes

A case is then surfaced only if its flip count meets the configured **flip threshold**.

## Filters

At generation time:

- **Consecutive Runs** — how many recent executions to analyze per case (default 10, max 30)
- **Flip Threshold** — minimum flip count to surface the test (default 5; range 2 to runs−1)
- **Automation Status** — All, Automated only, or Manual only
- **Date Range** — restrict the windowed executions to a specific period
