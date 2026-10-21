---
sidebar_label: 'Advanced'
title: 'Advanced (Project Settings)'
description: Per-project default template and toggles for review gating, requirements, result governance, draft-case handling, composition locking, dependency enforcement, and the result edit window
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

Each toggle and the default template save immediately. The project code (when shown) and the result edit window each have their own **Save** button.

### Project code

Appears only when the **Record Keys** feature is enabled system-wide. It sets this project's short code — the prefix used in cosmetic record keys such as `PROJECT-TC-1234`.

- Enter **2–10 uppercase letters** (no digits). The field suggests a code derived from the project name, which you can accept with one click or replace.
- As you type, an example key is previewed and the code is checked live against other projects; codes are unique across the instance, so one already in use is rejected before you save.
- Leave it **blank** to keep showing plain numeric IDs for this project.

See [Record Keys](../../record-keys.md) for how keys are formatted and where they appear.

### Default template

Sets the [template](../../templates-fields.md) that new test cases and sessions in this project start with. The list shows the enabled templates assigned to the project; the system default template is marked with a star.

- **Use System Default** (the default) — new cases and sessions start with the system default template when it's assigned to the project, otherwise with the project's first template.
- **A specific template** — new cases and sessions start with that template instead of the system default.

The default applies wherever a template is preselected: **Add Test Case**, the quick-add row, case import, AI test case generation, test result import, **Add Session**, the Jira panel, webhook actions that [generate test cases with AI](../../webhooks.md), and the API and MCP server when no template is given. In each template picker a star marks the preselected template; hover it to see whether it's the **Project Default** or the **System Default**. Users can still choose any other template assigned to the project.

If the selected template is later disabled, deleted, or unassigned from the project, a warning appears on this page and new cases and sessions fall back to the system default until you choose another template or restore it.

### Enable review workflow

When enabled, transitions into workflow states that require review are gated by an approved review request. Testers see a **Request Review** button; reviewers receive notifications and act from the [Reviews inbox](../../reviews-inbox.md).

:::info
If the review feature is turned off system-wide (under **Administration → Workflows**), this project preference is saved but nothing is gated until an administrator enables the feature globally. A warning appears when that's the case.
:::

### Enable requirements

When enabled, a **Requirements** area is added to the project for building a tree of what the system should do and linking test cases to requirements for coverage. Off by default.

This toggle alone shows an empty tree you can author in directly; tracker-synced requirements additionally need requirement types classified on the [Issue Integrations](integrations.md#requirement-sync) page. See [Requirements](../requirements.md#enabling-requirements) for the full two-step enablement.

### Require justification on result flip

When enabled, recording a result that flips a completed outcome (for example **Passed → Failed**) requires **Result Details** explaining the change.

### Require a linked issue on failure

When enabled, recording a failure result requires at least one linked issue.

This setting is unavailable (and shown off) when the project has no active issue integration — without one, results can't link an issue. Assign an [issue integration](integrations.md) to enable it.

### Exclude draft cases from test runs

When enabled, test cases in a *Not Started* workflow state are hidden from the **Add Cases** picker and can't be added to a run. If an existing case is reverted to *Not Started* (for example by a Review & Approval rejection), it's removed from any open run — unless it already has a recorded result, in which case it stays in the run but becomes read-only.

### Lock run composition when execution starts

When enabled, a test run's case composition is **automatically locked** the moment the run moves into an *In Progress* workflow state. A locked run's case set is frozen — no adding, removing, or reordering cases — while assigning and executing cases continue to work. See [Composition lock](../run-details.md#composition-lock) for how the lock behaves and who can unlock it.

This is off by default; existing projects are unaffected on upgrade. Even with the toggle off, a run's composition can still be locked manually from the run itself.

### Enforce test case dependencies in test runs

When enabled, a test case in a run is **blocked** until every case it depends on — a *Depends on* [test case link](../test-case-links.md#depends-on) — has **passed** in that same run. Blocked cases are marked in the run's case table and execution panel, and results for them are refused by the server (web app, API and MCP alike). When the last dependency passes, the case's assignee is notified that it is ready to execute. Dependencies that are not in the run don't block.

Off by default; existing projects are unaffected on upgrade. Turning it on gates new results only and never changes results already recorded; turning it off re-opens every case immediately. Automated results imported from CI are not gated. See [Enforcing dependencies in test runs](../test-case-links.md#enforcing-dependencies-in-test-runs) for the full rules, including parameterized cases and multi-configuration runs.

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
