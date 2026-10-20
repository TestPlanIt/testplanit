---
sidebar_label: 'Failure Patterns'
title: 'Failure Patterns'
description: Automated failures grouped into patterns, given a root cause by AI from a configurable catalogue, linked to the issues that explain them, and quarantined while they are fixed
---

# Failure Patterns

**Failure Patterns** turns the failures in your automated results into a short list of problems. Every failed or errored automated result is fingerprinted from its exception type, its message with changing values such as ids and timestamps masked, and the top frames of its stack trace. Results with the same fingerprint belong to the same **failure pattern**. A run with two hundred red rows usually comes down to a handful of patterns.

For each pattern TestPlanIt tracks how many results it covers, which test cases and test runs it touched, when it was first and last seen, and whether the affected cases flip between pass and fail in their recent history. When the project has an AI model assigned to the **Failure Patterns: Root Cause** feature, each new pattern also gets a suggested root cause.

## Where it appears

- **Failure Patterns** in the project menu lists the project's failure patterns. Filter by status, root cause, whether the root cause came from AI or a person, or flaky candidates, and search by title or exception type. The list opens on **Open** patterns; switch the status filter to see resolved or ignored ones. Click a pattern's title to open it.
- A **test run** with automated results shows a collapsible **Failure patterns** table above its results: the run's failures grouped by pattern, with how many results each has in this run, its root cause, status and linked issues. Click a pattern's title to filter the results table to it; the filter row then shows how many patterns are selected, and clicking that chip clears them. **View pattern** opens the pattern page. Rows in the results table carry the root cause and a **Known issue** badge when the pattern is linked to an issue. Whether the panel is open or collapsed is remembered on this device for every run.
- The **pattern page** shows the latest failure's message and stack trace, the affected test cases with how many results and runs each failed in, recent occurrences with links to their runs, the root cause with who set it, linked issues and team notes. The two panels can be resized and the split is remembered on this device.

Triage runs in the background a few seconds after results arrive, whether they come from a reporter, the CLI, a results import or an automated execution. Results recorded before the feature was enabled are grouped with **Analyze existing results** in the [Failure Patterns settings](projects/settings/triage.md).

## Root causes

Root causes are a catalogue that system administrators manage under **Administration → Root Causes** (see [Root Causes](root-causes.md)). A new installation starts with four:

| Root cause | Meaning |
| --- | --- |
| **Product bug** | The application under test misbehaves. The same assertion fails consistently across runs. |
| **Test bug** | The test or its page objects are wrong or stale: a selector that no longer exists, hard-coded data, an assertion that can never pass. |
| **Environment** | Infrastructure or configuration rather than code: connection refused, DNS, missing credentials, browser or driver start-up, CI runner problems. |
| **Flaky** | Intermittent. The same cases pass and fail without a code change. A pass/fail history with many flips is the main evidence. |

The AI picks from the catalogue using each entry's description, so an added root cause such as *Data setup* or *Third-party outage* is available to the AI as soon as it has a description. Its answer comes with a rationale, a suggested issue title and a suggested next step. The pattern shows whether its root cause came from AI or from a person, and the list can be filtered by root cause and by that. Anyone who can record results can override it from the pattern page with **Set root cause**; a root cause set by hand always wins, and the AI suggestion stays visible underneath for reference. **Suggest root cause with AI** asks for a fresh suggestion at any time.

A pattern is flagged as a **flaky candidate** from history alone, without AI: at least half of its test cases flipped between pass and fail two or more times in their last ten automated verdicts.

## Status

A pattern is **Open** until someone handles it:

- **Resolve** it once the cause is fixed. If the same failure comes back, the pattern reopens by itself and the new occurrences count against it.
- **Ignore** a pattern that is not worth acting on. It stays ignored even when it recurs.
- **Reopen** returns a resolved or ignored pattern to the open list.

## Issues

**Link Issue** on the pattern page connects it to an issue in the project's issue tracker or to an internal issue; unlinking asks for confirmation. **Create Issue** next to the AI's suggested title opens the tracker's create form pre-filled with that title and a description that links back to the pattern, the affected test cases and the latest run, and includes the root cause, rationale, suggested next step and the latest stack trace. The new issue is linked to the pattern automatically. A pattern with a linked issue is a **known issue**: its rows in the run's pattern table and in the results table on the run page carry the badge, so the next person who opens a red run sees at once that the failure is already tracked.

Notes on the pattern page use the same rich-text editor as the rest of the application.

## Quarantine

A test case that fails for a known reason can be **quarantined** while the cause is being fixed. The case keeps running and recording results, but its failures are left out of the run's pass/fail: the run summary bar, the runs list, milestone progress, the execution metrics pass rate and run alerts all count them in a separate **Quarantined** bucket instead of as failures. A quarantined case that passes simply passes.

Quarantine from the pattern page: the affected test cases table has a **Quarantine** button per case and the actions menu offers **Quarantine affected test cases** for all of them at once, with an optional reason. Quarantined cases carry a **Quarantined** badge on the pattern page and on the run page, where the filter bar gains a **Quarantined** toggle and the execution metrics a Quarantined tile that applies it.

**Quarantined test cases** on the Failure Patterns page lists every quarantined case in the project with its pattern, reason, who quarantined it, when, and how it will be released. **Release** there or on the pattern page puts the case's failures back into the run counts. Quarantine is project-wide and applies to the case, not to one run, so releasing it changes how earlier runs count too.

Quarantine also lifts by itself: once the case has passed the number of times in a row set in the [Failure Patterns settings](projects/settings/triage.md) (five by default), counting only results recorded after it was quarantined, the worker releases it and the audit log records the release. Skipped results neither count nor break the streak; a failure starts the count over. Tick **Keep quarantined until released by hand** when quarantining a case that should stay out of the counts regardless, for example while a known fix is scheduled.


## Patterns without details

Some results arrive with no message or stack trace, for example automation imported from another tool. They cannot be grouped by failure, so each test case gets its own pattern named after the case. Reporters, the CLI and results imports all send the failure text, so this only affects historical data.

## Alerts

The **New failure patterns in a run** [alert](alerts.md) fires when a run introduces more than a given number of patterns the project had not seen before, so a run that breaks something new stands out from one that repeats known failures.

## Permissions

Everyone who can see the project can see its failure patterns. Changing status, root cause, notes, issue links and quarantine needs the same permission as recording results: project admin or **Test Runs** add/edit. Settings and **Analyze existing results** are for project admins; the root cause catalogue is for system administrators.
