---
sidebar_position: 13
title: Audit Logs
---

# Audit Logs

Audit logs provide a comprehensive record of all significant actions performed within TestPlanIt. This feature is essential for security compliance, troubleshooting, and maintaining accountability across your organization.

## Overview

The audit log system automatically captures:

- **Who** performed an action (user identity, email, IP address)
- **What** was changed (entity type, entity ID, field-level changes)
- **When** the action occurred (timestamp)
- **Where** the action originated from (IP address, user agent)

## Accessing Audit Logs

To access the audit logs:

1. Navigate to **Admin** in the top navigation bar
2. Click on **Audit Logs** in the admin sidebar

:::note
Only users with administrative privileges can access the audit log viewer.
:::

## Tracked Actions

### Authentication Events

| Action | Description |
|--------|-------------|
| `LOGIN` | User successfully logged in |
| `LOGOUT` | User logged out |
| `LOGIN_FAILED` | Failed login attempt |
| `PASSWORD_CHANGED` | User changed their password |
| `PASSWORD_RESET` | Password was reset |

### Data Operations

| Action | Description |
|--------|-------------|
| `CREATE` | A new record was created |
| `UPDATE` | An existing record was modified |
| `DELETE` | A record was deleted (soft delete) |
| `BULK_CREATE` | Multiple records created at once |
| `BULK_UPDATE` | Multiple records updated at once |
| `BULK_DELETE` | Multiple records deleted at once |

### Permission & Access Control

| Action | Description |
|--------|-------------|
| `PERMISSION_GRANT` | User/group granted access to a project |
| `PERMISSION_REVOKE` | User/group access revoked from a project |
| `ROLE_CHANGED` | User's system-wide role was changed |

### API Token Management

| Action | Description |
|--------|-------------|
| `API_KEY_CREATED` | A new API token was created |
| `API_KEY_DELETED` | An API token was deleted |
| `API_KEY_REVOKED` | An API token was revoked by an administrator |
| `API_KEY_REGENERATED` | An API token was regenerated |

### System Configuration

| Action | Description |
|--------|-------------|
| `SYSTEM_CONFIG_CHANGED` | Application configuration was modified |
| `SSO_CONFIG_CHANGED` | SSO provider settings were updated |

### Data Export

| Action | Description |
|--------|-------------|
| `DATA_EXPORTED` | Data was exported from the system |

## Tracked Entities

The following entity types are tracked in the audit log:

- **Test Management**: Test Cases, Test Runs, Test Results, Sessions, Shared Steps
- **Project Management**: Projects, Milestones, Issues, Tags
- **User Management**: Users, Groups, Permissions
- **Security**: API Tokens
- **Configuration**: SSO Providers, Email Domains, App Config
- **Content**: Comments, Attachments

## Filtering Audit Logs

The audit log viewer supports filtering by:

- **Date Range**: View logs from a specific time period
- **Action Type**: Filter by specific actions (CREATE, UPDATE, DELETE, etc.)
- **Entity Type**: Filter by the type of entity affected
- **User**: Search for actions by a specific user
- **Project**: View logs for a specific project

## Audit Log Details

Each audit log entry contains:

| Field | Description |
|-------|-------------|
| Timestamp | When the action occurred |
| User | Who performed the action (name, email) |
| Action | The type of action performed |
| Entity Type | The type of record affected |
| Entity ID | The unique identifier of the affected record |
| Entity Name | A human-readable name for the entity |
| Project | The project context (if applicable) |
| IP Address | The client's IP address |
| Changes | Field-level changes (for UPDATE actions) |

### Viewing Changes

For UPDATE actions, you can view the specific fields that were modified:

- **Old Value**: The previous value before the change
- **New Value**: The new value after the change

Sensitive fields (passwords, tokens, API keys) are automatically masked in the audit log.

## Exporting Audit Logs

Administrators can export audit logs to CSV for compliance reporting or external analysis:

1. Apply your desired filters (search, action type, entity type)
2. Click the **Export CSV** button
3. The CSV file will be downloaded to your device

The exported CSV includes all filtered audit log entries with the following columns:

- Timestamp
- Action
- Entity Type
- Entity ID
- Entity Name
- User
- Email
- Project
- IP Address
- User Agent
- Metadata (JSON)

:::info
Audit log exports are themselves logged as `DATA_EXPORTED` events for accountability.
:::

## Technical Details

### Asynchronous Processing

Audit events are processed asynchronously using a background queue to ensure that audit logging does not impact application performance. Events are queued immediately and processed by a dedicated worker.

### Multi-Tenant Support

In multi-tenant deployments, audit logs are isolated by tenant. Each tenant can only view audit logs for their own data.

## Best Practices

1. **Regular Review**: Periodically review audit logs for unusual activity
2. **Export for Compliance**: Export logs regularly for compliance documentation
3. **Monitor Failed Logins**: Watch for patterns of failed login attempts
4. **Track Permission Changes**: Pay attention to permission grant/revoke events
5. **Investigate Bulk Operations**: Review bulk operations for unintended changes

## Troubleshooting

### Audit Logs Not Appearing

If audit logs are not being recorded:

1. Verify that the background worker is running (`pnpm workers`)
2. Check that Valkey/Redis is connected and healthy
3. Review worker logs for any errors

### Missing User Information

If audit logs show missing user information:

1. The action may have been performed by a system process
2. The user session may have expired before the audit was captured
3. Check that the user is properly authenticated
