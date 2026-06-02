---
sidebar_position: 3 # Adjust position as needed
title: Projects
---

# Projects Administration

This section allows administrators to manage the projects within TestPlanIt. Projects are the top-level containers for organizing test plans, test cases, and test results.

To access this page, enter the Administration area and select **Projects** from the left-hand navigation menu.

## Viewing Projects

The main view displays a table of all existing projects in the system. The table includes the following columns:

- **Name:** The unique name of the project.
- **Description:** A brief description of the project's purpose or scope.
- **Completed:** Indicates if the project is marked as complete (e.g., a checkbox or status label).
- **Completed On:** The date and time the project was marked as complete.
- **Created At:** The date and time the project was created.
- **Created By:** The user who originally created the project.
- **Members:** A list or count of users assigned to the project.
- **Milestone Types:** Associated types of milestones used within the project.
- **Milestones:** A list or count of milestones defined for the project.
- **Actions:** Buttons to edit or delete the project.

You can usually sort the table by clicking on column headers and may use a search or filter bar (if available) to find specific projects.

## Creating a New Project

The Create Project Wizard guides you through the process of setting up a new project with all necessary configurations.

### Starting the Wizard

1. Click the "Add Project" button (with a plus icon).
2. The Create Project Wizard will open, guiding you through multiple steps.

### Step 1: Basic Information

Enter the fundamental details for your project:

- **Project Name:** A unique and descriptive name for the new project (required).
- **Description:** (Optional) A brief description or note about the project's purpose.
- **Project Icon:** (Optional) Select an icon to visually identify the project. You can:
  - Choose from predefined icons
  - Upload a custom image (PNG, JPG, or GIF)
  - The icon will appear next to the project name throughout the application

### Step 2: Project Settings

Configure the project's operational settings:

- **Project Status:**
  - **Active:** The project is currently in progress (default).
  - **Completed:** Mark the project as finished. When selected, you'll need to provide a completion date.
- **Completion Date:** (Only visible when project is marked as completed) The date when the project was finished.

### Step 3: Access Control

Set up who can access the project and with what permissions:

- **Default Access:** Choose the default permission level for users:
  - **No Access:** Users have no access unless explicitly granted.
  - **Global Role:** Users inherit their system-wide role permissions.
  - **Specific Role:** Assign a specific role to all users by default.
- **User-Specific Permissions:** (Optional) Override default access for individual users.
- **Group Permissions:** (Optional) Set permissions for user groups.

### Step 4: Templates & Workflows

Select the templates and workflows to use with this project:

- **Test Case Template:** Choose the template that defines the structure of test cases.
- **Workflows:** Select which workflows will be available for test execution.
- **Milestone Types:** Choose the types of milestones that can be created in this project.
- **Statuses:** Select which test statuses will be available.
- **Configurations:** (Optional) Tick the [Configurations](./configurations.md) you want available in this project's run, session, and search pickers. New projects start with no Configurations and opt in to the ones they need; you can add or remove assignments later from the Configurations admin page.

### Step 5: Review & Create

Review all your selections before creating the project:

- A summary of all configured settings is displayed.
- You can go back to any previous step to make changes.
- Click "Create Project" to finalize the project creation.

:::info Default Associations
If you skip configuring certain items, the project will automatically be associated with:

- The **default** Test Case Template.
- All **default** Workflows.
- The **default** Milestone Type.
- All **active** Statuses.

These associations can be modified later by visiting the specific administration pages for Templates & Fields, Workflows, Statuses and Milestone Types respectively.
:::

## Editing an Existing Project

1. Locate the project you wish to modify in the table.
2. Click the **Edit** button in the corresponding row.
3. A dialog box will appear, pre-filled with the project's current details. You can modify:
    - **Icon:** Choose an icon for the project using the icon picker.
    - **Name:** Update the project name.
    - **Description:** Modify the project description.
    - **Completed:** Toggle the completion status and set the **Date** if marking as completed.
4. Click "Submit" to apply the changes.

## Deleting a Project

Deleting a project marks it as inactive and typically hides it from standard views. While the underlying data might not be immediately purged, consider this a permanent action from a user perspective.

1. Locate the project you wish to delete in the table.
2. Click the **Delete** button in the corresponding row.
3. A confirmation dialog with a warning icon will appear, asking you to confirm the deletion of the project named **`{Project Name}`**. It emphasizes that this action cannot be undone.
4. If you are certain, click the **Confirm Delete** button.

## Project Access Control

### Overview

The project access system uses a hierarchical permission model that determines who can access projects based on three levels: project defaults, user-specific permissions, and group permissions.

### Access Types

#### Project-Level Default Access

Every project has a default access type that applies to all users unless overridden:

- **`NO_ACCESS`**: No users can access the project by default. Users must be explicitly granted access through direct user assignment or group membership.

- **`GLOBAL_ROLE`** (Recommended for open projects): **All users with site access can view this project.** Their permissions within the project are determined by their globally assigned role. This is the simplest access model - anyone who can log into the system can access the project.

- **`SPECIFIC_ROLE`**: **Users are not automatically granted access to this project.** Access must be explicitly granted through:
  - **Direct user assignment** - Adding users individually to the project
  - **Group membership** - Adding a group to the project (all group members inherit access)

  When users are assigned via group membership, they will use the role specified for this project unless overridden by a direct user assignment. This provides more control over who can access sensitive or confidential projects.

:::tip Choosing Between Global Role and Specific Role

- Use **Global Role** when you want the project to be accessible to everyone in your organization
- Use **Specific Role** when you need to restrict access to specific teams or individuals

:::

#### User-Specific Permissions

Individual users can have explicit permissions that override project defaults:

- **`PROJECT_DEFAULT`**: Inherit from project's default settings
- **`NO_ACCESS`**: Explicitly deny access (highest priority)
- **`GLOBAL_ROLE`**: Use the user's global system role
- **`SPECIFIC_ROLE`**: Assign a specific role for this project

#### Group Permissions

Groups can have permissions that apply to all their members:

- **`PROJECT_DEFAULT`**: Inherit from project's default settings
- **`NO_ACCESS`**: Deny access to all group members
- **`SPECIFIC_ROLE`**: All group members get a specific role

### Access Resolution Order

The system evaluates access in this priority order:

1. **Admin Override**: System admins always have full access
2. **Project Admin**: Users with Project Admin access who are assigned to the project have full control
3. **Explicit User Denial**: If a user has `NO_ACCESS` permission, they are denied (highest priority for non-admins)
4. **Explicit User Permission**: User-specific `GLOBAL_ROLE` or `SPECIFIC_ROLE` permissions grant access
5. **Direct Assignment**: Users explicitly assigned to the project have read access
6. **Project Default**: If project default is `GLOBAL_ROLE` and user has a role, they get access
7. **Group Permissions**: Evaluated based on group membership and group-specific settings

### Setting Up Access Control

When creating or editing a project, you can configure access control through three tabs:

#### Details Tab

- Set the **Default Project Access** which determines the baseline permission for all users
- Choose between No Access, Global Role, or a Specific Role from the dropdown

#### Users Tab

- View all system users and their current access settings
- Override default permissions for specific users
- Assign users directly to the project
- Each user shows their effective access based on the combination of project defaults and user-specific overrides

#### Groups Tab

- Configure permissions for entire groups
- All members of a group inherit the group's permission settings
- Groups can be set to Project Default, No Access, or a Specific Role

### Common Scenarios

#### Open Project (Company-Wide Access)

Set `Default Project Access` to **Global Role** - all users with system roles can access the project with their existing permissions. This is ideal for shared test repositories, company-wide projects, or when you want maximum visibility.

**Key points:**

- Everyone who can log into the system can see and access this project
- Users' permissions are based on their globally assigned role
- No additional user or group assignments are required for basic access

#### Restricted Project (Team-Only Access)

Set `Default Project Access` to **No Access** or **Specific Role** - only explicitly assigned users and groups can access the project. This is ideal for confidential projects, department-specific work, or when you need to control exactly who has access.

**Key points:**

- Users must be explicitly added (directly or via groups) to access the project
- When using a Specific Role, all assigned users get that role unless overridden
- Group members inherit the project's role unless they have a direct user assignment

#### Uniform Role Project

Set `Default Project Access` to **Specific Role** and select a role - users assigned through groups will use this role within the project regardless of their system role. Individual user assignments can still override this.

#### Mixed Access

Use the default setting combined with user and group overrides for granular control over who can access the project and what they can do.

### Special Considerations

- The user creating a project is automatically assigned to it
- Groups automatically apply their permissions to all members
- Permission changes take effect immediately
- When `SPECIFIC_ROLE` is selected, you must choose a valid role from the dropdown
- User-specific `NO_ACCESS` overrides all other permissions (except for system admins)

## Share Management

View and manage all Share Links created for reports and other content within the project.

### Accessing Share Management

**From Project Settings:**

1. Navigate to your project
2. Click **Settings** in the project menu
3. Click **Shares** in the settings navigation
4. View all active, expired, and revoked shares

### Features

**Share Overview:**

- See all share links for the project
- View access mode (Authenticated, Public, Password-Protected)
- Monitor view counts and last accessed timestamps
- Track notification settings for each share
- Check expiration dates and status (Active, Expired, Revoked)

**Share Actions:**

- **Copy Link**: Copy share URL to clipboard for distribution
- **Edit**: Modify title, description, expiration date, and settings
- **Toggle Notifications**: Enable/disable view notifications
- **Revoke**: Immediately disable access (link shows "Link revoked")
- **Delete**: Permanently remove share (link shows 404)

**Access Analytics:**

- View count per share link
- Last accessed timestamp
- Detailed access logs with viewer information
- IP addresses and user agents
- Authentication status for each access

### Share Management Best Practices

**Regular Review:**

- Review active shares monthly
- Delete unused or outdated shares
- Update expiration dates for ongoing shares
- Monitor access patterns for anomalies

**Security:**

- Revoke shares when no longer needed
- Use expiration dates for temporary access
- Enable notifications for sensitive shares
- Review access logs periodically

**Organization:**

- Use descriptive titles for easy identification
- Add descriptions explaining share purpose
- Tag or categorize shares by stakeholder type
- Document password distribution for protected shares

[Learn more about Share Links →](./share-links.md)

## Advanced Settings

A project's **Advanced** settings tab governs how reviews and results are handled within that project. To open it, navigate to your project, click **Settings** in the project menu, and choose **Advanced** in the settings navigation.

### Enable Review Workflow

When enabled, transitions into states that require review are gated by an approved review request: testers see a **Request Review** button, and reviewers receive notifications. This is on by default for each project.

The review workflow must also be turned on system-wide. If a system administrator has disabled it under **Administration → Workflows**, the project's preference is still saved, but nothing is gated until the feature is re-enabled — a warning is shown in that case.

[Learn more about Review & Approvals →](./review-approvals.md)

### Result Edit Window

Controls how long after a result is recorded it can still be edited in place within this project. After the window closes, corrections require a new attempt rather than overwriting the existing result.

- **Inherit system default**: Follow the system-wide [Result editing policy](./statuses.md#result-editing-policy). This is the default.
- **Disable editing for this project**: Turn off in-place editing here, even if the system policy would allow it.
- **Custom window**: Set how many minutes a result stays editable.

When the system administrator has set a maximum window, the project can only **tighten** it — a shorter window or disabled editing. The current ceiling is shown as a **System maximum** hint, and a custom value cannot exceed it. If editing has been disabled system-wide, this setting is locked and the project cannot re-enable it.

System administrators can always edit a result regardless of this setting, and every edit is recorded in the [Audit Log](./audit-logs.md).

### Require Justification on Result Flip

When enabled, recording a result that **flips** a completed outcome — for example changing a case from Passed to Failed — requires **Result Details** explaining the change.

The result details note is mandatory only when **both** the previous and new statuses are *completed* statuses **and** their pass/fail judgment differs. A status counts as completed when its **Completed** flag is set on the [Statuses](./statuses.md) admin page. In the default configuration **Skipped** is a completed status, so changing between Skipped and a Passed or Failed result is treated as a flip and requires justification too, not just Passed ↔ Failed. Recording the first result, or moving to or from a *non-completed* status (such as Untested, Retest, or Blocked), is never blocked.

This setting is off by default and applies to results recorded through the application, the API, and connected agents. Automated result imports (for example CLI or CI result uploads) are not affected.

### Require a Linked Issue on Failure

When enabled, recording a **failure** result requires at least one linked issue, so every failure is tied to a tracked defect.

A status counts as a failure when its **Failure** flag is set on the [Statuses](./statuses.md) admin page so any custom failed-type status is covered. An issue satisfies the requirement whether it is linked to the result itself or to one of its failing steps. Non-failure results (Passed, Blocked, and the like) are never blocked.

This setting depends on an [issue integration](./integrations.md). A project can only enforce it if it has an active issue integration to link issues from; without one the toggle is disabled and a warning is shown, since there would be no way to attach an issue.

When a tester selects a failure status from the quick-status menu on a project that requires an issue, TestPlanIt opens the **Add Result** dialog with an inline prompt to link an issue rather than silently rejecting the result. The prompt clears as soon as an issue is linked.

This setting is off by default and applies to results recorded through the application, the API, and connected agents. Automated result imports (for example CLI or CI result uploads) are not affected.

### Exclude Draft Cases from Test Runs

When enabled, test cases whose current workflow state is a **Not Started** type are treated as drafts and kept out of test runs.

This setting is off by default — opt in per project. It is independent of [Review & Approval](./review-approvals.md), so projects that have not turned R&A on can still use it for draft-quality hygiene. A workflow state counts as "Not Started" when its **Type** is set to `NOT_STARTED` on the [Workflows](./workflows.md) admin page.

While the setting is on:

- **Adding cases to a run** — Not Started cases are hidden from the Add Cases picker and cannot be added through the [Add Test Run modal](./projects/add-test-run-modal.md). The same filter is enforced server-side, so direct API calls, Testmo imports, and copy/move into a run also drop draft cases. [Magic Select](./llm-magic-select.md) honors the toggle too — when it runs against a project with this setting on, draft cases are excluded from the LLM's candidate pool before scoring. If a tester's selection included any draft cases, a toast names how many were skipped.
- **Creating a run from the repository** — when the picker filter would discard every case in your multi-select, **Create Test Run** is short-circuited: no new run is created, and a toast explains how many drafts were skipped. If at least one non-draft case is selected, the new run opens pre-populated with only those cases, and the skip toast still surfaces the dropped count.
- **Adding a single case from the kebab menu** — the row-level **Add to Test Run** submenu is replaced with a disabled item on draft cases, with a tooltip explaining why. The submenu reappears the moment the case transitions to any non–Not Started workflow state.
- **Reverting a case to Not Started** — when a case already attached to one or more open runs is moved back into a Not Started state (typically by a [Review & Approval](./review-approvals.md) rejection, but any state change qualifies), TestPlanIt automatically removes the case from any open run where it has **not yet been executed**. Run-cases that already have a recorded result are kept in place so the historical outcome remains visible; the result becomes read-only and cannot be edited further.
- **Restoring a removed case** — moving a case back out of Not Started (e.g. Draft → Active) **does not** automatically re-add it to the runs it was removed from. The removal is treated as a deliberate cleanup, not a reversible side-effect: silently resurrecting the case could undo a manual remove the tester did on purpose. To put the case back in a run, add it again through the Add Cases picker — the case is now eligible, so it appears there for selection.
- **Completed runs are untouched** — only open runs are reconciled. Once a run is completed its case set is frozen.
