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

- Only ADMIN users can set system access levels
- Navigate to **Administration** > **Users**
- Edit user and select access level
- Changes take effect immediately

## Project Access Control

Projects can be configured with different access models to control who can view and modify content.

### Project Access Types

#### DEFAULT

**Behavior**: Basic access for all system users

**When to Use**:

- Open projects accessible to all users
- Company-wide test repositories
- Shared resources

**Access Rules**:

- All users with access level USER or higher can access
- Uses user's global role for permissions
- Simplest access model

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

**Behavior**: Only explicitly assigned users can access

**When to Use**:

- Confidential or restricted projects
- Department-specific projects
- Projects requiring explicit approval

**Access Rules**:

- Must be explicitly assigned to access
- Uses assigned project-specific role
- Must have default role configured
- More restrictive than GLOBAL_ROLE

#### NO_ACCESS

**Behavior**: Explicitly deny access to specific users

**When to Use**:

- Revoke access for specific individuals
- Temporary access removal
- Override inherited permissions

**Access Rules**:

- User cannot access the project
- Overrides all other permissions
- Overrides group and default access
- System Administrators (access level `ADMIN`) are **not** affected by NO_ACCESS — they always have full access

### Configuring Project Access

**Setting Default Access Type**:

1. Navigate to project settings
2. Select **Default Access Type**:
   - **GLOBAL_ROLE** (most common)
   - **SPECIFIC_ROLE** (restrictive)
   - **DEFAULT** (open)
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
- **TestCaseRestrictedFields** - Editing restricted field values on test cases
- **TestRuns** - Creating, editing, and deleting active test runs
- **ClosedTestRuns** - Deleting completed or archived test runs
- **TestRunResults** - Recording and managing results for test cases within a run
- **TestRunResultRestrictedFields** - Recording restricted field values on test run results
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

### Permission Types

For each application area, roles can have:

- **canAddEdit** - Create and modify items
- **canDelete** - Delete items
- **canClose** - Mark items as complete/closed

### Default Roles

TestPlanIt includes several pre-configured roles:

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

1. System `ADMIN` or `PROJECTADMIN` access level → full permissions, role is irrelevant
2. Explicit user-project permission with `SPECIFIC_ROLE` → uses the assigned project role
3. Explicit user-project permission with `GLOBAL_ROLE` → uses the user's global role
4. Group-project permission with `SPECIFIC_ROLE` → uses the group's assigned project role
5. Project default access with `SPECIFIC_ROLE` → uses the project's default role
6. Project default access with `GLOBAL_ROLE` → uses the user's global role
7. No match → access denied

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
- **Individual user permissions override** group permissions (if a user has an explicit project permission, it takes precedence)
- **Multiple groups** - If a user belongs to multiple groups with access to the same project, the first group with a `SPECIFIC_ROLE` assignment is used
- **NO_ACCESS denial** on a user overrides group permissions
- **Groups with GLOBAL_ROLE** - Each group member uses their own global role for permissions in that project
- **Groups with SPECIFIC_ROLE** - All group members share the same assigned role for that project

:::note
Group permissions are assigned **per project** in **Project Settings > Members**, not globally in the Admin > Groups page. The Admin > Groups page only manages group membership (which users belong to which group).
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
   - Overrides all other rules

2. **Project Creator Check**
   - If user created the project → Full project access
   - Overrides project-level permissions

3. **Explicit NO_ACCESS Denial**
   - If user has NO_ACCESS for project → Access denied
   - Overrides group and default access

4. **Explicit User Permission**
   - Check user-specific project permission
   - Takes precedence over group and defaults

5. **Group Permission**
   - Check if user is in groups with project access
   - If multiple groups have access, the first group with a `SPECIFIC_ROLE` assignment is used

6. **Project Default Access**
   - Apply project's default access type
   - Use default role if configured

7. **System Default**
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
2. Set default access type: SPECIFIC_ROLE
3. Set default role: Contributor
4. Explicitly assign team members
5. Or create dedicated group

**Result**: Only assigned users can access

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

1. Browser cache
2. User logged out/in
3. Permission changes saved
4. Session refreshed

**Solutions**:

- Hard refresh browser (Ctrl+Shift+R / Cmd+Shift+R)
- Log out and log back in
- Verify changes were saved
- Wait a moment for changes to propagate

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
GET /api/get-user-permissions?userId={userId}&projectId={projectId}
```

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
