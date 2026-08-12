---
sidebar_label: 'Issue Integrations'
title: 'Issue Tracking and External Integrations'
---

# Issue Tracking and External Integrations

TestPlanIt provides comprehensive issue tracking capabilities, allowing you to track bugs, tasks, and other issues directly within the platform or integrate with external issue tracking systems like Jira, GitHub Issues, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, MantisBT, and more.

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
- Used by GitHub, GitLab, Gitea/Forgejo/Gogs, and Azure DevOps
- Best for: Developer tools, CI/CD integration

## Supported Integration Types

### 1. **Jira Integration**

Full bi-directional integration with Atlassian Jira, supporting both Cloud and Server/Data Center deployments.

**Features:**

- Create Jira issues directly from TestPlanIt
- Rich text formatting preserved using Atlassian Document Format (ADF)
- Images and videos embedded in the issue description are uploaded to the created Jira issue as attachments
- Automatic user matching between TestPlanIt and Jira
- Support for custom fields and issue types
- Real-time status synchronization
- Both OAuth 2.0 and API Key authentication

### 2. **GitHub Integration**

Connect to GitHub for issue tracking and repository integration.

**Features:**

- Create GitHub issues from test failures
- Link test cases to GitHub issues
- Search issues by text or by exact number format (e.g., `#42`)
- Track issue status across both platforms
- Personal Access Token or OAuth 2.0 authentication (OAuth attributes issues to the individual user)
- Inbound webhook support for real-time status sync
- Works with both github.com and **GitHub Enterprise Server** — set the integration's optional **API Base URL** to your GHES API root (typically `https://<your-host>/api/v3`) to point the adapter, scope probes, and repository sync at your enterprise instance instead of github.com

### 3. **GitLab Integration**

Connect to GitLab for issue tracking across GitLab.com and self-managed GitLab instances.

**Features:**

- Create GitLab issues directly from TestPlanIt
- Support for issue types: Issue and Incident
- Search issues by text or by exact key format (e.g., `group/project#42`)
- Track issue status across both platforms
- Personal Access Token or OAuth 2.0 authentication (OAuth attributes issues to the individual user)
- Works with both GitLab.com and self-managed instances

### 4. **Gitea / Forgejo / Gogs Integration**

Connect to self-hosted Gitea, Forgejo, or Gogs instances for lightweight issue tracking.

**Features:**

- Create issues in any repository on your instance
- Search issues by text or by exact key format (e.g., `owner/repo#7`)
- Personal Access Token authentication, or OAuth 2.0 on Gitea/Forgejo (OAuth attributes issues to the individual user)
- Configurable instance URL — works with any self-hosted deployment

### 5. **Azure DevOps Integration**

Connect to Azure DevOps Boards for work item tracking.

**Features:**

- Create work items (bugs, tasks, user stories) from TestPlanIt
- Support for all work item types defined in your Azure DevOps process
- Search work items by text or by exact ID (e.g., `42`)
- Priority field supported (maps to work item priority)
- Images and videos embedded in the description are uploaded to the created work item as attachments
- Personal Access Token authentication
- Inbound webhook support for real-time status sync
- Works with both Azure DevOps Services (cloud) and Azure DevOps Server (on-premises)

### 6. **Redmine Integration**

Connect to a self-hosted Redmine instance for issue tracking.

**Features:**

- Create Redmine issues directly from TestPlanIt, choosing the tracker and priority
- Search issues by text (subject) or by exact reference (e.g., `#42`)
- Maps Redmine **trackers** to issue types; statuses and priorities are discovered from your instance
- Custom field and linked-issue (relations) support
- API key authentication (Redmine has no OAuth)
- Inbound webhook support for status sync via the `redmine_webhook` plugin
- Configurable instance URL — works with any self-hosted Redmine deployment

### 7. **MantisBT Integration**

Connect to a self-hosted MantisBT instance for issue tracking.

**Features:**

- Create MantisBT issues directly from TestPlanIt, choosing the category and priority
- Search issues by text (summary) or by exact reference (e.g., `#42`)
- Maps MantisBT **categories** to issue types; statuses and priorities are discovered from your instance
- Linked-issue (relationships) support
- API token authentication (MantisBT has no OAuth)
- Inbound webhook support for status sync via a MantisBT webhook plugin
- Configurable instance URL — works with any self-hosted MantisBT deployment

### 8. **Simple URL Integration**

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
3. Select your integration type (Jira, GitHub, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, MantisBT, or Simple URL)
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

:::warning Reporter attribution requires Jira admin permissions

Setting the **reporter** on a created issue calls Jira's `reporter` field, which is only honored when the API token account holds the Jira administrator (**Modify Reporter**) permission. Most accounts with create-issue access do **not** have this permission.

When the account lacks it, Jira silently ignores the supplied reporter and records the **API token owner** as the creator — **even when the TestPlanIt user's email matches a Jira user's email.** This is the most common cause of "all issues are created by the same user" reports.

To get accurate per-user reporter attribution, either grant the API token account the Modify Reporter permission, or use [OAuth 2.0](#jira-with-oauth-20) instead.

:::

When using API key authentication, and assuming the account has the required permission, the issue reporter is determined by:

1. Matching TestPlanIt user email with Jira user email
2. If no email match, matching display names
3. If no match found (or the account lacks the Modify Reporter permission), the API token owner becomes the reporter

#### Jira Server / Data Center

The same **API Key** integration supports self-hosted Jira Server and Data Center instances. TestPlanIt auto-detects the deployment by probing `{jira-url}/rest/api/2/serverInfo` and switches to **REST API v2** (`/rest/api/2/...`) — Jira Server / Data Center does **not** ship the Cloud-only REST API v3, so the integration must use v2.

Two credential shapes are supported (pick one):

- **Personal Access Token (recommended)** — generate a PAT in Jira → *Personal Access Tokens*. Leave **Email** blank and paste the token in **API Token**. TestPlanIt sends it as `Authorization: Bearer <token>`.

  ```text
  API Token: <your-jira-data-center-pat>
  Jira URL: https://jira.mycompany.domain
  ```

- **Username + password (Basic)** — leave **Email** and **API Token** blank and fill in the **Username** and **Password** fields instead. TestPlanIt sends `Authorization: Basic <base64(username:password)>`.

  ```text
  Username: your-username
  Password: your-password
  Jira URL: https://jira.mycompany.domain
  ```

Reporter attribution on Server / Data Center matches users by `name`/`key` (Cloud matches by `accountId`); the same Modify Reporter permission rule above applies.

Rich text in issue descriptions and comments is sent as [Jira Wiki Markup](https://jira.atlassian.com/secure/WikiRendererHelpAction.jspa?section=all) (Server / Data Center's native format) and read back using Jira's own rendering, so formatting — bold, headings, lists, links, code — is preserved. This assumes the Description and Comment fields use the default **Wiki Style Renderer**. If your administrator has switched a field to the **Default Text Renderer** (Administration → Issues → Field Configurations → Renderers), formatting will appear as literal markup there; switch it back to the Wiki Style Renderer to restore rich text.

If auto-detection ever picks the wrong deployment, force it by adding `deploymentType: "server"` (or `"cloud"`) and optionally `authScheme: "bearer"` (or `"basic"`) to the integration's settings.

#### Jira with OAuth 2.0

OAuth 2.0 is Atlassian's preferred authentication path for **Jira Cloud** and is recommended for any team where per-user reporter attribution and granular scoping matter. Each user authorizes individually and issues are created as that user.

:::note OAuth 2.0 is Cloud-only

The Atlassian 3LO OAuth flow used here routes through the `api.atlassian.com` gateway and is not available on Jira Server / Data Center. Self-hosted instances should use [API Key](#jira-server--data-center) (PAT or Basic) instead.

:::

1. Create an OAuth 2.0 (3LO) integration in the [Atlassian Developer Console](https://developer.atlassian.com/console).
2. Under **Permissions**, add scopes from **two** separate APIs — TestPlanIt calls both the Jira platform REST API and the Jira Software (Agile) REST API, and Atlassian governs them independently:

   | Console permission    | Tab                 | Scopes                                                        | Needed for                                                     |
   | --------------------- | ------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
   | **Jira API**          | **Classic scopes**  | `read:jira-work`, `write:jira-work`, `read:jira-user`          | Issues, search, comments, and Fix Version (release) milestones |
   | **Jira API**          | **Granular scopes** | `read:project:jira`                                            | Board discovery for sprint import                              |
   | **Jira Software API** | **Granular scopes** | `read:board-scope:jira-software`, `read:sprint:jira-software`  | Sprint (iteration) milestones and sprint webhook routing       |

   Note that `read:project:jira` sits on the **Jira API** permission alongside the classic scopes, not with the Jira Software ones — mixing classic and granular scopes on the same permission is expected here. TestPlanIt also requests `offline_access` during authorization so it can refresh tokens; you don't add that one in the console.

   :::caution Sprint import fails without the Jira Software scopes

   Atlassian does not accept classic scopes for the Jira Software REST API, so `read:jira-work` alone never authorizes `/rest/agile/1.0/`. If the three granular scopes are missing, [milestone import](./projects/milestones.md#import-from-jira) fails with:

   ```text
   <PROJECT>: HTTP 401: {"code":401,"message":"Unauthorized; scope does not match"}
   ```

   The failure looks selective — Fix Versions keep working because they come from the platform API, while sprints do not. If the app is missing a scope entirely, authorization stops earlier with a message naming the scope to add.

   :::

3. Under **Authorization**, set the **Callback URL** to:

   ```text
   <your-testplanit-url>/api/integrations/oauth/jira/callback
   ```

   TestPlanIt shows this exact URL (with a copy button) in the integration dialog when you choose OAuth 2.0, so you don't have to construct it by hand.
4. In TestPlanIt, add a Jira integration, choose **OAuth 2.0**, and enter the **Client ID** and **Client Secret** from the app, plus your Jira site URL (e.g. `https://your-domain.atlassian.net`).
5. Finish the shared steps in [Completing the OAuth setup](#completing-the-oauth-setup-all-providers) — the integration must be authorized, activated, assigned to a project, and have a linked project before issues can be created.

#### GitHub with Personal Access Token

1. Create Personal Access Token in GitHub Settings
2. Required scopes:
   - `repo` - Full repository access
   - `write:issues` - Create and update issues
3. Configure in TestPlanIt:

```text
Personal Access Token: Generated from GitHub settings
```

**Note:** With Personal Access Token authentication, issues are always created as the account that owns the token, regardless of which TestPlanIt user created them — the GitHub API does not allow setting the issue author on another user's behalf. For per-user attribution, use OAuth 2.0 below.

#### GitHub with OAuth 2.0

OAuth 2.0 gives **per-user attribution**: each user authorizes individually and issues are created as that user. Works with github.com and GitHub Enterprise Server.

1. In GitHub, create an OAuth App under **Settings → Developer settings → OAuth Apps** (for an org, **Organization settings → Developer settings**).
2. Set the **Authorization callback URL** to:

   ```text
   <your-testplanit-url>/api/integrations/oauth/github/callback
   ```

3. In TestPlanIt, add a GitHub integration, choose **OAuth 2.0**, and enter the **Client ID** and **Client Secret** from the OAuth App. For GitHub Enterprise Server, also set the optional API Base URL to your GHES API root. TestPlanIt requests the `repo` and `read:user` scopes.
4. Finish the shared steps in [Completing the OAuth setup](#completing-the-oauth-setup-all-providers) — the integration must be activated, assigned to a project, and have a linked repository before issues can be created.

#### GitLab with Personal Access Token

1. Generate a Personal Access Token in **GitLab** → **User Settings** → **Access Tokens**
2. Required scopes:
   - `api` — Full API access (create/update issues)
   - `read_user` — Read user information for auth verification
3. Configure in TestPlanIt:

```text
Personal Access Token: Generated from GitLab settings
GitLab URL: https://gitlab.com (or your self-managed instance URL)
```

**Notes:**

- Leave GitLab URL blank to default to `https://gitlab.com`
- For self-managed instances, enter the full base URL (e.g., `https://gitlab.yourcompany.com`)
- The **Issue Type** field supports `Issue` and `Incident` types
- Priority is not a native GitLab concept and is not shown in the Create Issue form
- With Personal Access Token authentication, issues are always created as the account that owns the token, regardless of which TestPlanIt user created them. For per-user attribution, use OAuth 2.0 below.

#### GitLab with OAuth 2.0

OAuth 2.0 gives **per-user attribution**: each user authorizes individually and issues are created as that user. Works with GitLab.com and self-managed instances.

1. In GitLab, create an OAuth application under **User Settings → Applications** (or **Admin → Applications** for an instance-wide app).
2. Set the **Redirect URI** to:

   ```text
   <your-testplanit-url>/api/integrations/oauth/gitlab/callback
   ```

3. Select the `api` scope.
4. In TestPlanIt, add a GitLab integration, choose **OAuth 2.0**, and enter the **Client ID** (Application ID) and **Client Secret**, plus the instance URL for self-managed deployments.
5. Finish the shared steps in [Completing the OAuth setup](#completing-the-oauth-setup-all-providers) — the integration must be activated, assigned to a project, and have a linked project before issues can be created.

#### Gitea / Forgejo / Gogs with Personal Access Token

1. Generate a Personal Access Token in your instance's **Settings** → **Applications**
2. No specific scopes required — the token inherits your user's repository permissions
3. Configure in TestPlanIt:

```text
Personal Access Token: Generated from your Gitea/Forgejo/Gogs settings
Instance URL: https://your-gitea-instance.com
```

**Note:** The instance URL is required for Gitea/Forgejo/Gogs. TestPlanIt uses it to
construct all API calls to your self-hosted instance.

With Personal Access Token authentication, issues are always created as the account that owns the token, regardless of which TestPlanIt user created them. For per-user attribution, use OAuth 2.0 below.

#### Gitea / Forgejo with OAuth 2.0

OAuth 2.0 gives **per-user attribution**: each user authorizes individually and issues are created as that user. Supported on Gitea and Forgejo (Gogs has limited OAuth support — use a Personal Access Token there).

1. In Gitea/Forgejo, create an OAuth2 application under **Settings → Applications** (or **Site Administration → Applications** for an instance-wide app).
2. Set the **Redirect URI** to:

   ```text
   <your-testplanit-url>/api/integrations/oauth/gitea/callback
   ```

3. In TestPlanIt, add a Gitea integration, choose **OAuth 2.0**, and enter the **Client ID** and **Client Secret** along with the instance URL.
4. Finish the shared steps in [Completing the OAuth setup](#completing-the-oauth-setup-all-providers) — the integration must be activated, assigned to a project, and have a linked repository before issues can be created.

#### Completing the OAuth setup (all providers)

Creating the OAuth app and entering the Client ID/Secret is only half the setup. Issue creation stays blocked until an administrator (or project manager) finishes these steps **in order**:

1. **Activate the integration by authorizing it.** A new OAuth 2.0 integration shows **Awaiting authorization** — this is expected, not an error. (Running **Test Connection** only confirms the Client ID/Secret are well-formed; OAuth has no client-credentials grant, so it cannot mark the integration Active on its own.) In **Administration → Issue Integrations**, click **Authorize** on the integration row, and grant access on the provider's consent screen. This connects your account and flips the integration to **Active**. An integration that is not yet Active does not appear when assigning to a project.
2. **Assign it to a project.** In **Project Settings → Issue Integrations**, click **Assign** on the integration.
3. **Link an external project (repository).** In the integration's settings panel, use **Linked External Projects → Add Projects**, select the target repository (e.g. `owner/repo`), click **Add Selected**, then **Save Settings**. This step is required — without a linked external project the Create Issue dialog reports **"Integration Not Configured"** and the **Create** button stays disabled.
4. **Authorize the remaining users — once per user.** Authorization is per-user, so each *additional* person who will create issues opens **Project → Integrations**, clicks **Authorize**, and grants access on the provider's consent screen. (The admin who activated the integration in step 1 is already authorized.) Every issue is then attributed to the individual who created it.

#### Azure DevOps

1. Generate a Personal Access Token in **Azure DevOps** → **User Settings** → **Personal Access Tokens**
2. Required scopes:
   - `Work Items (Read & Write)` — Create and update work items
   - `Project and Team (Read)` — Read project and team information
3. Configure in TestPlanIt:

```text
Personal Access Token: Generated from Azure DevOps settings
Organization URL: https://dev.azure.com/your-organization
```

**Notes:**

- The Organization URL is required (e.g., `https://dev.azure.com/myorg` or `https://myserver/tfs/DefaultCollection` for on-premises)
- Work item types are discovered dynamically from your Azure DevOps process template
- Priority values (1–4) map directly to Azure DevOps priority field values
- Work items are always created as the account that owns the personal access token, regardless of which TestPlanIt user created them — Azure DevOps populates `System.CreatedBy` from the authenticating identity and does not allow setting it on another user's behalf

#### Redmine

1. Enable the REST API in Redmine: **Administration → Settings → API → Enable REST web service**
2. Copy your API key from **My account → API access key**
3. Configure in TestPlanIt:

```text
Redmine API Key: Your API access key
Redmine URL: https://your-redmine-instance.com
```

**Notes:**

- The Redmine URL is required — TestPlanIt uses it for all API calls.
- The API key inherits the permissions of the user it belongs to. Use a dedicated **service account** for shared integrations so issue creation and reads are not tied to one person's account.
- Redmine **trackers** (Bug, Feature, Support, …) are used as the issue type; statuses and priorities are read from your instance. Custom fields are supported.
- Redmine has no OAuth — issues are always created as the account that owns the API key.
- The linked Redmine project must have **trackers enabled** and the **Issue tracking** module active, or issue creation will fail with a "Tracker cannot be blank" error.

#### MantisBT

1. Create an API token in MantisBT under **My Account → API Tokens**
2. Copy the generated token (it is shown only once)
3. Configure in TestPlanIt:

```text
MantisBT API Token: Your API token
MantisBT URL: https://your-mantisbt-instance.com
```

**Notes:**

- The MantisBT URL is required — TestPlanIt appends `/api/rest` to it for all API calls.
- The API token inherits the permissions of the user it belongs to. Use a dedicated **service account** for shared integrations so issue creation and reads are not tied to one person's account.
- MantisBT **categories** are used as the issue type; statuses and priorities are read from your instance.
- MantisBT has no OAuth — issues are always created as the account that owns the API token.
- The linked MantisBT project must have at least one **category** defined, since MantisBT requires a category on every new issue.

#### Simple URL

```text
Base URL: https://your-tracker.com/issues/{issueId}
```

The `{issueId}` placeholder will be replaced with the actual issue ID when creating links.

**Note:** Simple URL integrations do not authenticate against an external API — they only build link-out URLs. As a result:

- No API Key or authentication credentials are required
- The **Test Connection** action is not available
- **Sync** is not supported (issues are entered manually and do not pull data from the external system)

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

### Re-syncing Linked Issues

Each integration row exposes a **Re-sync linked issues** action (the refresh icon). It queues a background job that refreshes every issue **already linked into TestPlanIt** for that integration — pulling the latest status, priority, title, and description from the external tracker. A toast confirms the job was queued; the Issues table updates automatically when it finishes.

:::info
This action **re-syncs issues that already exist in TestPlanIt — it does not import new issues from the external tracker.** Issues enter TestPlanIt when you link them (see [Manual Linking](#manual-linking)), when an [inbound webhook](#real-time-updates-via-inbound-webhooks) references them for the first time, or when a project administrator runs a [bulk import](projects/settings/integrations.md#importing-issues-in-bulk) of a linked external project; a re-sync only refreshes that existing set. The action is unavailable for **Simple URL** integrations, which have no upstream API to pull from.
:::

## Project Configuration

After creating an integration, assign it to projects:

1. Go to **Project Settings** → **Issue Integrations**
2. Click **Assign** on the integration you want to use
3. The integration settings panel appears below

### Linking External Projects

**Linking at least one external project is required before you can create issues** through an integration — until you do, the Create Issue dialog reports "Integration Not Configured". A single TestPlanIt project can also connect to **multiple external projects** through one integration. For example, one Jira integration can link to three different Jira projects (e.g., a bug tracking project, a feature project, and an ops project).

**To link external projects:**

1. In the integration settings, find the **Linked External Projects** card
2. Click **Add Projects**
3. Search and select one or more external projects from the dropdown
4. Click **Add Selected**
5. The first linked project automatically becomes the **default** (shown with a filled star)

**Managing linked projects:**

- **Set as default**: Hover over a non-default project's star icon and click to make it the default. The default project is pre-selected when creating new issues.
- **Per-project default issue type** (Jira): Each linked project can have its own default issue type. Set it using the inline **Default Issue Type** selector on each project row.
- **Remove a project**: Click the trash icon, then confirm. Removing a project stops syncing issues from it but does not delete previously synced issues. Removed projects can be re-added later.

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

### Token Refresh and Re-authorization

When an OAuth access token is expired — or within a few minutes of expiring — TestPlanIt refreshes it automatically the next time the integration is used, including from background issue and milestone syncs, as long as a refresh token is on record (Jira, GitLab, and Gitea/Forgejo issue these; GitHub OAuth App tokens do not expire). The refreshed token is saved transparently, so users normally never notice expiration.

Re-authorization is only required when there is no usable refresh token — for example, the refresh token was revoked, expired from inactivity, or the OAuth app was not granted offline access. When that happens, the connection's owner receives a notification (bell and, depending on their notification preferences, email) with a **Reconnect** link that starts the consent flow directly. They can also re-authorize from anywhere the connection is used:

- When creating an issue, the dialog shows an **Authenticate** button that opens the consent window in place.
- At any time, a user can re-authorize from **Project → Integrations** using the **Authorize** button.
- An administrator can re-authorize their own connection from **Admin → Integrations**, by editing the integration and using the **Reauthorize** button. This replaces the existing token in place — there is no need to delete and re-add the integration.

Each user authorizes and refreshes independently, so re-authorizing only affects the user who does it.

:::caution Adding scopes requires everyone to re-authorize

Providers bind the granted scope set to the connection at consent time and carry it unchanged through every refresh. So when an OAuth app gains new scopes — for example, adding the [Jira Software scopes](#jira-with-oauth-20) for sprint import — existing connections keep their old, narrower permissions indefinitely. Refreshing does not widen them. Revoking the app in the provider's account settings invalidates the stored refresh token, so the next time TestPlanIt uses the connection the owner is notified to reconnect — but until each user re-authorizes, their connection keeps its old scope set.

Every user who has authorized the integration must re-authorize before the new scopes take effect for them. This matters even for features that aren't user-specific: milestone import borrows whichever authorized token was refreshed most recently, so a single teammate still holding an old-scope token can make the import fail again after it appeared to be fixed.

:::

## Creating External Issues

### From Test Results

1. After a test failure, click the **Create Issue** button
2. Choose between internal issue or external integration
3. For external issues:
   - If multiple external projects are linked, select the target project from the **External Project** dropdown (the default project is pre-selected)
   - The default issue type for the selected project is automatically applied
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
3. Search for the issue — when multiple external projects are linked, the search automatically fans out across all projects and merges results into one list
4. Each result shows a **project-key badge** (e.g., PROJ, WEB) so you can see which project it came from
5. Use the **filter chips** below the search bar to narrow results to a specific project
6. Select and link the issue

### Simple URL Integrations

For projects using a Simple URL integration, the Add/Link flow is slightly different since there is no external API to search:

1. Open the test case in edit mode and click **Link Issue**
2. A Search Issues dialog opens — use the combobox to find an existing issue (previously added under this integration)
3. If the issue has not been added yet, click **+ Create New Issue** to open the Add Issue dialog and enter the issue ID and name manually
4. TestPlanIt constructs the external link at render time from the integration's current Base URL template (with `{issueId}` replaced). The URL is not stored on the issue, so updating the Base URL on the integration instantly updates every linked issue's link.

### Status Synchronization

When enabled, TestPlanIt can:

- Update test status when linked issues are resolved
- Create follow-up issues for recurring failures
- Track issue resolution time for metrics

### Real-time updates via inbound webhooks

For Jira, GitHub, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, and MantisBT integrations, TestPlanIt can also subscribe to events emitted by the external tracker so issue changes appear in TestPlanIt without waiting for a manual refresh. When an inbound webhook is configured for a project:

- Status, assignee, and other supported fields on linked issues update within seconds of the change in the external tracker.
- New issues filed directly in the external tracker are imported into TestPlanIt's Issues list automatically the first time they are referenced by a webhook event.
- Open browser tabs reflect the change in near-real time through a project-scoped event stream — no page reload required.

Inbound webhooks are configured per project from **Project Settings** → **Webhooks**. They are 1:1 with the project's active issue integration: switching the integration to a different provider (or removing it) automatically removes the inbound webhook so it cannot drift out of sync. See [Webhooks](./webhooks.md) for setup, secret rotation, health monitoring, delivery replay, and security details.

## Field Mapping and Transformation

### Dynamic Field Discovery

TestPlanIt automatically discovers fields from external systems. The level of dynamic
field support varies by provider:

- **Jira**: Full dynamic discovery — issue types, required fields, and custom fields
  are fetched per-project and per-issue-type from the create metadata API
- **Azure DevOps**: Work item types are discovered per-project; fields are fixed per type
- **GitHub / GitLab / Gitea**: Fixed field set (title, description, labels); no custom fields
- **Redmine**: Trackers are discovered as issue types; statuses, priorities, and custom fields are read from the instance
- **MantisBT**: Categories are discovered as issue types; statuses and priorities are read from the instance

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
- TipTap Editor JSON → Markdown (GitHub, GitLab, Gitea/Forgejo/Gogs, Redmine, MantisBT)
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

For Jira specifically, applying the matched user as the reporter requires the API token account to hold the Jira administrator (**Modify Reporter**) permission. Without it, the reporter falls back to the API key owner regardless of any email or name match. See [Jira with API Key](#jira-with-api-key).

### OAuth Benefits

OAuth integrations (available for Jira, GitHub, GitLab, and Gitea/Forgejo) provide:

- Individual user authentication — each user authorizes their own access
- Accurate reporter/author attribution — issues are created as the actual TestPlanIt user, not a shared service account
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

Integration and project-integration records are tracked in the [audit log](/docs/user-guide/audit-logs) via the standard CRUD actions:

| Action | Description |
| -------- | ------------- |
| `CREATE` | A new integration or project-integration mapping was created |
| `UPDATE` | An integration was reconfigured (settings, credentials, endpoint changes) |
| `DELETE` | An integration or project-integration mapping was removed |

Admin-triggered operations on integrations (e.g., sync jobs from the admin integrations panel) emit `SYSTEM_CONFIG_CHANGED` events with the target integration and action captured in the metadata.

Stored credentials, OAuth tokens, and API keys are redacted from audit payloads — the audit system masks known sensitive fields (`credentials`, `token`, `apiKey`, etc.) before the row is written.

### Rate Limiting

Respect external API limits:

- Jira: 50 requests/second
- GitHub: 5,000 requests/hour (authenticated)
- GitLab: 600 requests/minute (GitLab.com); self-managed instances vary
- Gitea / Forgejo / Gogs: Configured per-instance (no default limit)
- Azure DevOps: No published hard limit
- Redmine: Configured per-instance (no default limit)
- MantisBT: Configured per-instance (no default limit)

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

# Jira Server / Data Center (REST API v2). PAT as Bearer:
curl -H "Authorization: Bearer YOUR_PAT" \
  https://jira.mycompany.domain/rest/api/2/myself

# Test GitHub connection
curl -H "Authorization: token YOUR_PAT" \
  https://api.github.com/user

```

```bash
# Test GitLab connection
curl -H "PRIVATE-TOKEN: YOUR_PAT" \
  https://gitlab.com/api/v4/user

# Test Gitea connection
curl -H "Authorization: token YOUR_PAT" \
  https://your-gitea-instance.com/api/v1/user

# Test Azure DevOps connection
curl -u ":YOUR_PAT" \
  "https://dev.azure.com/your-org/_apis/projects?api-version=7.0"

# Test Redmine connection
curl -H "X-Redmine-API-Key: YOUR_API_KEY" \
  https://your-redmine-instance.com/users/current.json

# Test MantisBT connection
curl -H "Authorization: YOUR_API_TOKEN" \
  https://your-mantisbt-instance.com/api/rest/users/me
```

### Common Issues

**Issue: Created issues show wrong reporter**

- Ensure TestPlanIt and external system users have matching emails
- **For Jira API key integrations:** confirm the API token account has the Jira administrator (**Modify Reporter**) permission. Without it, Jira ignores the reporter and records the token owner as the creator even when emails match — this is the most common cause.
- Consider using OAuth instead of API keys for accurate per-user attribution without administrator permissions
- Check user permissions in the external system

**Issue: "The stored credentials for this integration could not be read"**

- The credentials were encrypted with a different `ENCRYPTION_KEY` than the one the instance is running with, most often after a key rotation or a restore onto a new deployment.
- The integration refuses to make outbound requests in this state rather than sending a value it could not read, so no partial or malformed request reaches the provider.
- Recover by editing the integration, re-entering its credentials, and saving. That rewrites them with the current key. Every integration stored under the old key needs the same treatment.

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

1. **Prefer OAuth 2.0** when possible — for Jira, GitHub, GitLab, and Gitea/Forgejo it provides per-user attribution (issues are reported as the actual user) and granular scoping. Personal Access Tokens create every issue as a single shared account.
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
| --------- | ------- | ----------- |
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

- `repo` scope — Read/write repository access (includes issues)
- `read:user` — Read user information

**GitLab:**

- `api` scope — Full API access (create/update issues, read user)
- `read_user` scope — Verify authentication

**Gitea / Forgejo / Gogs:**

- Personal Access Token with repository read/write access (inherited from user permissions)
- No specific scope configuration — access is governed by repository membership

**Azure DevOps:**

- `Work Items (Read & Write)` — Create and update work items
- `Project and Team (Read)` — List projects and teams

**Redmine:**

- REST API enabled on the instance (**Administration → Settings → API**)
- An API key belonging to a user with permission to view and add issues in the linked project(s)

**MantisBT:**

- An API token belonging to a user with permission to view and report issues in the linked project(s)

## API Reference

For programmatic access to issue and integration features, see the [API Documentation](/docs/api-reference).

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
