---
sidebar_label: 'Advanced'
title: 'Advanced (Project Settings)'
description: Per-project toggles for review gating, result governance, draft-case handling, and the result edit window
---

# Advanced

The project-level **Settings → Advanced** page holds per-project toggles for opinionated workflow and result-governance features. New toggles appear here as they're introduced.

:::note
Only system administrators and project administrators can open this page. There are **no destructive actions** on this page — it does not delete or archive the project.
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Advanced**.

## Settings

Each toggle saves immediately, except the result edit window, which has its own **Save** button.

### Enable review workflow

When enabled, transitions into workflow states that require review are gated by an approved review request. Testers see a **Request Review** button; reviewers receive notifications and act from the [Reviews inbox](../../reviews-inbox.md).

:::info
If the review feature is turned off system-wide (under **Administration → Workflows**), this project preference is saved but nothing is gated until an administrator enables the feature globally. A warning appears when that's the case.
:::

### Require justification on result flip

When enabled, recording a result that flips a completed outcome (for example **Passed → Failed**) requires **Result Details** explaining the change.

### Require a linked issue on failure

When enabled, recording a failure result requires at least one linked issue.

This setting is unavailable (and shown off) when the project has no active issue integration — without one, results can't link an issue. Assign an [issue integration](integrations.md) to enable it.

### Exclude draft cases from test runs

When enabled, test cases in a *Not Started* workflow state are hidden from the **Add Cases** picker and can't be added to a run. If an existing case is reverted to *Not Started* (for example by a Review & Approval rejection), it's removed from any open run — unless it already has a recorded result, in which case it stays in the run but becomes read-only.

### Result edit window

Controls how long after a result is recorded it can still be edited in place. After the window closes, corrections require a new attempt. System administrators can always edit. Choose one of:

- **Inherit system default** — use the system-wide policy.
- **Disable editing for this project** — results lock immediately after they're recorded.
- **Custom window** — enter a number of minutes (capped to the system maximum), then **Save**.

:::note
The available range is bounded by the system-wide **Edit Results Duration** in [Application Configuration](../../app-config.md). If editing is disabled system-wide, this control is replaced by a notice and can't be overridden upward.
:::

## Related pages

- [Review & Approval](../../review-approvals.md) — how the review workflow works end to end.
- [Reviews inbox](../../reviews-inbox.md) — where reviewers act on requests.
