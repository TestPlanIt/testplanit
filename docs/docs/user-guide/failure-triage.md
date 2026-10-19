---
sidebar_label: 'Failure Triage'
title: 'Failure Triage'
description: Automated failures grouped into signatures, classified by AI as product bug, test bug, environment or flaky, and linked to the issues that explain them
---

# Failure Triage

**Failure Triage** turns the failures in your automated results into a short list of problems. Every failed or errored automated result is fingerprinted from its exception type, its message with changing values such as ids and timestamps masked, and the top frames of its stack trace. Results with the same fingerprint belong to the same **signature**. A run with two hundred red rows usually comes down to a handful of signatures.

For each signature TestPlanIt tracks how many results it covers, which test cases and test runs it touched, when it was first and last seen, and whether the affected cases flip between pass and fail in their recent history. When the project has an AI model assigned to the **Failure Triage Classification** feature, each new signature is also classified.

## Where it appears

- **Failure Triage** in the project menu lists the project's signatures. Filter by status, classification, whether the classification came from AI or a person, or flaky candidates, and search by title or exception type. The list opens on **Open** signatures; switch the status filter to see resolved or ignored ones. Click a signature's title to open it.
- A **test run** with automated results shows a collapsible **Failure clusters** table above its results: the run's failures grouped by signature, with how many results each cluster has in this run, its classification, status and linked issues. Click a cluster's title to filter the results table to that signature; the filter row then shows how many clusters are selected, and clicking that chip clears them. **View signature** opens the signature page. Rows in the results table carry the classification and a **Known issue** badge when the signature is linked to an issue. Whether the panel is open or collapsed is remembered on this device for every run.
- The **signature page** shows the latest failure's message and stack trace, the affected test cases with how many results and runs each failed in, recent occurrences with links to their runs, the classification with who set it, linked issues and team notes. The two panels can be resized and the split is remembered on this device.

Triage runs in the background a few seconds after results arrive, whether they come from a reporter, the CLI, a results import or an automated execution. Results recorded before the feature was enabled are grouped with **Analyze existing results** in the [Failure Triage settings](projects/settings/triage.md).

## Classifications

| Classification | Meaning |
| --- | --- |
| **Product bug** | The application under test misbehaves. The same assertion fails consistently across runs. |
| **Test bug** | The test or its page objects are wrong or stale: a selector that no longer exists, hard-coded data, an assertion that can never pass. |
| **Environment** | Infrastructure or configuration rather than code: connection refused, DNS, missing credentials, browser or driver start-up, CI runner problems. |
| **Flaky** | Intermittent. The same cases pass and fail without a code change. A pass/fail history with many flips is the main evidence. |

The AI's answer comes with a rationale, a suggested issue title and a suggested next step. The signature shows whether its classification came from AI or from a person, and the list can be filtered by that. Anyone who can record results can override it from the signature page with **Set classification**; a manual classification always wins, and the AI suggestion stays visible underneath for reference. **Classify with AI** asks for a fresh classification at any time.

A signature is flagged as a **flaky candidate** from history alone, without AI: at least half of its test cases flipped between pass and fail two or more times in their last ten automated verdicts.

## Status

A signature is **Open** until someone handles it:

- **Resolve** it once the cause is fixed. If the same failure comes back, the signature reopens by itself and the new occurrences count against it.
- **Ignore** a signature that is not worth acting on. It stays ignored even when it recurs.
- **Reopen** returns a resolved or ignored signature to the open list.

## Issues

**Link Issue** on the signature page connects it to an issue in the project's issue tracker or to an internal issue; unlinking asks for confirmation. **Create Issue** next to the AI's suggested title opens the tracker's create form pre-filled with that title and a description that links back to the signature, the affected test cases and the latest run, and includes the classification, rationale, suggested next step and the latest stack trace. The new issue is linked to the signature automatically. A signature with a linked issue is a **known issue**: its clusters and result rows on the run page carry the badge, so the next person who opens a red run sees at once that the failure is already tracked.

Notes on the signature page use the same rich-text editor as the rest of the application.

## Signatures without details

Some results arrive with no message or stack trace, for example automation imported from another tool. They cannot be grouped by failure, so each test case gets its own signature named after the case. Reporters, the CLI and results imports all send the failure text, so this only affects historical data.

## Permissions

Everyone who can see the project can see its signatures. Changing status, classification, notes and issue links needs the same permission as recording results: project admin or **Test Runs** add/edit. Settings and **Analyze existing results** are for project admins.
