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

TestPlanIt currently supports the following notification types:

- **Work Assigned** - When a test case or exploratory testing session is assigned to you
- **Comment Mentions** - When someone mentions you in a comment (@username)
- **System Announcements** - Important system-wide announcements and updates

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
- **Auto-refresh**: Updates every 5 seconds when open, every 30 seconds when closed
- **Focus refresh**: Automatically refreshes when you return to the browser tab

**Panel Header**:

- **Title**: "Notifications" with bell icon
- **Mark All Read Button**: Quickly mark all notifications as read
  - Disabled when no unread notifications
  - Click to mark all as read at once

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

- **Polling intervals**:
  - 5 seconds when panel is open
  - 30 seconds when panel is closed
  - Continues even when browser tab is in background
- **Window focus**: Refreshes immediately when you return to the tab
- **URL parameter**: Can open notifications automatically with `?openNotifications=true`

**Badge Counter**:

- Updates in real-time as notifications arrive
- Shows unread count accurately
- Caps display at "9+" for readability

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

## User Preferences

### Notification Modes

Users can configure their notification preferences with these modes:

1. **In-App Only** (`IN_APP`) - Notifications appear only in the application
2. **In-App + Immediate Email** (`IN_APP_EMAIL_IMMEDIATE`) - Get both in-app and immediate email notifications
3. **In-App + Daily Digest** (`IN_APP_EMAIL_DAILY`) - In-app notifications plus a daily email summary at 8 AM
4. **None** (`NONE`) - No notifications (not recommended)
5. **Use Global Settings** (`USE_GLOBAL`) - Follow system-wide default settings

### Configuring Preferences

Users can manage their notification preferences in their profile:

1. Navigate to your user profile
2. Click on "Notification Preferences"
3. Select your preferred notification mode
4. Save changes

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

2. **Email Worker** (`workers/emailWorker.ts`)
   - Sends actual emails
   - Handles retries and failures
   - Processes both immediate and digest emails

3. **Scheduler** (`scheduler.ts`)
   - Sets up cron jobs for daily digests
   - Runs at 8 AM daily

4. **Queue System** (BullMQ + Valkey)
   - Ensures reliable delivery
   - Handles retries automatically
   - Prevents duplicate notifications

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
                                              ↓
                                        Email Worker
                                              ↓
                                        Send Email
```

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

1. Add the type to the notification enum in schema
2. Create handler in the appropriate service
3. Queue notification job when event occurs
4. Update email templates if needed

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
<a href="{{actionUrl}}" class="button">{{actionText}}</a>
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
