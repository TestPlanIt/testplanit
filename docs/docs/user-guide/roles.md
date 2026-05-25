---
sidebar_position: 9
title: Roles
---

# Roles Administration

Roles define sets of permissions within TestPlanIt, controlling what actions users assigned to that role can perform (e.g., creating projects, editing test cases, managing users). This section covers how to manage these roles.

To access this page, enter the Administration area and select **Roles** from the left-hand navigation menu.

## Viewing Roles

The Roles page displays a table listing all defined roles (excluding those marked as deleted). Key features include:

- **Filtering**: Use the filter input to search for roles by name.
- **Pagination**: Navigate through pages of roles if the list is long.
- **Columns**: The table includes columns for:
  - **Name**: The name of the Role.
  - **Default**: A switch indicating if this is the default Role assigned to new users. Only one role can be the default.
  - **Actions**: Buttons to **Edit** or **Delete** the Role. (The default role cannot be deleted).

## Adding a New Role

1. Click the **Add Role** button located above the table.
2. A modal dialog will appear.
3. Enter a unique **Name** for the new Role (e.g., "Tester", "Test Lead", "Read Only").
4. Use the **Default** switch to designate this role as the default for new users. If another role is currently the default, setting this will automatically unset the default status for the other role.
5. Click **Submit** to create the role.
6. Edit the new role to set per-area permissions — see [Editing an Existing Role](#editing-an-existing-role) below. Newly-created roles start with every permission off; assign them deliberately.

## Editing an Existing Role

1. Locate the Role you wish to modify in the table.
2. Click the **Edit** icon in the **Actions** column.
3. A modal dialog will appear. You can modify:
    - **Name**: Change the name of the Role.
    - **Default**: Change the default status (cannot be unset directly if it is the current default; set another role as default instead).
    - **Per-area permissions**: For every Application Area (see the list below), toggle which actions the role can perform — **Add/Edit**, **Delete**, **Complete**, **Read Sensitive**, and **Approve**. Not every column is meaningful on every row; the UI hides toggles that don't apply (for example, **Approve** only shows on Test Case Repository, Test Runs, and Sessions, and **Read Sensitive** only shows on the two Restricted Fields areas).
4. Click **Submit**. Changes apply immediately to every user who effectively holds this role on a project.

## Deleting a Role

Deleting a role marks it as inactive. Users currently assigned to the deleted role will be automatically reassigned to the **Default** Role.

:::warning Important
You cannot delete the **Default** Role. To delete the current default, you must first designate another role as the default.
:::

1. Locate the Role you wish to remove in the table.
2. Click the **Delete** icon in the **Actions** column. The button will be disabled if the role is the default.
3. A confirmation dialog will appear, warning that users will be reassigned to the default role.
4. Click **Confirm Delete** to confirm.

# Roles

Roles define the permissions users have within the application and specific projects. TestPlanIt comes with predefined system roles, and administrators can create custom roles to fit their organization's needs.

## System Roles

- **Admin:** Full access to all application settings and all projects.
- **Project Admin:** Full access to administrative functions for a project to which the user has access.
- **User:** Default role for new users. Can view and interact with projects they are assigned to, based on the project-specific role assigned to them.
- **No Access:** The user's access to the system is revoked. The user can log in, but not interact with any projects.

## Custom Roles

Administrators can create custom roles under **Administration -> Roles**. This allows for granular control over what users can do.

## Project Permissions and Application Areas

When a user is assigned to a project, they are also assigned a project-specific role for that project. This role determines their access level within different functional areas of the project, known as **Application Areas**.

:::info Application Areas
**Application Areas** defined in the system include:

- **Documentation**: Creating and editing project documentation.
- **Milestones**: Creating, editing, and deleting project milestones.
- **Test Case Repository**: Creating, editing, deleting, and organizing test case folders and test cases.
- **Test Case Restricted Fields**: Editing restricted field values on test cases, and (via the role's `Read Sensitive` grant on this area) viewing sensitive parameter values in datasets attached to test cases.
- **Test Runs**: Creating, Editing and Deleting active test runs.
- **Closed Test Runs**: Deleting completed/archived test runs.
- **Test Run Results**: Recording and managing results for test cases within a run.
- **Test Run Result Restricted Fields**: Recording restricted field values on test run results, and (via the role's `Read Sensitive` grant on this area) viewing sensitive parameter values on iteration results, matrix cells, matrix CSV exports, and the auto-prefilled body when linking an external issue from a failed iteration.
- **Sessions**: Creating and managing active test sessions.
- **Sessions Restricted Fields**: Recording restricted field values on test sessions.
- **Closed Sessions**: Deleting completed/archived test sessions.
- **Session Results**: Recording and Managing results for test cases within a session.
- **Tags**: Creating new tags.
:::

Each role defines specific permissions (e.g., Add/Edit, Delete, Complete, Read Sensitive, Approve) for these areas.

The `Read Sensitive` permission is only honored on the **Test Case Restricted Fields** and **Test Run Result Restricted Fields** areas, where it controls whether the role can view sensitive parameter values; the other areas ignore it. Without this grant, sensitive values render as `••••••` in dataset rows and iteration cells, and as `[REDACTED]` in the issue-prefill body and CSV exports.

The `Approve` permission is only honored on the **Test Case Repository**, **Test Runs**, and **Sessions** areas (approval is meaningless outside the three review-relevant scopes, so the UI hides the toggle on every other area row). It gates eligibility under [Review & Approval](./review-approvals.md): only users whose effective project role grants `Approve` on the entity's area appear in the assignee picker, the `requestReview` server action rejects mismatched assignees with a typed error, and the same check runs again at decision time on the reviewer's side. System administrators (access = `ADMIN`) bypass the decision-time check so they can always unblock stalled reviews — but they still only appear as eligible assignees if their role grants `Approve` for the area.

**Example:** A "Tester" role might have `Add/Edit` permissions for `TestRunResults` and `SessionResults` but not for `TestCaseRepository` and `Milestones`.

The specific permissions granted by each role are configured when the role is created or edited in the **Administration -> Roles** section. When viewing different parts of a project, the UI will adapt based on the user's permissions for that specific Application Area (e.g., hiding "Edit" or "Delete" buttons, disabling drag-and-drop).

## Effective Project Permissions Hierarchy

A user's final permissions within a specific project are determined by a hierarchy, ensuring the most specific assignment takes precedence:

1. **User-Specific Project Role:** If a user has been explicitly assigned a specific role *for that project* (via **Project Settings -> Members -> User -> Edit**), that role's permissions are used, overriding all other settings.

2. **Group-Specific Project Role(s):** If the user hasn't been assigned a specific role directly, the system checks the groups they belong to. If one or more of their groups have been assigned a specific role *for that project* (via **Project Settings -> Members -> Group -> Edit**), the role providing the *highest level of access* (most permissions) among those group assignments is used.

3. **Project Default Role:** If neither the user nor their groups have a specific role assigned for the project, the system checks the project's **Default Access Settings** (in **Project Settings -> General**):
    - If the default access is set to **"Use Specific Role"**, the role selected as the project's default role is used.

4. **User's Global Role:** If none of the above apply (e.g., the project's default access is set to **"Use Global Role"**), the user's *global* role (assigned in **Administration -> Users**) determines their permissions within the project.

5. **No Access:** If the project's default access is set to **"No Access"** and the user hasn't been granted access via steps 1 or 2, they will not have access to the project.

This hierarchy allows administrators flexible control, from broad default access based on global roles to highly specific overrides for individual users or groups within particular projects.
