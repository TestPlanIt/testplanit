---
sidebar_label: 'Notifications'
title: 'Notifications'
description: The in-app notification center, delivery channels, and per-user notification preferences
---

# Notifications

Every user has a personal **notification center** — the bell icon in the top navigation. It surfaces assignments, mentions, milestone reminders, review activity, share-link views, job-completion alerts, and system announcements, and can optionally deliver them by email.

:::note
This is the user-facing notification inbox. To configure system-wide notification defaults, email templates, and announcements, see [Notifications (Administration)](notifications.md).
:::

## The notification bell

Click the **bell** in the top navigation to open the notification center. A badge shows your unread count (displayed as `9+` above nine). The dropdown lists your **20 most recent** notifications, newest first; unread items are highlighted.

Each notification links to the relevant place in the app — the assigned case in its run, the mentioned comment, the milestone, the generated test cases, and so on.

### Actions

From a notification's three-dot menu:

- **Mark as read** / **Mark as unread**
- **Delete** — removes the notification

From the header of the dropdown:

- **Mark all as read**
- **Delete all** — removes all your notifications (with confirmation)

:::tip
Hovering an unread notification for a moment automatically marks it read. You can also deep-link straight to the open notification center by appending `?openNotifications=true` to any app URL.
:::

## Notification types

TestPlanIt sends notifications for, among others:

- **Work assigned** — a test case (or several) assigned to you in a run.
- **Session assigned** — an exploratory session assigned to you.
- **Comment mention** — you were @-mentioned on a case, run, session, or milestone.
- **Milestone due reminder** — a milestone is due soon or overdue.
- **Share link accessed** — someone opened a share link you own.
- **Review activity** — a review was requested, approved, rejected, had changes requested, was cancelled, or is still pending (see [Review & Approval](review-approvals.md) and the [Reviews inbox](reviews-inbox.md)).
- **Job complete** — a long-running job such as copy/move or generate-from-URL finished.
- **AI budget alert** — an LLM budget threshold was reached (informational only).
- **System announcement** — an admin broadcast.
- **New user registration** — sent to administrators.

## Delivery and live updates

Notifications arrive in the bell in **near-real time** over a live server-sent events stream — there's no need to refresh. Depending on your preference (and whether email is configured for your deployment), they can also be delivered by email, either immediately or as a once-daily digest.

## Notification preferences

Set how you receive notifications from your **profile page** under **Notification Preferences**. The **Notification Mode** options are:

| Mode | Behavior |
| --- | --- |
| **Use Global Settings** | Inherit the system-wide default an administrator set. |
| **None** | No notifications. |
| **In-App Only** | Bell notifications only. |
| **In-App + Email (Immediate)** | Bell plus an email per notification. |
| **In-App + Email (Daily Digest)** | Bell plus a single daily summary email. |

:::info
The email options appear only when an email server is configured for your deployment. Preferences are a single global mode, not per-type toggles.
:::

## Related pages

- [Notifications (Administration)](notifications.md) — system defaults, email templates, and announcements.
- [User Profile](user-profile.md) — where notification preferences live.
- [Reviews inbox](reviews-inbox.md) — act on review requests.
