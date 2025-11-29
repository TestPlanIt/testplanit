---
sidebar_position: 8
title: Groups
---

# Groups Administration

Groups allow you to organize users, often reflecting teams, departments, or specific access roles. Assigning users to groups simplifies managing permissions and project access, although the specific permission implications depend on how groups are utilized elsewhere in the application (e.g., within project settings or roles).

To access this page, enter the Administration area and select **Groups** from the left-hand navigation menu.

## Viewing Groups

The Groups page displays a table listing all configured groups (excluding those marked as deleted). Key features include:

- **Filtering**: Use the filter input to search for groups by name.
- **Pagination**: Navigate through pages of groups if the list is long.
- **Columns**: The table includes columns for:
  - **Name**: The name of the Group.
  - **Users**: A count/list of users assigned to this Group.
  - **Actions**: Buttons to **Edit** or **Delete** the Group.

## Adding a New Group

1. Click the **Add Group** button located above the table.
2. A modal dialog will appear.
3. Enter a unique **Name** for the new Group.
4. Click **Submit**.

## Editing an Existing Group

1. Locate the Group you wish to modify in the table.
2. Click the **Edit** (pencil) icon in the **Actions** column.
3. A modal dialog will appear. Modify the **Name**.
4. Click **Save** (or Submit).

## Deleting a Group

Deleting a group marks it as inactive and removes all user assignments to this group. This is a soft delete; the group record is not permanently removed from the database but will be hidden from standard views.

1. Locate the Group you wish to remove in the table.
2. Click the **Delete** (trash can) icon in the **Actions** column.
3. A confirmation dialog will appear, warning that this action cannot be undone.
4. Click **Delete** (or Confirm Delete) to confirm.
