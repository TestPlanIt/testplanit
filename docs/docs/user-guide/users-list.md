---
title: Users List
sidebar_position: 4 # After Tags List
---

# Users List Page

This page provides a directory of the active (non-deleted) users you collaborate with. You can typically navigate here by clicking **Users** in the main header navigation bar.

:::info Access
Users with the `NONE` access level cannot view this page and will be redirected.

The directory is scoped to your collaborators: it lists the users who share at least one project with you (through any form of effective access — explicit permissions, group permissions, project assignments, or a project's default access), plus yourself. Administrators see every user in the system.
:::

## Features

- **Filtering**: Use the filter input above the table to search for users by name. The search is case-insensitive.
- **Column Selection**: Use the **Columns** control above the table to show or hide specific columns. Your choice is remembered in this browser for this table, so it persists across visits.
- **Loading More**: The list loads more users automatically as you scroll toward the bottom — there are no page controls. A count above the table shows how many users are loaded out of the total.
- **Sorting**: Click on the column headers for "Name" or "Email" to sort the user list accordingly (ascending/descending).

## Users Table

The main part of the page is a table listing the active users with the following default columns:

- **Name**: Displays the user's avatar and full name. Clicking on the user's name navigates to their **[User Profile](./user-profile.md)** page.
- **Email**: Displays the user's registered email address.
- **Projects**: Displays the projects the user can access. Non-administrators see only the projects they share with that user; administrators see each user's full project list.
