---
sidebar_position: 16
title: System Announcements
---

# System Announcements

System Announcements let administrators send a message to every user of the TestPlanIt instance. An announcement is delivered through the notification system and appears in each user's notification bell.

## Overview

A system announcement:

- Is sent by a system administrator
- Has a **title** and a rich-text **message**
- Is sent immediately to every active user, except users whose notification mode is **None**
- Appears in the notification bell as a **System Announcement**
- Is recorded in the **Notification History** on the admin page

Typical uses are maintenance windows, security notices, policy changes, and new feature announcements.

## Sending an Announcement

Only users with the `ADMIN` access level can send announcements.

1. Open **Administration** and select **Notifications** (under **Tools & Integrations**).
2. In the **System Notifications** card, enter a **title**.
3. Write the **message** in the rich text editor. Formatting such as bold, italics, lists, headings, and links is preserved when the announcement is displayed.
4. Click **Send Notification**.

The announcement is sent straight away, and a confirmation shows how many users it was sent to. There is no draft, scheduling, or targeting: it goes to every active user. The count includes users whose notification mode is **None**, who do not receive it.

:::note
A sent announcement cannot be edited or recalled. Check the title and message before sending.
:::

## Notification History

The **Notification History** table below the form lists every announcement that has been sent, with its title, message, sender (**Sent By**), and send time (**Sent At**).

## How Users See Announcements

- **Notification bell**: The announcement appears in the bell with its title and formatted message. Users can mark it read or unread, or delete it, like any other notification.
- **Email**: Whether the announcement is also emailed — immediately or in the daily digest — follows each user's notification mode. See [Notifications](./notifications.md).
- **Mode None**: A user whose notification mode is **None** receives no notifications at all, including announcements.

System announcements cannot be switched off individually under **What to notify me about**. Only the **None** mode stops them.

## Default Notification Mode

The same admin page sets the **Default Notification Mode** for the instance — **In-App Only**, **In-App + Email (Immediate)**, or **In-App + Email (Daily Digest)**. It applies to users who have left their own mode on **Use Global Settings**. Click **Save Settings** after changing it.

## Best Practices

1. **Clear title**: Say what is happening in the title; many users read no further.
2. **Keep it short**: Put the date, the impact, and the action required first.
3. **Give advance notice**: Announce maintenance and policy changes before they take effect.
4. **Avoid overload**: Every announcement reaches every user, so send them sparingly.
5. **Include a contact**: Say who to ask for help.

## Example

```text
Title: Scheduled maintenance — Saturday 2:00–6:00 AM

TestPlanIt will be unavailable on Saturday, March 15th from 2:00 AM to 6:00 AM
while we upgrade the database.

Before maintenance:
- Save any work in progress
- Plan testing for after 6:00 AM

Questions? Contact your TestPlanIt administrator.
```

## Troubleshooting

**A user did not receive an announcement by email:**

- Check the user's notification mode on their [Notifications & Alerts](./alerts.md) page — **In-App Only** sends no email.
- Confirm the instance has an email server configured.

**A user did not receive an announcement at all:**

- Check the user's notification mode. With **None**, nothing is delivered.
- Announcements go to users who were active when it was sent. A user created or reactivated afterwards does not receive earlier announcements.
