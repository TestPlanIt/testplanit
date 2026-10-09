---
sidebar_label: 'Notifications'
title: 'Notifications'
description: The in-app notification center, delivery channels, and per-user notification preferences, including which notification types to receive
---

# Notifications

Every user has a personal **notification center** — the bell icon in the top navigation. It surfaces assignments, mentions, milestone reminders, review activity, share-link views, AI job results, and system announcements, and can optionally deliver them by email. You choose which kinds you receive.

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

TestPlanIt sends these kinds of notification. Each one can be switched off from your profile except the two marked **always on**; the full table of when each fires and who receives it is in [Notifications (Administration)](notifications.md#notification-types).

- **Work assigned to me** — a test case (or several) assigned to you in a run.
- **Session assigned to me** — an exploratory session assigned to you.
- **Mentions in comments** — you were @-mentioned on a case, run, session, milestone, or review.
- **Review requested / approved / changes requested / rejected / cancelled / reminders** — activity on reviews you requested or were asked to give (see [Review & Approval](review-approvals.md) and the [Reviews inbox](reviews-inbox.md)).
- **Test run ready to complete** — every case in a test run has been executed, and you are someone who can close it (see [Test Runs](projects/runs.md#ready-to-complete-notifications)).
- **Milestone due reminders** — a milestone is due soon or overdue.
- **Share link viewed** — someone opened a share link you own that has notify-on-view enabled.
- **AI steps derived** — an AI step-derivation job you started has finished.
- **Integration needs re-authorization** (always on) — an OAuth integration you connected must be reconnected.
- **Admin announcements** (always on) — an admin broadcast.
- **What's New after an upgrade** — release notes on your first visit after an upgrade.
- **New user registrations** and **AI budget alerts** — sent to administrators only.

## Delivery and live updates

Notifications arrive in the bell in **near-real time** over a live server-sent events stream — there's no need to refresh. Depending on your preference (and whether email is configured for your deployment), they can also be delivered by email, either immediately or as a once-daily digest.

## Notification preferences

Two settings on your **profile page**, under **Preferences**, control notifications. The **Notification Mode** decides how you are reached:

| Mode                              | Behavior                                              |
| --------------------------------- | ----------------------------------------------------- |
| **Use Global Settings**           | Inherit the system-wide default an administrator set. |
| **None**                          | No notifications.                                     |
| **In-App Only**                   | Bell notifications only.                              |
| **In-App + Email (Immediate)**    | Bell plus an email per notification.                  |
| **In-App + Email (Daily Digest)** | Bell plus a single daily summary email.               |

:::info
The email options appear only when an email server is configured for your deployment.
:::

**What to notify me about** (on the **Notifications** tab of your [Notifications & Alerts](./alerts.md) page, below the notification mode) lists every notification type, grouped, each with a switch that is **on by default**. Click **Edit**, switch a type off to stop it everywhere — bell, immediate email and daily digest — for you alone, then **Save**. **Always on** types cannot be switched off, administrator-only types appear only for administrators, and **Reset to defaults** turns everything back on. Types added in a future release are on automatically.

## Related pages

- [Notifications (Administration)](notifications.md) — system defaults, email templates, and announcements.
- [User Profile](user-profile.md) — where notification preferences live.
- [Reviews inbox](reviews-inbox.md) — act on review requests.
