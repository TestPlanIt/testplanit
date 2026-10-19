---
sidebar_label: 'Failure Triage'
title: 'Failure Triage Settings'
description: Turn failure grouping and AI classification on or off for a project, and group the automated failures already recorded
---

# Failure Triage Settings

The project-level **Settings → Failure Triage** page controls [Failure Triage](../../failure-triage.md) for the project.

## Enable Failure Triage

On by default. Every automated failure that arrives in the project is grouped into a signature a few seconds later. Grouping is deterministic and does not use an AI model. Turning it off hides **Failure Triage** from the project menu and stops grouping; existing signatures are kept.

## Classify new signatures with AI

On by default. Each new signature is sent to the project's AI model for classification as a product bug, test bug, environment problem or flaky, with a confidence and a rationale. This needs an AI model assigned to the **Failure Triage Classification** feature: the project's default model, or a model chosen for that feature on the project's [AI Models](ai-models.md) page. Without a model nothing is classified and no error is shown. Turn the switch off to keep grouping without any AI calls; **Classify with AI** on a signature page still works on demand.

## Analyze existing results

Groups every automated failure already recorded in the project that has not been grouped yet. The analysis runs in the background; the page shows its progress and reports when it is done. When AI classification is on, signatures seen in the last 30 days are classified afterwards, up to 100 at a time.

Use this once after enabling the feature on a project with history, or after importing results from another tool.
