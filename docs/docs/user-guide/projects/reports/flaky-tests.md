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

## Settings

- **Consecutive Runs** — how many recent executions to analyze per case (default 10, max 30)
- **Flip Threshold** — minimum flip count to surface the test (default 5; range 2 to runs−1)
- **Date Range** — restrict the windowed executions to a specific period

## Filters

Filters live in the **Filters** menu at the bottom of the report settings. Each filter accepts several values, and a row matches if it has any of them. When you use several filters, a row must match all of them. A filter with nothing selected doesn't narrow the report.

Which tests are listed:

- **Automated** — Yes (automated cases), No (manual cases)
- **Templates**, **States**, and custom fields such as **Priority** — the case's current values
- **Test Case Tags** — cases carrying any of the selected tags
- **Folder** — cases in the selected folders (project report only). **Include subfolders**, on by default, also covers every folder beneath them.
- **Projects** — cross-project report only

Which executions count toward each test's window:

- **Test Run Tags** — only executions from runs carrying any of the selected tags, e.g. only your `regression` runs
- **Milestone** — only executions from runs in the selected milestones, including their child milestones (project report only)
- **Configuration** — only executions from runs in the selected configurations (project report only)

The execution filters are applied before the window is taken, so **Consecutive Runs** counts the most recent _matching_ executions.
