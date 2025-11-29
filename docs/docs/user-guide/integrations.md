---
sidebar_label: 'Issue Integrations'
title: 'Issue Tracking and External Integrations'
---

# Issue Tracking and External Integrations

TestPlanIt provides comprehensive issue tracking capabilities, allowing you to track bugs, tasks, and other issues directly within the platform or integrate with external issue tracking systems like Jira, GitHub Issues, Azure DevOps, and more.

## Internal Issue Management

TestPlanIt includes a built-in issue tracking system that allows you to:

- Create and manage issues directly within your projects
- Link issues to test cases, test runs, and test results
- Track issue status, priority, and assignments
- Add rich text descriptions with formatting support
- Attach files and screenshots
- Tag issues for better organization

### Creating Internal Issues

1. Navigate to your project's **Issues** section
2. Click **Create Issue**
3. Fill in the issue details:
   - **Name**: A brief, descriptive title
   - **Description**: Detailed information using the rich text editor
   - **Status**: Current state of the issue
   - **Priority**: Issue importance level
   - **Tags**: Labels for categorization
4. Link the issue to relevant test artifacts as needed

## External Integration System

TestPlanIt's powerful integration system allows you to connect with external issue tracking platforms for seamless workflow integration. As an administrator, you can configure integrations at the system level and make them available to projects.

## Integration Architecture

### System-Level vs Project-Level

- **System-Level**: Integrations are configured once by administrators
- **Project-Level**: Project managers assign integrations to their projects
- **User-Level**: Individual users may need to authorize OAuth integrations

### Authentication Methods

#### API Key Authentication

- Single set of credentials for all users
- Configured at the system level
- Best for: Small teams, internal tools

#### OAuth 2.0 Authentication

- Each user authorizes individually
- More secure and granular permissions
- Best for: Large teams, cloud services

#### Personal Access Tokens

- Similar to API keys but user-specific
- Common with GitHub and Azure DevOps
- Best for: Developer tools, CI/CD integration

## Supported Integration Types

### 1. **Jira Integration**

Full bi-directional integration with Atlassian Jira, supporting both Cloud and Server/Data Center deployments.

**Features:**

- Create Jira issues directly from TestPlanIt
- Rich text formatting preserved using Atlassian Document Format (ADF)
- Automatic user matching between TestPlanIt and Jira
- Support for custom fields and issue types
- Real-time status synchronization
- Both OAuth 2.0 and API Key authentication

### 2. **GitHub Integration**

Connect to GitHub for issue tracking and repository integration.

**Features:**

- Create GitHub issues from test failures
- Link test cases to GitHub issues
- Track issue status across both platforms
- Personal Access Token authentication

### 3. **Azure DevOps Integration**

Integrate with Azure DevOps for work item tracking.

**Features:**

- Create work items (bugs, tasks, etc.) from TestPlanIt
- Support for Azure DevOps projects
- Personal Access Token authentication
- Custom field mapping

### 4. **Simple URL Integration**

A flexible integration for any issue tracking system that uses URL-based linking.

**Features:**

- Configure a base URL pattern with `{issueId}` placeholder
- Manually link issues by entering issue IDs
- Support for any system with predictable issue URLs
- Minimal configuration required - just a base URL

**How it works:**

- Set a base URL like `https://your-tracker.com/issues/{issueId}`
- When linking issues, enter the issue ID (e.g., "ISSUE-123")
- TestPlanIt replaces `{issueId}` with the actual ID to create the link

## Managing Integrations

### Administrator Setup

1. Navigate to **Administration** → **Integrations**
2. Click **Add Integration**
3. Select your integration type (Jira, GitHub, Azure DevOps, or Simple URL)
4. Fill in the integration details:

```yaml
Name: "Production Jira"
Provider: JIRA
Auth Type: API_KEY or OAUTH2
Status: ACTIVE
```

### Configuration by Provider

#### Jira with API Key

1. Generate API token from [Atlassian Account Settings](https://id.atlassian.com/manage/api-tokens)
2. Configure in TestPlanIt:

```text
Email: your-email@company.com
API Token: Generated from Atlassian account settings
Jira URL: https://your-domain.atlassian.net
```

**Important:** When using API key authentication, the issue reporter will be determined by:

1. Matching TestPlanIt user email with Jira user email
2. If no email match, matching display names
3. If no match found, the API key owner becomes the reporter

#### Jira with OAuth 2.0

1. Create OAuth app in [Atlassian Developer Console](https://developer.atlassian.com/console)
2. Set redirect URL: `https://your-testplanit-domain/api/auth/jira/callback`
3. Configure in TestPlanIt:

```text
Client ID: [from-atlassian]
Client Secret: [from-atlassian]
```

Benefits:

- Provides user-specific authentication
- Each user authorizes their own Jira access
- Issues created with the actual user as reporter

#### GitHub

1. Create Personal Access Token in GitHub Settings
2. Required scopes:
   - `repo` - Full repository access
   - `write:issues` - Create and update issues
3. Configure in TestPlanIt:

```text
Personal Access Token: Generated from GitHub settings
```

#### Azure DevOps

1. Generate PAT in Azure DevOps User Settings
2. Required scopes:
   - Work Items (Read & Write)
   - Project and Team (Read)
3. Configure in TestPlanIt:

```text
Personal Access Token: Generated from Azure DevOps
Organization URL: https://dev.azure.com/your-org
```

#### Simple URL

```text
Base URL: https://your-tracker.com/issues/{issueId}
API Key: Optional, only if your system requires authentication
```

The `{issueId}` placeholder will be replaced with the actual issue ID when creating links.

### Editing Integrations

1. Click the **Edit** button next to an integration
2. Update configuration as needed
3. **Note**: Changing authentication type may require users to re-authorize

### Deleting Integrations

**Warning**: Deleting an integration will:

- Remove it from all projects
- Unlink all associated issues
- Delete user authorization tokens

To delete:

1. Ensure no active projects are using the integration
2. Click **Delete** and confirm
3. Linked issues remain in the database but become unlinked

## Project Configuration

After creating an integration, assign it to projects:

1. Go to **Project Settings** → **Integrations**
2. Select the integration from available options
3. Choose the external project to link
4. Configure project-specific settings:
   - External project mapping
   - Default issue type (for Jira)
   - Field mappings
5. Save settings

### Multiple Integrations

Projects can have multiple integrations:

- One primary integration for issue creation
- Additional integrations for cross-referencing
- Different integrations for different teams

## User Authorization (OAuth)

### Initial Authorization

For OAuth integrations, users must:

1. Go to **Project** → **Integrations**
2. Click **Authorize**
3. Log in to the external service
4. Grant permissions to TestPlanIt
5. Return to TestPlanIt automatically

### Token Refresh

OAuth tokens are automatically refreshed when:

- Token is near expiration (< 5 minutes)
- API call fails with 401 error
- User manually re-authorizes

## Creating External Issues

### From Test Results

1. After a test failure, click the **Create Issue** button
2. Choose between internal issue or external integration
3. For external issues:
   - The form dynamically loads fields from the external system
   - Required fields are marked with asterisks
   - Rich text descriptions are automatically converted to the target format
4. Submit to create the issue in the external system

### From Test Cases

1. Open a test case
2. Click **Link Issue** or **Create Issue**
3. Select the integration
4. Fill in issue details
5. The issue will be linked to the test case

### Bulk Issue Creation

1. Select multiple failed tests
2. Click **Create Issues**
3. Choose to create separate issues or one combined issue
4. Issues are created with links back to TestPlanIt

## Issue Linking and Synchronization

### Automatic Linking

When creating issues from TestPlanIt:

- Issues are automatically linked to the source artifact (test case, test run, etc.)
- Links are bidirectional when supported by the integration
- Issue status updates can trigger test status changes

### Manual Linking

1. Open any test artifact
2. Click **Link Existing Issue**
3. Search for the issue by:
   - Issue key (e.g., PROJ-123)
   - Issue title
   - Description content
4. Select and link the issue

### Status Synchronization

When enabled, TestPlanIt can:

- Update test status when linked issues are resolved
- Create follow-up issues for recurring failures
- Track issue resolution time for metrics

## Field Mapping and Transformation

### Dynamic Field Discovery

TestPlanIt automatically discovers fields from external systems:

```javascript
// Jira field discovery
GET /rest/api/3/issue/createmeta
  ?projectKeys={projectKey}
  &issuetypeIds={issueTypeId}
  &expand=projects.issuetypes.fields
```

### Custom Field Support

Supported custom field types:

- Text fields (single/multi-line)
- Select lists (single/multi)
- User pickers
- Date/time fields
- Number fields
- Checkboxes
- Labels

### Rich Text and Formatting

TestPlanIt preserves rich text formatting when creating external issues:

**Supported Formatting:**

- **Bold** and *italic* text
- Bulleted and numbered lists
- Headers and subheaders
- Code blocks and inline code
- Tables (when supported by target system)
- Links and mentions

**Format Conversion:**

TestPlanIt automatically converts between:

- TipTap Editor JSON → Atlassian Document Format (Jira)
- TipTap Editor JSON → Markdown (GitHub)
- TipTap Editor JSON → HTML (Azure DevOps)
- User references → Account IDs
- Dates → ISO 8601 format
- Files → Attachments (when supported)

## User Management and Permissions

### User Matching

For API key integrations, TestPlanIt attempts to match users between systems:

1. **Email Matching**: Primary method using email addresses
2. **Name Matching**: Falls back to display name comparison
3. **API Key Owner**: Uses integration owner as last resort

### OAuth Benefits

OAuth integrations provide:

- Individual user authentication
- Accurate reporter/assignee attribution
- User-specific permissions
- No shared credentials

### Permission Model

```yaml
System Admin:
  - Create/edit/delete integrations
  - View all authorizations
  - Access audit logs

Project Admin:
  - Assign integrations to projects
  - Configure project mappings
  - View project authorizations

Users:
  - Authorize own OAuth access
  - Create issues via integrations
  - View linked issues
```

## Monitoring and Maintenance

### Health Checks

Regular health checks verify:

- Authentication validity
- API endpoint availability
- Rate limit status
- Token expiration

### Audit Logging

All integration actions are logged:

```typescript
{
  action: "ISSUE_CREATED",
  integration: "jira-prod",
  user: "user@company.com",
  issueKey: "PROJ-123",
  timestamp: "2024-01-15T10:30:00Z"
}
```

### Rate Limiting

Respect external API limits:

- Jira: 50 requests/second
- GitHub: 5,000 requests/hour
- Azure DevOps: No hard limit

## Security Considerations

### Credential Storage

- Credentials are encrypted at rest using AES-256
- OAuth tokens stored per user
- API keys stored at integration level
- No credentials in logs or error messages

## Troubleshooting

### Connection Issues

```bash
# Test Jira connection
curl -u email@company.com:api_token \
  https://company.atlassian.net/rest/api/3/myself

# Test GitHub connection
curl -H "Authorization: token YOUR_PAT" \
  https://api.github.com/user

# Test Azure DevOps connection
curl -u :YOUR_PAT \
  https://dev.azure.com/your-org/_apis/projects
```

### Common Issues

**Issue: Created issues show wrong reporter**

- Ensure TestPlanIt and external system users have matching emails
- Consider using OAuth instead of API keys
- Check user permissions in the external system

**Issue: Rich text formatting lost**

- Verify the integration supports rich text
- Check that the description field accepts formatted content
- Update to the latest TestPlanIt version

**Issue: Cannot see external project**

- Verify integration credentials are valid
- Check project permissions in external system
- Ensure the project is not archived

**Users can't see integration:**

- Check project assignment
- Verify user project membership
- Confirm integration is active

**Fields not loading:**

- Verify project/issue type selection
- Check API permissions
- Clear browser cache

### Integration Testing

1. Use **Test Connection** to verify credentials
2. Create a test issue to confirm field mapping
3. Check that status synchronization works
4. Verify user attribution is correct

## Migration Guide

### Migrating from Simple URL to Full Integration

1. Export existing issue links
2. Create new integration
3. Map issue IDs to external keys
4. Update links in database
5. Remove old configuration

### Switching Authentication Methods

1. Create new integration with desired auth
2. Have users authorize (if OAuth)
3. Update project assignments
4. Migrate existing issues
5. Deactivate old integration

## Best Practices

1. **Use OAuth when available** for better security and user attribution
2. **Standardize naming** between TestPlanIt and external systems
3. **Configure field mappings** to capture all relevant data
4. **Enable status sync** for automated workflow
5. **Regular credential rotation** for API key integrations (every 90 days minimum)
6. **Document custom fields** used in integrations
7. **Test integrations** in a sandbox environment first
8. **Limit scope** - Request minimum permissions needed
9. **Monitor usage** - Check audit logs for anomalies

## Appendix

### Jira Cloud vs Server Differences

| Feature | Cloud | Server/DC |
|---------|-------|-----------|
| Authentication | OAuth 2.0, API Key | Basic Auth, PAT |
| API Version | v3 | v2/v3 |
| User IDs | accountId | username |
| Webhooks | Yes | Yes (different format) |

### Required Permissions by Provider

**Jira:**

- Browse Projects
- Create Issues
- Edit Issues (optional)
- Add Comments

**GitHub:**

- Read repository metadata
- Write issues
- Read user info

**Azure DevOps:**

- View project-level information
- View work items
- Create/update work items

## API Reference

For programmatic access to issue and integration features, see the [API Documentation](/docs/api-reference/#issues).

### Key Endpoints

**Issues:**

- `POST /api/issues/create` - Create internal issue
- `GET /api/issues/{issueId}` - Get issue details
- `POST /api/issues/{issueId}/link` - Link issue to entity
- `POST /api/issues/{issueId}/unlink` - Unlink issue from entity

**Integrations:**

- `POST /api/integrations/{id}/create-issue` - Create external issue
- `GET /api/integrations/{id}/search` - Search external issues
- `POST /api/integrations/{id}/link-issue` - Link existing issue
- `GET /api/integrations/{id}/issue-types` - Get available issue types
- `GET /api/integrations/{id}/fields` - Get field definitions
- `POST /api/integrations/test-connection` - Test integration connection

**Project Integrations:**

- `GET /api/projects/{projectId}/integrations` - Get project integrations
- `POST /api/projects/{projectId}/integrations` - Assign integration to project
- `PUT /api/projects/{projectId}/integrations/{id}` - Update project integration settings
- `DELETE /api/projects/{projectId}/integrations/{id}` - Remove integration from project
