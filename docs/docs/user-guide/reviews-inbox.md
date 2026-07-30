---
sidebar_label: 'Reviews'
title: 'Reviews Inbox'
description: Where reviewers see and act on review requests for test cases, runs, and sessions
---

# Reviews Inbox

The **Reviews** inbox is where reviewers see review requests assigned to them and approve, request changes on, or reject them. It backs the [Review & Approval](review-approvals.md) workflow, where transitions into review-gated states are blocked until an approval exists.

:::note
The Reviews inbox is available to every signed-in user. The **inbox icon** in the top navigation appears only when you have access to at least one project that has the review workflow enabled, and shows a badge with your pending count.
:::

## How to access

Click the **inbox icon** in the top navigation, or go to **/reviews**.

Pending requests also appear at the top of **Your Assignments** on the [Dashboard](dashboard.md), above your own test runs and sessions. That list shows the five oldest and links to the full inbox when there are more.

## The inbox

The inbox has two tabs:

- **Pending** — requests assigned to you (directly or via a role you hold) that are awaiting a decision. Sorted oldest first, so the most overdue is on top.
- **Decided** — requests you've already decided, most recent first.

Two filters narrow the list: **Entity type** (test cases, test runs, sessions) and **Project**.

Each row shows the entity, its project, the requester, the workflow transition being reviewed (**From → To**), and when it was requested or decided. On the Decided tab, a status badge shows the outcome: **Approved**, **Changes requested**, **Rejected**, or **Cancelled**.

## Test Case Details Panel

Clicking a test case name on either tab opens its [Test Case Details](projects/repository-case-details.mdx) in a docked panel beside the inbox, without leaving the queue — your tab, filters, and place in the list are all still there when you close it. The panel carries the same review banner and **Approve** / **Request changes** / **Reject** controls the case's own page has, so you can read the case and decide in one place. The selected request's row stays highlighted in the list.

- **Resizable split**: Drag the divider between the list and the panel to set how much space each takes. Your split is remembered.
- **Full-width toggle**: The expand control in the panel header hides the list so the details fill the whole content area; collapse it to return to the split view. On narrow viewports the panel automatically takes over the full width.
- **Prev/next navigation**: The header shows the case's position as "N of total" and steps through the test cases in the current tab, skipping test run and session rows. When focus is not in a field or editor, the left/right arrow keys step to the previous/next case. A case that has left the list — for example once you've decided it — stays open in the panel without a position.
- **Open full page and close**: The header also links to the standalone full-page view (opens in a new tab) and provides a close control. The browser Back button closes the panel as well. Ctrl/Cmd-clicking a case name in the list opens the full page in a new tab instead of the panel.

Test run and session rows have no panel — their names still link to the run or session page.

## Acting on a request

From a pending request (in the inbox or on the entity's own page):

- **Approve** — approve the request; an approval note is optional. This performs the gated transition: the entity moves into the target state.
- **Request changes** — send it back with required feedback explaining what to change.
- **Reject** — decline the request with a required reason.

:::info
A request can be decided only once. If someone else decides it first, or the requester cancels it, you'll be told it has already been decided. If your eligibility changed, the action is declined.
:::

## Requesting a review

Reviews are requested from a test case, run, or session — not from the inbox. On the entity, use **Request Review** and choose:

- **Assignee** — a specific user or a role. Only users or roles with the **Can Approve** permission for that area can be selected. You can't assign a review to yourself.
- **Target state** — the review-gated state you want to move to.
- **Comment** — optional context for the reviewer.

While a request is pending, the entity shows a banner. The requester (or an administrator) can **cancel** it, and after changes are requested or a rejection, can **request review again** — pre-filled with the previous assignee and target state.

## How it connects to workflows

Workflow states can be marked as **requiring review**. A forward transition into such a state is blocked until an **approved** review request exists for that transition. Approving a request performs that transition and consumes the approval (one-shot). Backward or same-state moves are never gated.

The review feature has two switches: a **system-wide** toggle under [Administration → Workflows](workflows.md) and a **per-project** toggle under the project's [Advanced settings](projects/settings/advanced.md). When the feature is disabled, existing requests are preserved and reappear when it's re-enabled.

## Permissions

A user can decide a request when they are a system administrator, or when they hold the **Can Approve** permission for the entity's area **and** are the assigned reviewer (directly or through the assigned role). The same **Can Approve** requirement governs who can be assigned a review.

## Notifications and reminders

Requesting, approving, requesting changes, rejecting, and cancelling all generate [notifications](notifications-inbox.md) for the relevant people. Requests left pending past a configurable threshold trigger a reminder notification.

## Related pages

- [Review & Approval](review-approvals.md) — the full workflow gating model.
- [Project Advanced settings](projects/settings/advanced.md) — the per-project review toggle.
- [Roles](roles.md) — granting the **Can Approve** permission.
- [Notifications](notifications-inbox.md) — how review activity reaches you.
