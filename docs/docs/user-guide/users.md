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
- **Pagination**: Navigate through pages of users if the list is long.
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
  - **Actions**: Buttons to **Edit** or **Delete** the user. (Cannot delete your own account).

## Adding a New User

1. Click the **Add User** button above the user table.
2. A modal dialog will appear. Fill in the user details:
    - **Name**: Full name of the user (required).
    - **Email**: User's email address (required, must be unique).
    - **Password**: Set an initial password (required, min 4 characters).
    - **Confirm Password**: Re-enter the password (must match).
    - **Is Active**: Toggle switch, defaults to active.
    - **Access**: Select the system access level (ADMIN, PROJECTADMIN, USER, NONE). Defaults to USER.
    - **Role**: Select the user's Role from the dropdown. Defaults to the system's default role.
    - **Groups**: Use the multi-select dropdown to assign the user to relevant Groups. Use "Select All" for convenience.
    - **Projects**: Use the multi-select dropdown to assign the user to relevant Projects. Use "Select All" for convenience.
    - **API Access**: Toggle switch to grant API access. Defaults to off.
3. Click **Submit**. The user account is created, and default user preferences are automatically assigned.

## Editing an Existing User

1. Locate the user you wish to modify in the table.
2. Click the **Edit** (pencil) icon in the **Actions** column for that user.
3. A modal dialog will appear. You can modify:
    - Name
    - Email
    - Is Active (Cannot disable your own account)
    - Access Level (Cannot change your own access level)
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
2. Click the **Delete** (trash can) icon in the **Actions** column.
3. A confirmation dialog will appear, warning that the action cannot be undone.
4. Click **Confirm Delete**.
