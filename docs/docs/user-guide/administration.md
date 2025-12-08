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

**Single Sign-On (SSO) Configuration** (`/admin/sso`)

- Configure Google OAuth and SAML authentication providers
- Enable/disable Force SSO to require SSO authentication
- Manage email domain restrictions for new registrations
- Control who can register based on email domains

For detailed SSO configuration, see the [SSO Documentation](./sso.md).

### Search & Indexing

**Elasticsearch Administration** (`/admin/elasticsearch`)

- Monitor Elasticsearch cluster health and status
- Manage search indices (create, delete, reindex)
- Perform maintenance operations (cache clearing, optimization)
- Configure connection settings and authentication
- View real-time indexing statistics and performance metrics

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

### System Configuration

**Application Configuration** (`/admin/app-config`)

- Configure global application settings
- Set default values for new projects
- Manage system-wide preferences

**Workflows** (`/admin/workflows`)

- Define custom workflows for test execution
- Configure state transitions and permissions
- Assign workflows to projects

**Templates & Fields** (`/admin/templates-fields`)

- Create custom field templates for test cases
- Define field types and validation rules
- Configure result fields for test execution

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

**System Health**

- Monitor application performance
- View system resource usage
- Check background job status
- Review error logs

**Reports** (`/admin/reports`)

- Generate cross-project reports
- View system-wide statistics
- Export data for analysis
