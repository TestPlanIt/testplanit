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

- **Default Project Access:** Choose the baseline access for every user:
  - **Use Global Role** (default): Every user can access the project, with the permissions of their own global role.
  - **No Access:** Only users and groups you add to the project can access it.
  - **A specific role** (for example, _Tester_): Every user can access the project, with that role's permissions.
- **User-Specific Permissions:** (Optional) Override default access for individual users.
- **Group Permissions:** (Optional) Set permissions for user groups.

:::warning New projects are visible to everyone by default
Unless you change **Default Project Access**, a new project uses **Use Global Role**, so every user who can sign in can open it. Choosing a specific role does not restrict the project either. To limit a project to certain people, set **Default Project Access** to **No Access** and add those users or groups. See [Restricted Project (Team-Only Access)](#restricted-project-team-only-access).
:::

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
3. The **Edit Project** dialog opens with three tabs, pre-filled with the project's current settings:
   - **Details:** Change the **Icon**, **Name**, **Description**, **Default Project Access**, and **Completed** status (with its **Date**).
   - **Users:** Add users to the project and set each user's project access.
   - **Groups:** Set the project access for each group.
4. Click **Save** to apply the changes.

See [Setting Up Access Control](#setting-up-access-control) for how the three tabs work together.

## Deleting a Project

Deleting a project marks it as inactive and typically hides it from standard views. While the underlying data might not be immediately purged, consider this a permanent action from a user perspective.

1. Locate the project you wish to delete in the table.
2. Click the **Delete** button in the corresponding row.
3. A confirmation dialog with a warning icon will appear, asking you to confirm the deletion of the project named **`{Project Name}`**. It emphasizes that this action cannot be undone.
4. If you are certain, click the **Confirm Delete** button.

## Project Access Control

### Overview

The project access system uses a hierarchical permission model that determines who can access projects based on three levels: project defaults, user-specific permissions, and group permissions.

:::warning Projects are open to all users unless you set No Access
Every new project starts with **Default Project Access** set to **Use Global Role**, which means **every user who can sign in can access the project**. Their permissions in it come from their own global role.

Adding users or groups to such a project does **not** hide it from anyone else. To restrict a project:

1. Go to **Administration > Projects** and click **Edit** on the project.
2. On the **Details** tab, set **Default Project Access** to **No Access**.
3. On the **Users** tab, add the users who should have access, and/or on the **Groups** tab, give the right groups access.
4. Click **Save**.

System administrators (access level `ADMIN`) can always access every project.
:::

### Access Types

#### Project-Level Default Access

Every project has a default access type that applies to all users unless overridden:

- **`GLOBAL_ROLE`** (shown as **Use Global Role**; the default for new projects): **Every user with site access can access this project.** Their permissions in the project come from their global role. Use this for projects anyone in your organization should be able to use.

- **`SPECIFIC_ROLE`** (shown as the name of a role, such as _Tester_): **Every user with site access can access this project**, with the permissions of the selected role instead of their own global role. Users and groups you add to the project can be given a different role. This setting controls _what_ people can do in the project, not _who_ can see it.

- **`NO_ACCESS`** (shown as **No Access**): **Nobody gets access by default.** Only the project creator, users added on the **Users** tab, members of groups given access on the **Groups** tab, and system administrators can access the project. **This is the only default that restricts who can see a project.**

:::tip Choosing a default

- Use **Use Global Role** when everyone should be able to use the project, with their usual permissions.
- Use **a specific role** when everyone should be able to use the project, but with the same set of permissions (for example, a read-only reference project).
- Use **No Access** when only certain teams or people should be able to see the project.

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
6. **Project Default**: If the project default is `GLOBAL_ROLE` or `SPECIFIC_ROLE`, every user with site access gets access; if it is `NO_ACCESS`, nobody gets access from this step
7. **Group Permissions**: Evaluated based on group membership and group-specific settings

### Setting Up Access Control

When creating or editing a project, you can configure access control through three tabs:

#### Details Tab

- Set the **Default Project Access** which determines the baseline permission for all users
- Choose **No Access**, **Use Global Role**, or a role from the dropdown
- Only **No Access** keeps the project hidden from users who are not added on the **Users** or **Groups** tab

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

Leave `Default Project Access` at **Use Global Role** (the default for new projects) - all users with system roles can access the project with their existing permissions. This is ideal for shared test repositories, company-wide projects, or when you want maximum visibility.

**Key points:**

- Everyone who can log into the system can see and access this project
- Users' permissions are based on their globally assigned role
- No additional user or group assignments are required for basic access

#### Restricted Project (Team-Only Access)

Set `Default Project Access` to **No Access**, then add the people who need access. Only explicitly added users and groups can access the project. This is ideal for confidential projects, department-specific work, or when you need to control exactly who has access.

**Steps:**

1. Go to **Administration > Projects** and click **Edit** on the project.
2. On the **Details** tab, set **Default Project Access** to **No Access**.
3. On the **Users** tab, use **Add User** to add each person, and choose their project access (their global role or a specific role).
4. On the **Groups** tab, set the project access for each group whose members should have access.
5. Click **Save**.

**Key points:**

- **No Access** is the only default that restricts who can see a project. Choosing a specific role as the default does not.
- Users must be explicitly added (directly or via groups) to access the project
- The project creator and system administrators keep access

#### Uniform Role Project

Set `Default Project Access` to a role - every user can access the project and works with that role's permissions regardless of their global role. Users and groups added to the project can be given a different role. To also limit _who_ can access the project, use [Restricted Project (Team-Only Access)](#restricted-project-team-only-access) instead.

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
3. Click **Manage Shares**
4. View all active, expired, and revoked shares

### Features

**Share Overview:**

- See all share links for the project and who created them
- View access mode (Authenticated, Public, Password-Protected) and whether report data is live or frozen
- Monitor view counts
- Track notification settings for each share
- Check expiration dates and status (Active, Expired, Revoked)

**Share Actions:**

- **Copy Link**: Copy share URL to clipboard for distribution
- **Edit** (active shares): Change title, description, share mode, password, expiration date, and notifications
- **Toggle Notifications** (active shares): Enable/disable view notifications
- **Revoke** (active shares): Immediately disable access; cannot be undone
- **Delete**: Remove the share; the link stops working

Every access to a share is recorded in the [audit log](./audit-logs.md). See [Share Links](./share-links.md) for details.

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

The result details note is mandatory only when **both** the previous and new statuses are _completed_ statuses **and** their pass/fail judgment differs. A status counts as completed when its **Completed** flag is set on the [Statuses](./statuses.md) admin page. In the default configuration **Skipped** is a completed status, so changing between Skipped and a Passed or Failed result is treated as a flip and requires justification too, not just Passed ↔ Failed. Recording the first result, or moving to or from a _non-completed_ status (such as Untested, Retest, or Blocked), is never blocked.

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

### Abandoned Automation Cleanup

Controls whether automated runs in this project that stopped receiving results are closed automatically. See the system-wide [Abandoned automation cleanup](./statuses.md#abandoned-automation-cleanup) policy for how the sweep works; manual runs are never affected.

- **Inherit system default**: Follow the system-wide policy (the current system threshold — or _off_ — is shown in the option label). This is the default.
- **Disable for this project**: Never sweep this project's runs, even when the system policy is on.
- **Custom idle threshold**: Set a project-specific idle time in minutes. A project can opt in this way even when the system policy is off.

Below the threshold, **Move closed runs to** picks the run state a swept run is moved into. It defaults to the project's first enabled **Done**-type run workflow state, marked with a star in the list. Choose a different state if the project distinguishes, say, an _Aborted_ state from _Done_; only run states assigned to this project are offered.
