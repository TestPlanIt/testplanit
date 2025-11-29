# Upgrade Notifications

TestPlanIt includes a system to automatically notify users about new features when the application is upgraded. This allows administrators to inform users about important changes without requiring manual intervention.

## How It Works

1. Each user has a `lastSeenVersion` stored in the database
2. On first page load after an upgrade, the system compares the current version with the user's last seen version
3. If there are notifications configured for versions between these two, a batched notification is created
4. The notification appears in the user's notification bell as a system announcement

## Adding Upgrade Notifications

When releasing a new version with notable features, add an entry to the upgrade notifications configuration file:

**File:** `testplanit/lib/upgrade-notifications.ts`

```typescript
export const upgradeNotifications: Record<string, UpgradeNotification> = {
  "0.3.43": {
    title: "New Feature: Dark Mode",
    message: "You can now switch to dark mode in your user preferences. Go to Settings > Preferences to try it out."
  },
  "0.3.44": {
    title: "Enhanced Search",
    message: `
      <p>Search now supports <strong>custom field filtering</strong> and advanced operators.</p>
      <ul>
        <li>Filter by any custom field</li>
        <li>Use AND/OR operators</li>
        <li>Save search filters for later</li>
      </ul>
    `
  },
};
```

### Configuration Fields

- **Key**: The version number (must match `package.json` version format, e.g., `"0.3.43"`)
- **title**: Short title for the notification (max 100 characters)
- **message**: Description of the new feature(s). Supports HTML tags for rich text formatting (e.g., `<strong>`, `<ul>`, `<a>`, `<p>`). Plain text also works.

## Behavior

### First-Time Users

Users who have never logged in before will not receive upgrade notifications. Their `lastSeenVersion` is set to the current version on first login.

### Multiple Version Updates

If a user skips multiple versions (e.g., from 0.3.40 to 0.3.45), all notifications for versions in between are batched into a single notification with the title "What's New in TestPlanIt".

### Notification Delivery

- Notifications are created as `SYSTEM_ANNOUNCEMENT` type
- They appear in the notification bell icon in the header
- They use the existing notification infrastructure (no additional setup required)

## Technical Details

### Files Involved

- `testplanit/lib/upgrade-notifications.ts` - Configuration file for notifications
- `testplanit/app/actions/upgrade-notifications.ts` - Server action that checks and creates notifications
- `testplanit/components/UpgradeNotificationChecker.tsx` - Client component that triggers the check
- `testplanit/schema.zmodel` - User model includes `lastSeenVersion` field

### Database Field

The `User` model includes:

```prisma
lastSeenVersion String?
```

This field is automatically updated when upgrade notifications are checked.

## Best Practices

1. **Be concise**: Keep messages short and focused on the key benefit
2. **Link to docs**: If the feature is complex, mention where users can learn more
3. **Version carefully**: Only add notifications for user-facing features, not internal changes
4. **Test locally**: Verify notifications appear correctly before deploying
