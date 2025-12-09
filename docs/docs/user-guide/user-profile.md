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
- **Projects**: Shows all projects the user is assigned to in a highlighted box

## Information Sections

The following sections are displayed when viewing your own profile or as an admin:

### Account Information
Displays core account details:
- **System Access**: The user's access level (ADMIN, USER, READ_ONLY, etc.)
- **Default Role**: The default role assigned to the user
- **API User**: Indicates if this is an API account (shown as a disabled switch)

### Security Settings

#### Two-Factor Authentication (2FA)
- **Toggle Switch**: Enable or disable 2FA for your account
- **Setup Process**: When enabling, scan the QR code with your authenticator app
- **Backup Codes**: View and copy backup codes for account recovery
- **Regenerate Codes**: Generate new backup codes (requires 2FA verification)

:::note
If your organization has enforced 2FA, you will not be able to disable it. A notice will appear if SSO logins bypass your personal 2FA settings.
:::

For detailed 2FA setup instructions, see [Two-Factor Authentication](./two-factor-authentication.md).

### Groups
Lists all groups the user belongs to

### Activity Statistics
Shows user activity metrics in a grid layout:
- Projects Created
- Test Cases Created
- Sessions Created
- Test Runs Created
- Milestones Created
- Last Active date

### User Preferences

When viewing your own profile, you can view and edit these preferences:

#### Display Preferences
- **Theme**: Choose from Light, Dark, System, Green, Orange, or Purple themes (with color indicators)
- **Locale**: Language preference (English US, Español ES)
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

### Account History
Shows historical account information:
- **Date Created**: When the account was created
- **Created By**: Who created the account (or "Self Registered")
- **Email Verified**: The verification date or "Unverified" status
- **Users Created**: List of users created by this account

## Editing Mode

When you click the **Edit Profile** button:
1. The name and email fields become editable input fields
2. The preferences section switches to form controls (dropdowns, radio buttons)
3. Cancel and Submit buttons replace the Edit Profile button
4. Changes are saved when you click Submit
5. The page refreshes to show updated information

## Permissions

- Users can only edit their own profiles
- Admins can view additional private information for all users
- Regular users viewing other profiles see limited public information
