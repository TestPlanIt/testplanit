---
sidebar_position: 1
title: Administration
---

# Administration

This section provides an overview of the administration features available in TestPlanIt. As an administrator, you can manage users, configure global settings, and maintain the overall application environment.

## Accessing Administration

To access the administration settings, you must be logged in as a user with administrative privileges.

1. Click the Admin link in the top navigation bar.

The top navigation bar will turn red indicating you are in an Administrative section of the application.

If you do not see an option to access Admin settings, you may not have the necessary permissions. Contact your system administrator if you believe you should have access.

## Key Administrative Features

### Authentication & Access Control

**Authentication** (`/admin/sso`)

- Configure Google OAuth, Apple Sign In, Microsoft (Entra ID), SAML, and Magic Link sign-in
- Manage email domain restrictions for new registrations
- Control who can register based on email domains

For detailed SSO configuration, see the [SSO Documentation](./sso.md).

**Security** (`/admin/security`)

- Set the password policy and the lockout policy
- Enable **Force SSO Login**, **Require 2FA for Password Logins**, or **Require 2FA for All Logins** under Sign-in Enforcement
- Force a password change for all users

For details, see the [Security Settings Documentation](./security-settings.md).

**SCIM Provisioning** (`/admin/scim`)

- Provision users and groups from your identity provider via SCIM 2.0
- Configure **group role mapping** — assign a Mapped Access Tier (User, Project Admin, or Admin) to groups so members automatically gain that global access level
- Set the fallback default access tier for users who belong to no mapped group
- Configure **role mappings** — map a `roles` value your IdP asserts on a user to an access tier; role mappings take precedence over group mapping
- **Rotate** a bearer token with an overlap window so provisioning keeps running while you paste the new value into the IdP
- Review the **conflict log**, including cross-IdP conflicts when two identity providers target the same user or group

For detailed SCIM and role-mapping information, see the [SCIM Provisioning Documentation](./scim.md).

### Search & Indexing

**Search Engine** (`/admin/elasticsearch`)

- View Elasticsearch connection and cluster health (nodes, indices, document counts)
- Set the number of index replicas
- Reindex all or selected entity types

For detailed search configuration, see the [Search Configuration Documentation](../search-configuration.md).

### User Management

**Users** (`/admin/users`)

- Create, edit, and manage user accounts
- Assign system-wide access levels
- Enable/disable user accounts
- View user activity and last login times

**Groups** (`/admin/groups`)

- Create and manage user groups
- Assign users to groups for easier permission management
- Configure group-based project access
- Set a **Mapped Access Tier** to drive members' global access level ([role mapping](./scim.md#role-mapping))
- Grant **Per-project access** so a group carries a tier on specific projects only ([per-project access](./groups.md#per-project-access))

### System Configuration

**Application Configuration** (`/admin/app-config`)

- Configure global application settings
- Set default values for new projects
- Manage system-wide preferences

**Workflows** (`/admin/workflows`)

- Define custom workflows for test execution
- Configure state transitions and permissions
- Assign workflows to projects

**Templates & Fields** (`/admin/fields`)

- Create custom field templates for test cases
- Define field types and validation rules
- Configure result fields for test execution

### Tools & Integrations

**Code Repositories** (`/admin/code-repositories`)

- Connect source repositories (GitHub, GitLab, Azure DevOps, Bitbucket, Gitea) once, then use them across projects: QuickScript grounds generated scripts in your real page objects and fixtures, Impact Analysis reads commits, and execution targets dispatch automated runs to the repository's CI

For details, see the [Code Repositories Documentation](./code-repositories.md).

### AI Tools

**AI Models** (`/admin/llm`)

- Connect AI providers (OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Azure OpenAI, Ollama, or a custom OpenAI-compatible endpoint)
- Set per-model token limits, rate limits, cost, and monthly budgets
- Test connections and probe model capabilities

For detailed configuration, see the [AI Models Documentation](./llm-integrations.md).

**Prompt Configs** (`/admin/prompts`)

- Create and edit the prompt configurations that shape how AI features behave
- Optionally assign a specific AI model per prompt

For details, see the [Prompt Configurations Documentation](./prompt-configurations.md).

**QuickScript Templates** (`/admin/quickscripts`)

- Manage the templates [QuickScript](./projects/quickscript.md) uses to turn manual test cases into automation scripts

### Audit & Compliance

**Audit Logs** (`/admin/audit-logs`)

- View a complete history of all system actions
- Track who did what, when, and from where
- Filter by action type, user, entity, or date range
- Export audit logs for compliance reporting
- Monitor authentication events (logins, logouts, failed attempts)
- Review permission changes and data modifications

For detailed audit log information, see the [Audit Logs Documentation](./audit-logs.md).

### Monitoring & Maintenance

**Job Queues** (`/admin/queues`)

- Monitor background job queues
- Inspect and retry failed jobs
- See [Job Queues](./queues.md)

**Reports** (`/admin/reports`)

- Generate cross-project reports
- View system-wide statistics
- Export data for analysis
