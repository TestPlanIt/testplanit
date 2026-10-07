---
title: Notifications
---

# Notifications System

TestPlanIt includes a comprehensive notification system that keeps users informed about important events and activities. This document covers how notifications work, user preferences, and email templates.

## Overview

The notification system consists of:

1. **In-app notifications** - Displayed within the TestPlanIt interface
2. **Email notifications** - Sent to users based on their preferences
3. **Notification preferences** - User-configurable settings
4. **Background processing** - Asynchronous job queue for reliable delivery

## Notification Types

Every notification TestPlanIt sends belongs to one of the types below. They are grouped the way they appear under **What to notify me about** on your profile, where each one has a switch that is on by default (see [Choosing which notifications you receive](#choosing-which-notifications-you-receive)). Two types are **always on** and cannot be switched off; two are sent to **administrators** only.

| Group               | Notification                                       | Sent when                                                                                        | Sent to                                                              |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Assignments         | **Work assigned to me**                            | A test run case is assigned to you, singly or in bulk (including automatic distribution)         | The assignee                                                         |
| Assignments         | **Session assigned to me**                         | A session is created with you as its assignee, or reassigned to you                              | The assignee                                                         |
| Comments            | **Mentions in comments**                           | Someone @-mentions you in a comment on a case, run, session or milestone, or in a review comment | Each mentioned user except the author                                |
| Reviews             | **Review requested**                               | A review is requested from you or from a role you hold, singly or in bulk                        | The reviewer or role holders, minus the requester                    |
| Reviews             | **Review approved**                                | A reviewer approves your request                                                                 | The requester                                                        |
| Reviews             | **Changes requested**                              | A reviewer asks for changes on your request                                                      | The requester                                                        |
| Reviews             | **Review rejected**                                | A reviewer rejects your request                                                                  | The requester                                                        |
| Reviews             | **Review cancelled**                               | A request you were asked to review is cancelled, or the item under review is deleted             | The pending reviewers, minus whoever cancelled                       |
| Reviews             | **Review reminders**                               | A review you owe is older than the reminder threshold (hourly), or the requester nudges you      | The pending reviewers                                                |
| Runs and milestones | **Test run ready to complete**                     | Every case in a run has a result; includes a **Review and complete** link                        | Users who can close the run, plus admins and project admins          |
| Runs and milestones | **Milestone due reminders**                        | A milestone is inside its reminder window or overdue (daily)                                     | The milestone creator and everyone involved in its runs and sessions |
| Sharing             | **Share link viewed**                              | Someone opens a share link you created with notify-on-view enabled                               | The link creator                                                     |
| AI and jobs         | **AI steps derived**                               | An AI step-derivation job you started has written steps                                          | The user who started the job                                         |
| Integrations        | **Integration needs re-authorization** (always on) | Your OAuth connection to an integration expired or was revoked; includes a **Reconnect** link    | The connection owner                                                 |
| System              | **Admin announcements** (always on)                | An administrator sends a system notification from **Admin → Notifications**                      | Every active user                                                    |
| System              | **What's New after an upgrade**                    | Your first page load after TestPlanIt is upgraded to a version with release notes                | The current user                                                     |
| Administration      | **New user registrations** (admins)                | A new user signs up through the form, SSO or SAML                                                | All administrators                                                   |
| Administration      | **AI budget alerts** (admins)                      | LLM spend crosses a budget threshold for the billing period                                      | All administrators                                                   |

A type added in a future release is on for everyone automatically; nothing needs to be changed after an upgrade.

## Notification Center UI

### Accessing Notifications

The notification center is accessible from the bell icon in the top navigation bar:

1. **Bell Icon**: Located in the header, next to your user menu
2. **Badge Counter**: Shows unread notification count (displays "9+" for more than 9 unread)
3. **Visual Indicator**: Red badge appears when you have unread notifications
4. **Click to Open**: Click the bell icon to open the notification dropdown panel

### Notification Panel

The notification panel displays when you click the bell icon:

**Panel Features**:

- **Width**: Fixed at 400px for comfortable reading
- **Height**: Scrollable area showing up to 20 most recent notifications
- **Live updates**: New notifications appear within ~1 second via a server-pushed event stream — no polling
- **Focus refresh**: Automatically refreshes when you return to the browser tab

**Panel Header**:

- **Title**: "Notifications" with bell icon
- **Mark All Read Button**: Quickly mark all notifications as read
  - Disabled when no unread notifications
  - Click to mark all as read at once
- **Delete All Button**: Remove all notifications at once
  - Disabled when no notifications exist
  - Displays a confirmation dialog before deleting
  - Soft-deletes all notifications (they will no longer appear in the panel)

### Notification Items

Each notification in the list displays:

**Visual Indicators**:

- **Unread**: Light blue/primary background color
- **System Announcements**: Special blue background color
- **Read**: Standard background (muted)
- **Hover effect**: Background changes on mouse hover

**Notification Content**:

- **Title/Summary**: Bold heading describing the notification
- **Details**: Description with links to relevant items
- **Timestamp**: When the notification was created (formatted per your preferences)
- **Actionable Links**: Click on project, test case, or user names to navigate

**Interaction Behavior**:

- **Auto-mark as Read**: Hover over an unread notification for 1 second to mark it as read automatically
- **Click through**: Click on any link within the notification to navigate to that item
- **Context Menu**: Three-dot menu for additional actions

### Notification Actions

Each notification has a context menu (three-dot icon) with the following actions:

**Mark as Read/Unread**:

- Toggle read status manually
- Option changes based on current state
- Useful for re-reading important notifications

**Delete Notification**:

- Permanently remove the notification
- Cannot be undone
- Keeps your notification list clean

### Empty State

When you have no notifications, the panel displays:

- **Empty message**: "No notifications"
- **Centered text**: Muted, centered in the scrollable area
- **Clean appearance**: Encourages checking back later

### Real-time Features

**Automatic Updates**:

- **Server-pushed updates**: When you sign in, the bell opens a long-lived [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) connection to TestPlanIt. New notifications arrive within ~1 second of being created — no polling, no refresh required.
- **Auto-reconnect**: If the connection drops (network blip, server restart, deploy), the browser automatically reconnects and re-syncs missed notifications.
- **Window focus**: When you return to the tab, the panel refreshes immediately as a safety net for anything that might have been missed during a long sleep/suspend.
- **URL parameter**: Can open notifications automatically with `?openNotifications=true`.

**Badge Counter**:

- Updates in real-time as notifications arrive
- Shows unread count accurately
- Caps display at "9+" for readability

:::note Operator note

For SSE to work behind a load balancer, the ingress / reverse proxy must allow long-lived streamed responses (no buffering, idle timeouts ≥ 1 hour). See [SSE Notifications and Live Updates](../sse-notifications.md) for nginx-ingress, Traefik, AWS LBC, and plain nginx configuration recipes plus the tuning environment variables. The same ingress recipe also covers the project-scoped issue-update stream that powers live updates from inbound [webhooks](./webhooks.md).

:::

### Notification Details by Type

#### Work Assigned Notifications

**Single Assignment**:

- Shows who assigned the work
- Links to the specific test case
- Displays the test run name
- Shows project context
- Direct link with `?selectedCase=` parameter for easy access

**Bulk Assignment**:

- Indicates multiple test cases assigned
- Shows count of assigned items
- Groups by test run
- Lists each test run with case count
- Provides links to each test run

#### Comment Mention Notifications

When someone mentions you with `@username`:

- Shows who mentioned you
- Displays the comment preview
- Links to the commented item (test case, run, or session)
- Includes project context
- Direct navigation to the comment

If you are mentioned in a project you do not have access to, the notification is redacted: the message names the project and who mentioned you, but does not name the specific item or include a clickable link. This protects the project's contents while still letting you know that someone tried to loop you in.

#### System Announcement Notifications

**Special Formatting**:

- Distinctive blue background color
- Megaphone icon indicator
- System-wide importance
- Usually from administrators
- May include rich formatting

**Content Types**:

- Maintenance notices
- Feature announcements
- System updates
- Policy changes
- Important deadlines

#### Milestone Due Reminder Notifications

When a milestone's due date is approaching or has passed, notifications are automatically sent to all users who have participated in the milestone's work.

**Recipients Include**:

- Milestone creator
- Test run creators for runs in the milestone
- Users assigned to test cases
- Users who have executed test results
- Session creators for sessions in the milestone
- Users assigned to sessions

**Notification Variants**:

- **Due Soon**: Sent when the milestone is within the configured notification window (e.g., 5 days before due date)
- **Overdue**: Sent when the milestone's due date has passed

**Features**:

- Each user receives only one notification per milestone per day (deduplicated)
- Notifications link directly to the milestone details page
- Processing occurs daily at 6:00 AM server time
- Overdue notifications continue until the milestone is marked complete

**Enabling Milestone Notifications**:

1. Navigate to the milestone details page
2. Set a due date for the milestone
3. Enable the "Notify days before due date" toggle
4. Configure how many days before the due date to start notifications

For more details, see [Milestone Details - Due Date Notifications](./projects/milestone-details.md#due-date-notifications).

#### Test Run Ready to Complete Notifications

When the last outstanding piece of work in a test run receives a final result, everyone who can close that run is told it is ready.

**What "ready" means**:

- Every live test case in the run carries a status that counts as **completed** in the workflow. A case left **Untested**, or moved to a status such as **Retest** or **Blocked**, keeps the run open — those are explicit "not finished" signals, not missing data.
- For [parameterized cases](./projects/parameterized-test-cases.md), every **iteration** must also carry a completed status. A case with one of ten iterations passed does not count as executed.
- Cases removed from the run no longer hold it open.
- A run with no cases at all never qualifies.

**Recipients**: The users who could actually complete the run — anyone whose effective role in the project grants **canClose** on **Test Runs**, plus system administrators and project administrators with access to the project.

**Features**:

- **The run is not completed for you.** Completing a run is irreversible, so the notification is a prompt, not an action — it carries a **Review and complete** link to the run, and the decision stays with a person.
- Only **manual** runs are covered. Automated runs report through their CI job rather than case-by-case execution, so these counts don't describe them; see [Abandoned automation cleanup](./statuses.md#abandoned-automation-cleanup) for closing those.
- **One notification per fill-up.** A run notifies once when it becomes fully executed. If it stops being fully executed — a result is deleted, or a new case is added — it re-arms, and notifies again the next time it fills up.
- Evaluation runs a few seconds behind the result that triggered it, which also collapses a bulk submission of many results into a single notification rather than one per case.
- Runs that are already completed are skipped.

:::note Very broad recipient lists are skipped
If a project is configured so that its **default access** role can close test runs, every active user in the deployment becomes a recipient. Above 100 recipients the notification stops being a signal, so it is skipped for that run and a warning is written to the server logs instead. If your team expects these notifications and never receives them, check whether the project's default role grants **canClose** on Test Runs — see the [Permissions Guide](./permissions-guide.md).
:::

## User Preferences

Two settings on your profile control notifications. The **notification mode** decides _how_ you are reached; the per-type switches decide _what_ you are told about.

### Notification Modes

Users can configure their notification preferences with these modes:

1. **In-App Only** (`IN_APP`) - Notifications appear only in the application
2. **In-App + Immediate Email** (`IN_APP_EMAIL_IMMEDIATE`) - Get both in-app and immediate email notifications
3. **In-App + Daily Digest** (`IN_APP_EMAIL_DAILY`) - In-app notifications plus a daily email summary at 8 AM
4. **None** (`NONE`) - No notifications (not recommended)
5. **Use Global Settings** (`USE_GLOBAL`) - Follow system-wide default settings

### Choosing which notifications you receive

Below the notification mode, the **What to notify me about** section lists every notification type you can receive, grouped as in the [table above](#notification-types), each with a switch:

- Every switch is **on by default**. Switch a type off to stop it on every channel: the bell, immediate email and the daily digest. The change saves as soon as you flip the switch.
- **Always on** types (integration re-authorization, admin announcements) are shown switched on and cannot be changed.
- Types sent only to administrators appear only on an administrator's profile.
- **Reset to defaults** turns every type back on.
- If your effective mode is **None**, the switches stay editable, but nothing is delivered until you pick another mode.

Muting a type affects only what _you_ receive. A review request to a role you hold is still created and still appears in your [Reviews inbox](reviews-inbox.md); you are simply not notified about it, and the requester's recipient preview counts you as silenced.

### Configuring Preferences

Users can manage their notification preferences in their profile:

1. Navigate to your user profile
2. Open the **Preferences** section and click **Edit**
3. Select your preferred notification mode and save
4. Under **What to notify me about**, switch off any type you do not want

## Email Templates

TestPlanIt uses Handlebars templates for all email notifications, providing consistent, professional formatting.

### Template Structure

```text
lib/email/
├── template-service.ts      # Template rendering engine
├── notificationTemplates.ts # Email sending functions
├── templates/
│   ├── layouts/
│   │   └── main.hbs        # Base email layout
│   ├── partials/           # Reusable components
│   ├── notification.hbs    # Single notification
│   └── daily-digest.hbs    # Daily summary
```

### Available Templates

#### Single Notification Email

Sent immediately when events occur (if user has immediate email mode):

- Clean, focused design
- Direct link to the relevant item
- Unsubscribe/preference links

#### Daily Digest Email

Sent at 8 AM daily containing all unread notifications:

- Summary of all notifications from the past 24 hours
- Grouped by type and priority
- Single email reduces inbox clutter

### Email Configuration

Configure email settings in your `.env` file:

```text
EMAIL_SERVER_HOST=smtp.example.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=notifications@example.com
EMAIL_SERVER_PASSWORD=your-password
EMAIL_FROM=noreply@example.com
```

## Architecture

### Components

1. **Notification Worker** (`workers/notificationWorker.ts`)
   - Processes notification creation jobs
   - Determines user preferences
   - Queues email jobs when needed
   - After creating each `Notification` row, publishes a small `{id, event}` wake-up payload to a tenant-scoped Valkey channel so live SSE subscribers refetch immediately

2. **SSE Stream Route** (`app/api/notifications/stream/route.ts`)
   - Serves the long-lived `text/event-stream` connection that the bell consumes
   - Subscribes per-connection to the user's Valkey channel and the tenant broadcast channel
   - Treats wake-up payloads as opaque "something changed" signals; the bell re-fetches through the policy-enforced ZenStack hook so multi-tenant isolation and access control are re-applied on every read
   - Enforces per-user (4) and per-tenant (1000, default) connection caps and a 25-second heartbeat for proxy-friendly liveness

3. **Email Worker** (`workers/emailWorker.ts`)
   - Sends actual emails
   - Handles retries and failures
   - Processes both immediate and digest emails

4. **Scheduler** (`scheduler.ts`)
   - Sets up cron jobs for daily digests
   - Runs at 8 AM daily

5. **Queue System** (BullMQ + Valkey)
   - Ensures reliable delivery
   - Handles retries automatically
   - Prevents duplicate notifications
   - The same Valkey is reused for the SSE pub/sub fan-out — channels are namespaced by tenant prefix, no separate Valkey deployment needed

### Flow Diagram

```text
Event Occurs → Create Notification Job → Notification Worker
                                              ↓
                                    Check User Preferences
                                              ↓
                        ┌─────────────────────┼─────────────────────┐
                        ↓                     ↓                     ↓
                   IN_APP Only         EMAIL_IMMEDIATE         EMAIL_DAILY
                        ↓                     ↓                     ↓
                 Store in DB          Queue Email Job      Store for Digest
                        ↓                     ↓
              Publish to Valkey         Email Worker
                  (wake-up)                   ↓
                        ↓               Send Email
              SSE Route relays
                        ↓
              Bell refetches → Badge updates
```

For ingress / proxy configuration required to run SSE reliably behind a load balancer, see [SSE Notifications and Live Updates](../sse-notifications.md). The same page covers the project-scoped issue-update stream used by inbound [webhooks](./webhooks.md).

## Global Settings

Administrators can configure system-wide defaults:

1. Navigate to Admin → Notification Settings
2. Set the default notification mode
3. Configure email sending limits
4. Manage notification types

## Best Practices

### For Users

- Choose a notification mode that matches your workflow
- Daily digest is recommended for most users
- Check in-app notifications regularly
- Keep your email address up to date

### For Administrators

- Set reasonable global defaults
- Monitor email sending rates
- Ensure Valkey has sufficient memory
- Configure SMTP settings properly
- Test email delivery regularly

## Troubleshooting

### Notifications Not Appearing

1. Check your notification preferences
2. Ensure you haven't selected "None"
3. Verify your email address is correct
4. Check spam/junk folders

### Bell does not update in real time

If new notifications only appear after a manual page refresh, the SSE event stream is not reaching the browser. This is almost always an ingress / reverse-proxy configuration issue, not an application bug.

1. In the browser DevTools Network tab, filter for `stream`. There should be one long-lived `/api/notifications/stream` request with status `200` and `Content-Type: text/event-stream`.
2. If the request returns `401`, the user is not signed in (expected on the sign-in page).
3. If the request closes after a few seconds, the proxy is buffering the response or applying a short idle timeout. See [SSE Notifications](../sse-notifications.md) for nginx-ingress, Traefik, AWS LBC, and plain nginx fixes.
4. Server logs include a `sse.connections.active` JSON line every 30 seconds per tenant — if that line is missing, no connections are reaching the route.

### Emails Not Sending

1. Verify SMTP configuration in `.env`
2. Check email worker logs: `docker logs testplanit-workers`
3. Ensure Valkey is running
4. Verify network connectivity to SMTP server

### Daily Digest Issues

1. Check scheduler is running: `docker exec testplanit-workers pm2 list`
2. Verify cron job is scheduled
3. Check timezone settings
4. Review worker logs for errors

## Development

### Adding New Notification Types

1. Add the type to the `NotificationType` enum in `schema.zmodel` and run `pnpm generate`
2. Add a matching entry to the catalogue in `lib/notifications/catalogue.ts` (group, audience, whether it is optional) and the `users.profile.notifications.types.<TYPE>` label and description in `messages/en-US.json`; the catalogue test fails until both exist
3. Add a rendering branch in `components/NotificationContent.tsx` and, if the type is emailed, in `workers/emailWorker.ts`
4. Queue the notification job when the event occurs; the worker applies the user's mode and muted-type preferences, so no per-type delivery code is needed

### Creating New Email Templates

1. Create template file in `lib/email/templates/`
2. Use Handlebars syntax
3. Include common variables (userName, appUrl, etc.)
4. Test with different email clients

Example template:

```handlebars
<h2>{{title}}</h2>
<p>Hi {{userName}},</p>
<p>{{message}}</p>
<a href='{{actionUrl}}' class='button'>{{actionText}}</a>
```

### Testing Notifications

1. Use development environment with MailHog
2. Configure test SMTP settings
3. Trigger events to generate notifications
4. Verify email rendering and delivery

## Security Considerations

- Never include sensitive data in notifications
- Use secure SMTP connections (TLS/SSL)
- Implement rate limiting for email sending
- Validate email addresses before sending
- Include unsubscribe links in all emails
- Log notification activity for audit purposes
