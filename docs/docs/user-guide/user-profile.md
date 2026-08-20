---
title: User Profile
sidebar_position: 5 # After Users List
---

# User Profile Page

This page displays comprehensive information about a specific user. You can reach this page by clicking a user's name on the [Users List](./users-list.md) page, or by selecting "Profile" from the user menu to view your own profile.

## Page Layout

The profile page features a modern card-based layout with the following sections:

### Header Section

The header features a gradient background and contains:

#### Avatar Display (Left)

- Displays the user's profile picture, or their initials with a colored background if no image is set
- **When viewing your own profile**:
  - An **"Edit Avatar"** button appears below the image to upload a new profile picture
  - If you have an avatar set, an **"X" button** appears in the top-right corner to remove it (with confirmation)

#### User Information & Actions (Right)

- **User Name**: The full name of the user (editable inline when viewing own profile)
- **Email Address**: The user's registered email (editable inline when viewing own profile)
- **Action Buttons** (own profile only):
  - **Edit Profile**: Enables inline editing mode for user information and preferences
  - **Change Password**: Opens a modal to update your password

## Information Sections

The following collapsible sections are displayed when viewing your own profile or as an admin (project admins viewing another user's profile see only the Assignments section). They appear in this order:

### Account Information

Displays core account details:

- **System Access**: The user's access level (ADMIN, PROJECTADMIN, USER, or NONE), set either manually by an admin or automatically via [group role mapping](./scim.md#role-mapping)
- **Authentication Method**: Internal (email/password), SSO Only, Email & SSO, or **SCIM Provisioned** (the row is owned by an upstream identity provider)
- **Default Role**: The default role assigned to the user
- **API User**: Indicates if this is an API account (shown as a disabled switch)
- **Two-Factor Authentication (2FA)**: Toggle, QR code setup, backup code management, and regeneration controls

:::note
If your organization has enforced 2FA, you will not be able to disable it. A notice will appear if SSO logins bypass your personal 2FA settings.
:::

For detailed 2FA setup instructions, see [Two-Factor Authentication](./two-factor-authentication.md).

### Assignments

A compact view of the same information the [dashboard's](./dashboard.md) "Your Assignments" card shows, rendered as sortable tables:

- **Reviews**: pending review requests waiting on the user, with a count-first heading (e.g. "3 Reviews"). Each row shows the entity under review (test case, test run, or session) and its project, linking to the entity page where the review can be decided.
- **Active Test Runs**: open test runs with cases assigned to the user that still need attention. The heading totals the workload (e.g. "2 Active Test Runs include 14 test cases"), and each row shows the run, its project, the number of pending cases, and the estimated effort.
- **Active Sessions**: incomplete sessions assigned to the user, with the project and the remaining time (estimate minus time already recorded).

A **Total Work Effort** line above the tables sums the estimated time across pending run cases and session remainders. Column headers sort each table; entity and project names use the same linked displays as the rest of the app.

Assignments are private to the user, with two exceptions:

- **Administrators** see any user's assignments in full.
- **Project admins** see another user's assignments only within the projects they can access; the reviews list follows the same access policy.

### Directory Profile

Shown only for users provisioned through [SCIM 2.0](./scim.md). These fields are read-only — they are synced from your identity provider and any edits must be made there.

The section surfaces whatever your IdP sent on the last `POST` / `PUT` / `PATCH`:

- **First name** and **Last name** (`name.givenName` / `name.familyName`)
- **Directory username** (`userName`) and **IdP user ID** (`externalId`) — useful for matching this account against your IdP's view of the same person
- **Title** and **User type** from the SCIM core attributes
- From the [SCIM Enterprise User extension](https://datatracker.ietf.org/doc/html/rfc7643#section-4.3): **Employee number**, **Department**, **Division**, **Organization**, **Cost center**, and **Manager** (display name)

Rows render only when the IdP actually sent a value; an empty bucket renders the message "Your identity provider has not sent any enterprise directory attributes for this account." instead of a wall of em-dashes.

### Access

Shows what the user can reach in the system:

- **Projects**: All projects the user is assigned to
- **Groups**: All groups the user belongs to

### User Preferences

When viewing your own profile, you can view and edit these preferences:

#### Display Preferences

- **Theme**: Choose from Light, Dark, System, Green, Orange, Purple, **Accessible**, or **Accessible (Dark)** themes (with color indicators). Accessible (light) and Accessible (Dark) are high-contrast options tuned for [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA — see [Accessibility](./user-menu.md#accessibility)
- **Locale**: Language preference (English, Czech, German, Spanish, French, Italian, Dutch, Polish, Portuguese, Turkish, Vietnamese, Arabic, Russian, Chinese Simplified, Chinese Traditional, Japanese, Korean). Right-to-left languages such as Arabic switch the entire interface to a mirrored right-to-left layout.
- **Items Per Page**: Number of items to show in paginated tables (10, 25, 50, 100)

#### Date & Time Formatting

- **Date Format**: Choose between MM/DD/YYYY, DD/MM/YYYY, or YYYY-MM-DD formats
- **Time Format**: 12-hour (HH:MM AM/PM) or 24-hour (HH:MM) format
- **Timezone**: Select your timezone from a searchable list

#### Notification Settings

- **Notification Mode**: Control how you receive notifications:
  - Use Global Settings
  - None (no notifications)
  - In-App Only
  - In-App + Email (Immediate)
  - In-App + Email (Daily Digest)

### API Tokens

Shown only when viewing your own profile and the account has API access. Lets you create, view, and revoke personal access tokens used to authenticate against the TestPlanIt REST API.

For details on token scopes and lifecycle, see [API Tokens](../../api-tokens).

### Activity Statistics

Shows user activity metrics in a grid layout:

- Projects Created
- Test Cases Created
- Sessions Created
- Test Runs Created
- Milestones Created
- Last Active date

### Audit Log

Shown on your own profile, or on any user's profile when you're an administrator. Expands to an **Audit Log** of the actions that user has performed — logins, data changes, permission changes, and more — scoped automatically to that user. The search box and the action, entity-type, project, and date-range filters work just like the system-wide viewer. See [Viewing your own activity](./audit-logs.md#viewing-your-own-activity) for details.

### Account History

Shows historical account information:

- **Date Created**: When the account was created
- **Created By**: Who created the account (or "Self Registered")
- **Email Verified**: The verification date or "Unverified" status
- **Users Created**: List of users created by this account

### Mentioned Comments

Shown only on your own profile. Lists comments where you've been @-mentioned across the system, with links back to the originating test case, run, session, or issue. Useful for catching up on conversations that need your input.

Comments created by the [review workflow](reviews-inbox.md) carry the same badge and color accent here as in the entity's own thread — **Review request**, or the decision outcome (**Approved**, **Changes requested**, **Rejected**, or **Cancelled**) — so review activity stands out in the list.

## Editing Mode

When you click the **Edit Profile** button:

1. The name and email fields become editable input fields
2. The preferences section switches to form controls (dropdowns, radio buttons)
3. Cancel and Submit buttons replace the Edit Profile button
4. Changes are saved when you click Submit
5. The page refreshes to show updated information

:::note SCIM-provisioned users
If your account was provisioned through [SCIM 2.0](./scim.md), the **name** and **email** inputs stay disabled in edit mode with a "managed by your identity provider via SCIM" hint, and the save call omits those fields server-side. Preferences, avatar, password (when the account also has Internal auth), API tokens, and 2FA are still yours to change locally. Update your name or email in the IdP — the next sync will pull it into TestPlanIt.
:::

## Permissions

- Users can only edit their own profiles
- Admins can view additional private information for all users
- Project admins viewing another user's profile see only the [Assignments](#assignments) section, scoped to the projects they can access
- Regular users viewing other profiles see limited public information
