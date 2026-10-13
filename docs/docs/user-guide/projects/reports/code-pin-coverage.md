---
title: Code Pin Coverage
sidebar_position: 10
---

# Code Pin Coverage

Where [Code Pins](../../impact.md#code-pins) are, and where recent changes went uncovered. One row per connected repository and directory, so you can see which parts of the application map to test cases and which parts change without any pin catching them. The report is offered only when Impact Analysis is enabled for the project.

A directory is the first two path segments of a pin or changed file (`src/payments` for `src/payments/api/charge.ts`); files at the repository root fall into **(repository root)**. A glob pin counts under the directory before its first `*`.

## Columns

| Column | Meaning |
| --- | --- |
| **Repository** | The connected repository and branch |
| **Directory** | The two-level directory the row covers |
| **Code Pins** | Pins in the directory; hover for the split by kind (whole file, lines, symbol, glob) and by source (manual, AI, annotation, map file, ticket) |
| **Cases with pins** | Distinct test cases pinned to something in the directory |
| **Stale pins** | Pins the connection's latest completed analysis could not find at the head commit |
| **Uncovered changed files** | Changed files no pin covered, counted once per file across the analyses in the window; hover for examples |
| **Analyses** | Analyses in the window that left a file in the directory uncovered |

Rows exist for every directory that has a pin or an uncovered change, so a directory with changes and no pins appears with zero pins.

## Summary

- **Code Pins** in the connected repositories
- **Cases with pins**, as a share of the project's test cases
- **Stale pins** across the latest analyses
- **Uncovered changed files** in the window
- **Directories changed without pins**

The chart shows the directories with the most pins and uncovered files side by side.

## Settings

- **Lookback Period** — 7–365 days, or all time (default 90); it scopes the analyses that supply uncovered and stale files, not the pins

## Filters

Filters live in the **Filters** menu at the bottom of the report settings. Each filter accepts several values, and a row matches if it has any of them. When you use several filters, a row must match all of them. A filter with nothing selected doesn't narrow the report.

- **Show** — Changed without pins, With pins
- **Repository** — the project's connected repositories (shown when the project has more than one)

## Sort Order

Most uncovered files first, then most pins.
