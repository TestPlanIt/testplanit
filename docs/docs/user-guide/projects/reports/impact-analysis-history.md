---
title: Impact Analysis History
sidebar_position: 9
---

# Impact Analysis History

One row per [Impact analysis](../../impact.md) the project ran: what started it, what it changed, the cases it selected, and how the test run it composed turned out. Use it to see whether repository webhooks are producing runs, how many cases each change pulls in, and how often those runs catch a failure. The report is offered only when Impact Analysis is enabled for the project.

## Columns

| Column | Meaning |
| --- | --- |
| **Started** | When the analysis was created |
| **Repository** | The connected repository and branch the analysis compared |
| **Trigger** | **Manual** for an analysis started from a test run, **Pull request** or **Push** for one started by a [repository webhook](../../webhooks.md#repository-webhooks); the pull request or commit range links back to the provider |
| **Commits** | The base and head the analysis compared |
| **Changed files** | Files in the diff, with additions and deletions on hover |
| **Pinned / Affected / Related** | Cases selected in each tier |
| **Accepted** | Cases a reviewer accepted into the run |
| **Test Run** | The run the analysis composed, if any |
| **Outcome** | **Failed** when at least one case in the composed run has a failure status, **Passed** when every executed case succeeded, **Not executed** when the run exists but nothing has run, **No run** when no run was composed |
| **Duration** | Time from start to completion |
| **Creator** | Who started it; webhook-started analyses are attributed to the project creator |

Outcomes are read from each status's success and failure flags, not its name.

## Summary

- **Analyses** in the window
- **Runs composed**, with the share of analyses that produced a run
- **Runs with failures**, as a share of the composed runs that were executed
- **Median affected cases** an analysis selected (pinned plus affected)
- **Accepted share** of every pinned and affected case the analyses suggested

The chart stacks analyses per week by trigger.

## Filters

- **Lookback Period** — 7–365 days, or all time (default 90)
- **Trigger** — All, Manual, Pull request, or Push
- **Outcome** — All, Failed, Passed, Not executed, or No run
- **Repository** — one connected repository, or all

## Sort Order

Newest first. Sorting by **Outcome** puts failed runs first, then runs that were never executed, then analyses without a run, then passing runs.
