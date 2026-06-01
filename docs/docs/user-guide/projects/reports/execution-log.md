---
title: Execution Log
sidebar_position: 3
---

# Execution Log

A flat, chronological log of individual test result records. One row per test result — see who executed each test case, when it was executed, which test run it belonged to, and what status was recorded. Useful for audit trails, team activity reviews, and tracking execution patterns over time.

## What It Shows

Each row represents a single test execution and surfaces:

- Test case name
- Test run name
- Status
- Executed by
- Executed at
- Duration
- Test run case version

Each row can be expanded to reveal **step-level results** for that test case execution. Every expected step in the case definition appears as a sub-row — including steps that were not recorded during the run (shown as **Untested**) — with the step action, expected result, per-step status, executed-at timestamp, and duration.

Steps that belong to a shared step group are marked with a Shared Step icon and the group name surfaces in a tooltip. Long step or expected-result text is truncated to two lines with the full content available on hover.

## Filters

- **Date Range** — limit results to a specific time window

## Sorting

Server-side sorting is supported on: test case name, test run name, status, executed by, executed at, duration, test run case version (and Project name in cross-project mode).
