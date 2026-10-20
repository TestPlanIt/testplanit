---
sidebar_label: 'Failure Patterns'
title: 'Failure Patterns Settings'
description: Turn failure grouping and AI root cause suggestion on or off for a project, and group the automated failures already recorded
---

# Failure Patterns Settings

The project-level **Settings → Failure Patterns** page controls [Failure Patterns](../../failure-patterns.md) for the project.

## Enable Failure Patterns

On by default. Every automated failure that arrives in the project is grouped into a pattern a few seconds later. Grouping is deterministic and does not use an AI model. Turning it off hides **Failure Patterns** from the project menu and stops grouping; existing patterns are kept.

## Suggest root causes with AI

On by default. Each new pattern is sent to the project's AI model, which picks one of the [Root Causes](../../root-causes.md) (product bug, test bug, environment or flaky by default) and explains its choice. This needs an AI model assigned to the **Failure Patterns: Root Cause** feature: the project's default model, or a model chosen for that feature on the project's [AI Models](ai-models.md) page. Without a model no root cause is suggested and no error is shown. Turn the switch off to keep grouping without any AI calls; **Suggest root cause with AI** on a pattern page still works on demand.

## Release quarantine automatically after N consecutive passes

On by default, with five passes. A [quarantined](../../failure-patterns.md#quarantine) test case is released once it has passed this many times in a row since it was quarantined; skipped results are ignored and a failure starts the count over. Turn the switch off to release quarantines only by hand. A quarantine created with **Keep quarantined until released by hand** is never released automatically, whatever this setting says.

## Analyze existing results

Groups every automated failure already recorded in the project that has not been grouped yet. The analysis runs in the background; the page shows its progress and reports when it is done. When AI root cause suggestion is on, patterns seen in the last 30 days get suggestions afterwards, up to 100 at a time.

Use this once after enabling the feature on a project with history, or after importing results from another tool.
