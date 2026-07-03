---
sidebar_position: 7
title: User Management
---

# User Management Administration

This section allows administrators (`ADMIN` access level) to manage user accounts within TestPlanIt. You can add, edit, and delete users, control their access levels, assign roles, and manage their project assignments, and group memberships.

To access this page, enter the Administration area and select **User Management** from the left-hand navigation menu.

## Viewing Users

The main view displays a table of all registered users (excluding those marked as deleted). Key features include:

- **Filtering**: Use the filter input to search for users by name.
- **Show Inactive Users**: Toggle the switch to include users marked as inactive in the list.
- **Loading More**: The list loads more users automatically as you scroll if it is long; there are no page controls.
- **Columns**: The table includes columns for:
  - **Name**: User's full name and profile picture (if available).
  - **Email**: User's email address.
  - **Email Verified**: Date the user's email address was verified.
  - **Is Active**: A switch indicating if the user account is active. Inactive users cannot log in. (Cannot be disabled for your own account).
  - **Access**: The user's system access level (ADMIN, PROJECTADMIN, USER, NONE).
  - **Role**: The user's assigned Role (determines permissions).
  - **Groups**: A count/list of Groups the user belongs to.
  - **Projects**: A count/list of Projects the user is assigned to.
  - **API Access**: (Hidden by default) A switch indicating if the user can access the API.
  - **Created At**: Date the user account was created.
  - **Created By**: (Hidden by default) The user who created this account (or "Self-Registration").
  - **Actions**: A three-dot menu with **Edit**, **Force Password Change**, **Revoke Password**, and **Delete** options. Password actions are only shown for internal/both auth method users and are hidden for your own account. Delete is also hidden for your own account.

## Adding a New User

1. Click the **Add User** button above the user table.
2. A modal dialog will appear. Fill in the user details:
   - **Name**: Full name of the user (required).
   - **Email**: User's email address (required, must be unique).
   - **Password**: Set an initial password. Labeled **(Optional)** when a passwordless login method is available (an enabled Magic Link SSO provider or a configured email server) — in that case you can leave it blank and the user signs in via magic link or SSO. When supplied, the password must satisfy the Security Settings policy (minimum length, character classes); the live strength indicator and checklist show which rules are met.
   - **Confirm Password**: Re-enter the password (must match). Only required when a password is entered.
   - **Is Active**: Toggle switch, defaults to active.
   - **Access**: Select the system access level (ADMIN, PROJECTADMIN, USER, NONE). Defaults to USER. If the user belongs to a group with a [Mapped Access Tier](./groups.md#mapped-access-tier), their access is instead governed by group role mapping (highest tier wins, with a configurable fallback default).
   - **Role**: Select the user's Role from the dropdown. Defaults to the system's default role.
   - **Groups**: Use the multi-select dropdown to assign the user to relevant Groups. Use "Select All" for convenience.
   - **Projects**: Use the multi-select dropdown to assign the user to relevant Projects. Use "Select All" for convenience.
   - **API Access**: Toggle switch to grant API access. Defaults to off.
3. Click **Submit**. The user account is created, and default user preferences are automatically assigned.

## Editing an Existing User

1. Locate the user you wish to modify in the table.
2. Click the three-dot menu in the **Actions** column and select **Edit**.
3. A modal dialog will appear. You can modify:
   - Name
   - Email
   - Is Active (Cannot disable your own account)
   - Access Level (Cannot change your own access level). If this user's access is governed by group role mapping, the dialog shows a **Group Mapped** badge and a **Managed by Group Mapping** warning; saving a manual change switches them to manual control.
   - Role (Cannot change your own role)
   - Group assignments
   - Project assignments
   - API Access
   - _(Note: Password cannot be changed from this screen. Users manage their own passwords via profile settings or password reset functionality)._
4. Click **Submit** to save changes. Project and Group assignments are updated based on additions and removals.

## Deleting a User

Deleting a user marks their account as inactive and removes their project and group assignments. This is a soft delete; the user record is not permanently removed from the database but will be hidden from standard views.

:::warning Important
You cannot delete your own user account.
:::

1. Locate the user you wish to delete in the table.
2. Click the three-dot menu in the **Actions** column and select **Delete**.
3. A confirmation dialog will appear, warning that the action cannot be undone.
4. Click **Confirm Delete**.
