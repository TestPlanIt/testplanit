---
title: Permissions Guide
sidebar_position: 17
---

# Permissions Guide

TestPlanIt uses a sophisticated multi-level permission system that combines system-wide access levels, project-specific permissions, role-based access control, and group assignments. This guide explains how permissions work and how to configure them effectively.

## Overview

TestPlanIt's permission model has four layers:

1. **System Access Levels** - Global access tiers for all users (`ADMIN`, `PROJECTADMIN`, `USER`, `NONE`)
2. **Roles** - Named sets of permissions across application areas (e.g., can add/edit test cases, can delete test runs)
3. **Groups** - Collections of users that can be assigned project-level access in bulk
4. **Project Access Control** - Per-user or per-group overrides that determine which role applies in each project

These layers work together to provide flexible, secure access control across the entire application.

## System Access Levels

Every user has a system-wide access level that determines their baseline permissions across TestPlanIt.

### Access Level Hierarchy

#### ADMIN (System Administrator)

**Capabilities**:

- Full access to all features and data
- Manage all users, groups, and system settings
- Access all projects regardless of assignment
- Configure system-wide settings (statuses, workflows, templates, fields)
- Manage integrations and SSO configuration
- View and modify all data
- Cannot be restricted by project-level permissions

**Use Cases**:

- IT administrators
- Platform owners
- System maintenance personnel

**Permissions**:

- All administrative functions
- All project access automatically
- Override all permission restrictions
- User management
- System configuration

#### PROJECTADMIN (Project Administrator)

**Capabilities**:

- Manage projects they are assigned to
- Add/remove users from their projects
- Configure project settings
- Create and delete projects
- Assign roles within their projects
- Full access to content within assigned projects
- View the [audit log](./audit-logs.md#viewing-a-projects-activity) for assigned projects

**Use Cases**:

- Team leads
- Project managers
- Department heads

**Permissions**:

- Create projects
- Manage assigned projects
- Manage project members
- Configure project settings
- Full access to project data
- Cannot access system-wide administration
- Cannot manage users outside their projects

#### USER (Standard User)

**Capabilities**:

- Access projects they're assigned to
- Create and modify test content
- Execute tests and record results
- View and use assigned projects
- Basic collaboration features

**Use Cases**:

- Testers
- QA engineers
- Developers
- Contributors

**Permissions**:

- Access assigned projects
- Create test cases, runs, sessions
- Record test results
- Comment and collaborate
- Cannot create projects
- Cannot manage users
- Cannot access system settings

#### NONE (No Access)

**Capabilities**:

- Cannot access any functionality
- Account exists but is inactive
- Can log in but sees no content

**Use Cases**:

- Suspended accounts
- Pending activation
- Disabled users

**Permissions**:

- No project access
- No content access
- Read-only or no access to dashboard

**Setting Access Levels**:

- An ADMIN can set a user's access level manually: navigate to **Administration** > **Users**, edit the user, and select an access level. No further step is needed, though an already–signed-in user may keep their previous access for up to a minute — see [How Quickly Changes Take Effect](#how-quickly-changes-take-effect).
- Access levels can also be assigned **automatically by group role mapping** — a group carries a mapped tier (User, Project Admin, or Admin) that its members inherit, highest-wins, with a configurable fallback default. See [Role mapping](./scim.md#role-mapping) and [Groups → Mapped access tier](./groups.md#mapped-access-tier).
- Editing the access level of a user who is governed by group mapping switches them to manual control.

## Project Access Control

Projects can be configured with different access models to control who can view and modify content.

### Project Access Types

#### GLOBAL_ROLE (Recommended)

**Behavior**: Access based on user's global role

**When to Use**:

- Standard project access model
- Role-based permissions needed
- Most common configuration

**Access Rules**:

- Users with access level USER or higher can access
- Permissions determined by their global role
- Can be overridden with specific permissions
- Group assignments still apply

#### SPECIFIC_ROLE

**Behavior**: Every user works with the project's configured default role

**When to Use**:

- Projects where everyone should have the same, project-defined capabilities regardless of their global role
- Standardizing a project's permissions (e.g. a read-only-by-default reference project)

**Access Rules**:

- All users with access level USER or higher can access
- Permissions come from the project's **Default Role**, not each user's global role
- Must have a default role configured
- Explicitly assigned users and groups can still be given different roles, which take precedence for them

:::warning SPECIFIC_ROLE does not make a project private
Every user except those with access level `NONE` (or an explicit NO_ACCESS permission) can access the project with the default role's permissions. To restrict a project to specific people, set the default access type to **NO_ACCESS** and add explicit user or group grants.
:::

#### NO_ACCESS

**Behavior**: As a project's default access type, makes the project private; as a per-user permission, explicitly denies that user

**When to Use**:

- **As the project default**: confidential or restricted projects — only the project creator, explicitly assigned users and groups, and administrators can access
- **As a per-user permission**: revoke access for specific individuals, temporary access removal, overriding inherited permissions

**Access Rules**:

- A per-user NO_ACCESS permission denies that user regardless of every other grant — including being the project's creator, group access, and default access
- A NO_ACCESS project default grants nothing implicitly; access requires an explicit user grant, group grant, or project assignment
- System Administrators (access level `ADMIN`) are **not** affected by NO_ACCESS — they always have full access

### Configuring Project Access

**Setting Default Access Type**:

1. Navigate to project settings
2. Select **Default Access Type**:
   - **GLOBAL_ROLE** (most common — everyone uses their own global role)
   - **SPECIFIC_ROLE** (everyone uses the project's default role)
   - **NO_ACCESS** (private — explicit grants only)
3. If using SPECIFIC_ROLE, select a **Default Role**
4. Save changes

**Managing Project Members**:

1. Navigate to **Project Settings** > **Members**
2. Click **Add Member** to assign users
3. For each member, configure:
   - **Access Type**: Choose permission model
   - **Role**: Select role (if using SPECIFIC_ROLE)
4. Remove users to revoke access

## Roles and Permissions

Roles define what actions users can perform within projects. TestPlanIt uses application areas to organize permissions.

### Application Areas

Permissions are granted per application area. The complete list of areas is:

- **Documentation** - Creating and editing project documentation
- **Milestones** - Creating, editing, and deleting project milestones
- **TestCaseRepository** - Creating, editing, deleting, and organizing test case folders and test cases (including test steps)
- **TestCaseRestrictedFields** - Editing restricted field values on test cases, and viewing sensitive parameter values in shared/owner-bound datasets attached to test cases (see [Parameterized Test Cases](./projects/parameterized-test-cases.md))
- **TestRuns** - Creating, editing, and deleting active test runs, including locking a run's composition
- **ClosedTestRuns** - Deleting completed or archived test runs
- **TestRunResults** - Recording and managing results for test cases within a run (works even when the run's composition is locked)
- **TestRunResultRestrictedFields** - Recording restricted field values on test run results, and viewing sensitive parameter values on iteration results, matrix cells, matrix exports, and the issue-prefill body when linking an external issue from a failed iteration (see [Parameterized Test Cases](./projects/parameterized-test-cases.md))
- **Sessions** - Creating and managing active test sessions
- **SessionsRestrictedFields** - Recording restricted field values on test sessions
- **ClosedSessions** - Deleting completed or archived test sessions
- **SessionResults** - Recording and managing results for test cases within a session
- **Tags** - Creating new tags
- **SharedSteps** - Managing shared test step groups
- **Issues** - Issue tracking and management
- **IssueIntegration** - Managing external issue tracker integrations
- **Forecasting** - Time and effort forecasting
- **Reporting** - Reports and analytics
- **Settings** - Project settings

:::note Unlocking a run's composition requires the creator or project admin
Any user with the `TestRuns` **Add/Edit** permission can **lock** a run's composition, but **unlocking** is restricted to the run's **creator**, a **project admin** (the project creator or a user with the **Project Admin** role), or a user with `PROJECTADMIN`/`ADMIN` system access. See [Composition lock](./projects/run-details.md#composition-lock).
:::

:::note Milestone sync actions require project admin
Most milestone actions follow the `Milestones` area's **Add/Edit** permission as described above — including linking or unlinking individual issues and editing milestone fields. A few actions that reach out to the external tracker instead require **project admin** status (the project creator, a user with the **Project Admin** role on the project, or a user with `PROJECTADMIN`/`ADMIN` system access), regardless of the acting user's `Milestones` permission:

- **Import from Jira**
- **Sync now**
- **Unlink from Jira**
- **Import & link** (the member-issues overflow panel)

See [Milestone Details](./projects/milestone-details.md) and [Milestones](./projects/milestones.md) for where these actions appear.
:::

### Permission Types

For each application area, roles can have:

- **canAddEdit** - Create and modify items
- **canDelete** - Delete items
- **canClose** - Mark items as complete/closed. On the **TestRuns** and **Sessions** areas this is enforced on the write itself, not only by hiding the button — see [Completing runs and sessions](#completing-runs-and-sessions).
- **canReadSensitive** - View values otherwise masked as `••••••` or `[REDACTED]`. Honored by the **TestCaseRestrictedFields** and **TestRunResultRestrictedFields** areas; the other areas ignore it. Without this grant on the right area, a user sees `••••••` in dataset rows / iteration cells and `[REDACTED]` in the issue prefill body and matrix exports.
- **canApprove** - Eligible to be assigned as a reviewer and to decide review requests in the Review & Approval feature. Honored on the **TestCaseRepository**, **TestRuns**, and **Sessions** areas; the other areas ignore it.

### Completing runs and sessions

Marking a test run or a session **completed** is treated as a privileged, one-way act — a completed run or session is frozen and cannot be reopened in the app — so **canClose** on the matching area is checked on the server every time the completed flag changes, not just when deciding whether to draw the **Complete** button.

This has three consequences worth knowing:

- **Every route is covered.** The check applies to the write itself, so it holds for the UI, the [public API](../api-reference.md), the SDKs, and the MCP server alike. Holding **canAddEdit** on Test Runs does not let an integration complete a run through the API.
- **Users see a clear refusal.** If a user's permissions changed while they had a page open, the **Complete** dialog reports that they do not have permission rather than appearing to do nothing.
- **Completing a milestone needs its own grants.** Milestone completion optionally cascades into the milestone's test runs and sessions. Each half of that cascade requires **canClose** on **that** area — **canClose** on Milestones alone is not a side door into closing runs. If a user can close the milestone but not its runs, the milestone still completes and a message tells them which half was left open, so the runs can be closed by someone who holds the permission. (When [review gates](./review-approvals.md#milestone-completion) block a cascade, the behavior is different: the whole cascade is rolled back.)

### Managing Roles

TestPlanIt does not ship with pre-configured roles — administrators create them in **Administration** > **Roles**. Two role concepts carry special behavior:

- **The default role** - one role can be marked as the default. Newly provisioned users (including SCIM-provisioned accounts) receive it automatically, and it cannot be deleted while it is the default.
- **The role named `Project Admin`** - this exact name is special-cased. A user whose project permission is `SPECIFIC_ROLE` with a role named **Project Admin** counts as a *project admin* — alongside the project creator and `PROJECTADMIN`/`ADMIN` system access — for admin-gated project actions such as milestone sync, unlocking a run's composition, and managing project members.

### Example Role Patterns

Roles you may want to create:

#### Project Admin

- Full access to all application areas
- All permissions enabled
- Can manage project members
- Recommended for project leads

#### Manager

- Can add/edit in most areas
- Can close items (runs, sessions, milestones)
- Cannot delete critical data
- Good for team leads

#### Contributor

- Can add/edit test content
- Can record test results
- Cannot delete or close
- Standard role for team members

#### Tester

- Can add/edit repository and test runs
- Can record test results
- Limited administrative access
- Focused on test execution

#### Guest (Read-Only)

- Can view content
- Cannot add, edit, or delete
- Cannot record results
- For stakeholders and viewers

### Creating Custom Roles

1. Navigate to **Administration** > **Roles**
2. Click **Create Role**
3. Enter role name
4. For each application area, toggle:
   - Add/Edit permission
   - Delete permission
   - Close permission
5. Save role
6. Assign to users in projects

### Role Assignment

Roles can be assigned at multiple levels:

1. **Globally** - Every user has a system-wide default role (set in **Administration > Users**)
2. **Per-Project (User)** - A user can be given a specific role for a project (set in **Project Settings > Members**)
3. **Per-Project (Group)** - A group can be given a specific role for a project (set in **Project Settings > Members**)

**Effective Role Resolution** (highest to lowest priority):

1. System `ADMIN` access level → full permissions everywhere, role is irrelevant
2. System `PROJECTADMIN` access level → full permissions on every project they can access through any path below (an explicit NO_ACCESS permission still denies them)
3. Explicit user-project permission with `SPECIFIC_ROLE` → uses the assigned project role
4. Explicit user-project permission with `GLOBAL_ROLE` → uses the user's global role
5. Group-project permission with `SPECIFIC_ROLE` → uses the group's assigned project role
6. Group-project permission with `GLOBAL_ROLE` → uses the user's own global role
7. Project default access with `SPECIFIC_ROLE` → uses the project's default role
8. Project default access with `GLOBAL_ROLE` → uses the user's global role
9. No match → access denied

:::note Access grants are additive
The order above determines **which role** applies when several grants exist. Access itself is additive across paths — holding an explicit grant with a weaker role does not remove capabilities available through a group grant. The only way to take access away from a specific user is an explicit **NO_ACCESS** permission; a weaker role grant is not a denial.
:::

## Group-Based Permissions

Groups provide an efficient way to manage permissions for teams.

### Group Structure

**Creating Groups**:

1. Navigate to **Administration** > **Groups**
2. Click **Create Group**
3. Name the group (e.g., "QA Team", "Engineering")
4. Add users to the group
5. Save

**Assigning Groups to Projects**:

1. Navigate to **Project Settings** > **Members**
2. Click **Add Group**
3. Select the group
4. Configure group permissions:
   - Access type (GLOBAL_ROLE or SPECIFIC_ROLE)
   - Role (if using SPECIFIC_ROLE)
5. Save

### Group Permission Behavior

- **All group members inherit** the group's project permissions
- **Individual user permissions decide the role first** - if a user has an explicit project permission, it determines their effective role before any group grant is considered. Grants remain additive: an explicit grant with a weaker role is not a denial (use NO_ACCESS to deny)
- **Multiple groups** - If a user belongs to multiple groups with access to the same project, the first group with a `SPECIFIC_ROLE` assignment is used
- **NO_ACCESS denial** on a user overrides group permissions
- **Groups with GLOBAL_ROLE** - Each group member uses their own global role for permissions in that project
- **Groups with SPECIFIC_ROLE** - All group members share the same assigned role for that project; if a member also belongs to a GLOBAL_ROLE-granted group, the SPECIFIC_ROLE grant decides their role

:::note
The project permissions described here are assigned **per project** in **Project Settings > Members**. The **Admin > Groups** page manages group membership and, separately, an optional **Mapped Access Tier** that drives members' global access level (see [Role mapping](./scim.md#role-mapping)) — it does not assign per-project roles.
:::

### Use Cases

**Department Access**:

```text
Group: "QA Department"
Projects: All testing projects
Role: Tester
Access Type: GLOBAL_ROLE
```

**Project Team**:

```text
Group: "Project Phoenix Team"
Projects: Project Phoenix only
Role: Contributor
Access Type: SPECIFIC_ROLE
```

**Stakeholders**:

```text
Group: "Executives"
Projects: All projects
Role: Guest (Read-Only)
Access Type: GLOBAL_ROLE
```

## Permission Resolution

Understanding how TestPlanIt resolves permissions when multiple rules apply:

### Resolution Order

1. **System Admin Check**
   - If user has ADMIN access level → Full access to everything
   - Overrides all other rules, including NO_ACCESS

2. **Explicit NO_ACCESS Denial**
   - If user has a NO_ACCESS permission for the project → Access denied
   - Overrides the project creator, group, and default access

3. **System Project Admin Check**
   - If user has PROJECTADMIN access level and any check below grants access → Full permissions on that project

4. **Project Creator Check**
   - If user created the project → Full project access

5. **Explicit User Permission**
   - Check user-specific project permission
   - Decides the effective role before group and defaults

6. **Group Permission**
   - Check if user is in groups with project access
   - A `SPECIFIC_ROLE` grant applies the group's assigned role; a `GLOBAL_ROLE` grant applies each member's own global role
   - If multiple groups have access, the first group with a `SPECIFIC_ROLE` assignment is used

7. **Project Default Access**
   - Apply project's default access type
   - Use default role if configured

8. **System Default**
   - If no other rules match → Deny access

### Permission Examples

**Example 1: Simple Access**

```text
User: John (access level: USER)
Global Role: Tester
Project: Default Access Type = GLOBAL_ROLE

Result: John can access, with Tester permissions
```

**Example 2: Specific Role Override**

```text
User: Sarah (access level: USER)
Global Role: Tester
Project: Sarah explicitly assigned as "Project Admin" role

Result: Sarah has Project Admin permissions (overrides global role)
```

**Example 3: Group Access**

```text
User: Mike (access level: USER, no individual assignment)
Group: "QA Team" (assigned to project with Contributor role)
Project: Default Access Type = SPECIFIC_ROLE

Result: Mike can access via group, with Contributor permissions
```

**Example 4: NO_ACCESS Denial**

```text
User: Jane (access level: PROJECTADMIN)
Project: Jane explicitly set to NO_ACCESS

Result: Jane cannot access, despite being a PROJECTADMIN
```

**Example 5: Multiple Groups**

```text
User: Alex
Group 1: "Testers" → SPECIFIC_ROLE with Tester role
Group 2: "Managers" → SPECIFIC_ROLE with Manager role
Project: Both groups assigned

Result: Alex gets the role from whichever group permission is evaluated first
(the system does not automatically pick the most permissive role)
```

:::tip
To ensure predictable results, avoid assigning a user to multiple groups with different `SPECIFIC_ROLE` assignments on the same project. Instead, assign the user an explicit project-level permission to override group access.
:::

### How Quickly Changes Take Effect

To keep permission checks off the database on every request, TestPlanIt caches each user's resolved list of accessible projects for **60 seconds**. Most permission changes are therefore visible within a minute rather than instantly.

**Can take up to 60 seconds**

- Granting or revoking a project permission, for a user or for a group
- Adding or removing a project assignment
- Changing a project's default access type or default role
- Adding or removing a user from a group
- Changing a user's system access level

**Takes effect on the user's next request**

- Deactivating a user account. The active check is read from the database on every request and is never cached.
- Changing a user's password, which invalidates their existing sessions.

:::caution
When access needs to be gone **now** — a departing employee, a suspected compromise — deactivate the account. Deactivation applies on the user's next request, whereas revoking project permissions or removing group membership can take up to a minute. Tidy up the permissions afterwards.
:::

:::note
Waiting is what clears the server-side cache. Logging out and back in refreshes browser state, but it does not shorten this cache — a user who signs back in within the window can still be served the previous project list until it expires.
:::

## Common Permission Scenarios

### Scenario 1: New Employee Onboarding

**Goal**: Give new QA engineer access to testing projects

**Steps**:

1. Create user account
2. Set access level to USER
3. Assign global role: Tester
4. Add to group: "QA Team"
5. Group provides access to relevant projects

**Result**: User can access and test assigned projects

### Scenario 2: Confidential Project

**Goal**: Restrict project to specific team

**Steps**:

1. Create project
2. Set default access type: NO_ACCESS
3. Explicitly assign team members with the appropriate role
4. Or assign a dedicated group

**Result**: Only the project creator, assigned users and groups, and administrators can access

### Scenario 3: Temporary Contractor

**Goal**: Grant limited access for external contractor

**Steps**:

1. Create user account
2. Set access level: USER
3. Assign global role: Guest (Read-Only)
4. Add to specific projects with Guest role
5. Set expiration reminder

**Result**: Contractor has view-only access

### Scenario 4: Department Migration

**Goal**: Move team between projects

**Steps**:

1. Create new group: "Team Alpha"
2. Add all team members
3. Assign group to new projects
4. Remove from old projects
5. One change updates entire team

**Result**: Efficient team management

### Scenario 5: Revoking Access

**Goal**: Remove access for departing employee

**Steps**:

1. Navigate to user management
2. Option A: Set access level to NONE
3. Option B: Set NO_ACCESS for all projects
4. Option C: Deactivate account
5. Remove from groups

**Result**: User has no access

**If the removal is urgent, start with Option C.** Deactivating the account applies on the user's very next request, because the active check is never cached. Options A, B and step 5 all go through the 60-second project-access cache, so an already–signed-in user can retain access for up to a minute after you save. See [How Quickly Changes Take Effect](#how-quickly-changes-take-effect).

## Troubleshooting Permissions

### "Access Denied" to Project

**Check**:

1. User's system access level (must not be NONE)
2. Project's default access type
3. User's explicit project permission
4. Group memberships
5. NO_ACCESS denials

**Solutions**:

- Set access level to USER or higher
- Add user to project explicitly
- Add user to appropriate group
- Remove NO_ACCESS denial
- Change project to GLOBAL_ROLE if too restrictive

### Cannot Modify Content

**Check**:

1. Role permissions for the application area
2. canAddEdit permission enabled
3. User's effective role
4. Item-specific restrictions

**Solutions**:

- Assign role with canAddEdit for relevant area
- Upgrade user's role
- Check if item is archived or locked
- Verify project access type

### Group Members Not Getting Access

**Check**:

1. Group properly assigned to project
2. Group access type configured
3. Role assigned to group (if SPECIFIC_ROLE)
4. Users are active group members

**Solutions**:

- Verify group assignment in project settings
- Set appropriate access type for group
- Assign role if using SPECIFIC_ROLE
- Confirm users are in the group

### Permissions Not Updated

**Check**:

1. How long ago the change was saved — project access is cached for 60 seconds
2. Permission changes actually saved
3. Browser cache
4. Whether the change is one that applies immediately (see below)

**Solutions**:

- Wait up to 60 seconds and retry. This is the usual answer, and it resolves on its own — see [How Quickly Changes Take Effect](#how-quickly-changes-take-effect) for which changes are affected.
- Verify the change was saved
- Hard refresh browser (Ctrl+Shift+R / Cmd+Shift+R) to rule out stale page state

:::note
Logging out and back in does **not** shorten the 60-second server-side cache — the entry is keyed to the user, not to the session. Use it to rule out browser-side staleness, not as a way to force a permission change through.
:::

If the change still has not applied after a minute, it is not this cache. Confirm the change was saved, then work through [Access Denied to Project](#access-denied-to-project) — the permission may be being overridden by a higher-precedence rule such as a per-user `NO_ACCESS`.

## Best Practices

### Permission Design

1. **Start Restrictive** - Begin with minimal access, add as needed
2. **Use Groups** - Manage teams via groups, not individual assignments
3. **Consistent Roles** - Use same role names across projects
4. **Document Rules** - Document your permission strategy
5. **Regular Audits** - Periodically review access rights

### Role Management

1. **Limit Custom Roles** - Too many roles become confusing
2. **Descriptive Names** - Use clear, descriptive role names
3. **Template Roles** - Create role templates for common patterns
4. **Permission Testing** - Test roles before wide deployment
5. **Version Control** - Track role permission changes

### Group Organization

1. **Functional Groups** - Organize by department or function
2. **Project Groups** - Create project-specific teams when needed
3. **Temporary Groups** - Use for short-term projects
4. **Naming Conventions** - Use consistent group naming

### Security

1. **Principle of Least Privilege** - Grant minimum necessary access
2. **Regular Reviews** - Audit permissions quarterly
3. **Remove Promptly** - Revoke access when no longer needed
4. **Separate Duties** - Don't give one person all permissions
5. **Monitor Access** - Track who accesses sensitive projects

### Compliance

1. **Document Policies** - Write down permission policies
2. **Access Logs** - Enable and review access logs
3. **Separation** - Separate production and test environments
4. **Audit Trail** - Maintain audit trail of permission changes
5. **Compliance Reports** - Generate regular access reports

## Administrator Tools

### User Management

**Administration** > **Users**:

- View all users
- Set system access levels
- Assign global roles
- Deactivate accounts
- Reset passwords (if applicable)

### Role Management

**Administration** > **Roles**:

- Create custom roles
- Edit role permissions
- View role usage
- Delete unused roles
- Set default role

### Group Management

**Administration** > **Groups**:

- Create groups
- Add/remove members
- Set a **Mapped Access Tier** to drive members' global access level (see [Role mapping](./scim.md#role-mapping))
- View group projects
- Delete groups
- Audit group access

### Project Settings

**Project Settings** > **Members**:

- View all members
- Add/remove users
- Configure access types
- Assign roles
- Manage groups

## API and Programmatic Access

Permission information is accessible via API:

**Get User Permissions for a Project**:

```http
POST /api/get-user-permissions
Content-Type: application/json

{
  "userId": "abc",
  "projectId": 123,
  "area": "TestCaseRepository"
}
```

Requires an authenticated session. Non-admin callers can only query their own `userId`; system `ADMIN` callers may query any user. `area` is optional — omit it to receive permissions for every application area. Pass `"checkAccessOnly": true` to receive just the access flag and effective role without the permission grid.

**Update User Project Permission** (via ZenStack REST API):

```http
PUT /api/model/userProjectPermission/update
Content-Type: application/json

{
  "where": {"userId_projectId": {"userId": "abc", "projectId": 123}},
  "data": {
    "accessType": "SPECIFIC_ROLE",
    "roleId": 5
  }
}
```

---

**Related Documentation**:

- [User Management](./users.md) - Managing user accounts
- [Groups](./groups.md) - Group configuration
- [Roles](./roles.md) - Role management
- [Projects](./projects.md) - Project settings
- [Administration](./administration.md) - Admin overview
