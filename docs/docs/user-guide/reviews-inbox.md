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
