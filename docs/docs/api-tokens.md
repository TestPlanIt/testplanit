---
sidebar_position: 14
title: API Tokens
---

# API Tokens

API tokens provide a secure way to authenticate programmatic access to the TestPlanIt API. Use API tokens for CLI tools, CI/CD integrations, scripts, and other automated workflows.

## Overview

API tokens offer several advantages over session-based authentication:

- **Persistent access** - Tokens remain valid until revoked or expired
- **Server-to-server integration** - Authenticate without user interaction
- **Scoped access** - Tokens inherit the permissions of the user who created them
- **Audit trail** - Track when and where tokens are used

## Requirements

To use API tokens, a user must have **API Access** enabled on their account. This setting is managed by administrators in the Admin > Users section.

## Creating API Tokens

### From the User Profile

1. Navigate to your **User Profile** page
2. Open the **API Tokens** section
3. Click **Create API Token**
4. Enter a descriptive name for the token (e.g., "CI/CD Pipeline", "Local CLI")
5. Optionally set an expiration date
6. Click **Create**

:::warning Important
The full token is only displayed once upon creation. Copy it immediately and store it securely. TestPlanIt stores only a hashed version of the token and cannot retrieve the original value.
:::

### Token Format

API tokens follow the format:

```text
tpi_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The `tpi_` prefix identifies TestPlanIt API tokens. The first 8 characters after the prefix are stored as a visible identifier to help you recognize tokens in the management interface.

## Using API Tokens

### Bearer Token Authentication

Include the API token in the `Authorization` header of your HTTP requests:

```bash
curl -X GET "https://your-domain.com/api/model/project/findMany" \
  -H "Authorization: Bearer tpi_your_token_here" \
  -H "Content-Type: application/json"
```

### JavaScript/TypeScript Example

```javascript
const response = await fetch('https://your-domain.com/api/model/project/findMany', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer tpi_your_token_here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    where: { isDeleted: false },
    include: { folders: true }
  })
});

const projects = await response.json();
```

### Python Example

```python
import requests

headers = {
    'Authorization': 'Bearer tpi_your_token_here',
    'Content-Type': 'application/json'
}

response = requests.post(
    'https://your-domain.com/api/model/project/findMany',
    headers=headers,
    json={
        'where': {'isDeleted': False},
        'include': {'folders': True}
    }
)

projects = response.json()
```

### JUnit Import with API Token

```bash
curl -X POST "https://your-domain.com/api/junit/import" \
  -H "Authorization: Bearer tpi_your_token_here" \
  -F "name=Automated Test Run" \
  -F "projectId=1" \
  -F "files=@junit-results.xml"
```

## Managing API Tokens

### Viewing Your Tokens

On your User Profile page, the API Tokens section displays:

- **Token name** - The descriptive name you provided
- **Token prefix** - First few characters for identification
- **Created date** - When the token was created
- **Last used** - When the token was last used for authentication
- **Expiration** - When the token will expire (if set)

### Deleting Tokens

To delete a token you no longer need:

1. Go to your User Profile
2. Find the token in the API Tokens section
3. Click the delete button
4. Confirm the deletion

Deleted tokens are immediately invalidated and cannot be used for authentication.

## Administrator Management

Administrators can view and manage all API tokens across the system from **Admin > API Tokens**.

### Admin Capabilities

- **View all tokens** - See tokens created by all users
- **Search and filter** - Find tokens by name or user
- **Revoke tokens** - Disable individual tokens
- **Revoke all tokens** - Emergency action to disable all active tokens
- **View usage** - See when tokens were last used

### Revoking Tokens

Revoked tokens are immediately invalidated. Unlike deleted tokens, revoked tokens remain in the system for audit purposes but cannot be used for authentication.

To revoke a single token:

1. Go to **Admin > API Tokens**
2. Find the token to revoke
3. Click the revoke button
4. Confirm the action

To revoke all active tokens (emergency use):

1. Go to **Admin > API Tokens**
2. Click **Revoke All Tokens**
3. Type "REVOKE ALL" to confirm
4. Click confirm

### Disabling API Access

To prevent a user from using API tokens without deleting their existing tokens:

1. Go to **Admin > Users**
2. Find the user
3. Disable the **API Access** toggle

This immediately invalidates all authentication attempts using that user's tokens while preserving the tokens for potential re-enablement later.

## Security Best Practices

### Token Storage

- **Never commit tokens to version control** - Use environment variables or secrets management
- **Use separate tokens** for different purposes (development, CI/CD, production)
- **Store tokens securely** - Use your platform's secrets manager (GitHub Secrets, AWS Secrets Manager, etc.)

### Token Lifecycle

- **Set expiration dates** for tokens used in temporary workflows
- **Rotate tokens periodically** - Delete old tokens and create new ones
- **Delete unused tokens** - Remove tokens you no longer need
- **Monitor usage** - Review the "last used" timestamps to identify stale tokens

### Environment Variables

Store tokens in environment variables rather than hardcoding them:

```bash
# .env file (never commit this!)
TESTPLANIT_API_TOKEN=tpi_your_token_here
```

```javascript
// Use the environment variable
const token = process.env.TESTPLANIT_API_TOKEN;
```

### CI/CD Integration

Configure tokens as secrets in your CI/CD platform:

**GitHub Actions:**

```yaml
steps:
  - name: Import Test Results
    env:
      TESTPLANIT_TOKEN: ${{ secrets.TESTPLANIT_API_TOKEN }}
    run: |
      curl -X POST "${{ vars.TESTPLANIT_URL }}/api/junit/import" \
        -H "Authorization: Bearer $TESTPLANIT_TOKEN" \
        -F "name=CI Build ${{ github.run_number }}" \
        -F "projectId=1" \
        -F "files=@test-results.xml"
```

**GitLab CI:**

```yaml
import_results:
  script:
    - |
      curl -X POST "$TESTPLANIT_URL/api/junit/import" \
        -H "Authorization: Bearer $TESTPLANIT_API_TOKEN" \
        -F "name=Pipeline $CI_PIPELINE_ID" \
        -F "projectId=1" \
        -F "files=@test-results.xml"
```

## Error Handling

### Authentication Errors

| Error Code | HTTP Status | Description |
|------------|-------------|-------------|
| `NO_TOKEN` | 401 | No Bearer token provided in Authorization header |
| `INVALID_FORMAT` | 401 | Token does not match expected format |
| `INVALID_TOKEN` | 401 | Token not found or incorrect |
| `EXPIRED_TOKEN` | 401 | Token has passed its expiration date |
| `INACTIVE_TOKEN` | 401 | Token has been revoked |
| `INACTIVE_USER` | 401 | User account is inactive or deleted |
| `API_ACCESS_DISABLED` | 401 | User's API access has been disabled |

### Example Error Response

```json
{
  "error": "API token has expired",
  "errorCode": "EXPIRED_TOKEN"
}
```

### Handling Errors in Code

```javascript
const response = await fetch(url, {
  headers: { 'Authorization': `Bearer ${token}` }
});

if (response.status === 401) {
  const error = await response.json();

  switch (error.errorCode) {
    case 'EXPIRED_TOKEN':
      console.error('Token has expired. Please create a new token.');
      break;
    case 'INACTIVE_TOKEN':
      console.error('Token has been revoked.');
      break;
    case 'API_ACCESS_DISABLED':
      console.error('API access is disabled for your account. Contact an administrator.');
      break;
    default:
      console.error('Authentication failed:', error.error);
  }
}
```

## Audit Logging

All API token operations are recorded in the [audit log](/docs/user-guide/audit-logs) for security and compliance:

| Action | Description |
|--------|-------------|
| `API_KEY_CREATED` | Logged when a user creates a new API token |
| `API_KEY_DELETED` | Logged when a user deletes their own token |
| `API_KEY_REVOKED` | Logged when an administrator revokes a token |

Each audit entry includes:

- The token name and prefix (for identification)
- The user who created the token
- The user who performed the action (if different)
- Timestamp and IP address

This provides a complete audit trail for investigating security incidents or reviewing token usage patterns.

## Permissions

API tokens inherit the permissions of the user who created them:

- **Project access** - Token can only access projects the user is assigned to
- **Role-based actions** - Token can only perform actions allowed by the user's role
- **System access level** - Token respects the user's system access level (Admin, User, etc.)

This means:

- A token created by an Admin user has admin-level API access
- A token created by a regular User can only access their assigned projects
- If a user's permissions change, their token's effective permissions change too
