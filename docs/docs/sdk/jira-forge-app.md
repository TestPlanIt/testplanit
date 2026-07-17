---
sidebar_label: 'Jira App (Forge)'
title: 'TestPlanIt for Jira'
---

# TestPlanIt for Jira

The TestPlanIt for Jira app is an [Atlassian Forge](https://developer.atlassian.com/platform/forge/) app that displays test cases, test runs, and exploratory testing sessions directly in Jira issue panels.

## Features

- **Issue Panel** — View linked test cases, test runs, and sessions on every Jira issue
- **Generate Test Cases** — Generate AI test cases for an issue and import them into a project
- **Generate QuickScript** — Generate an AI automation script from the test cases linked to an issue, following the project's connected code repository when one is configured
- **Settings Page** — Admin configuration for your TestPlanIt instance URL and API key
- **Secure Authentication** — API key authentication with timing-safe validation

### Test Runs & Sessions

![Test runs and sessions panel](/img/jira-forge-panel-runs.png)

### Test Cases

![Test cases panel](/img/jira-forge-panel-cases.png)

## Requirements

- Jira Cloud (Software)
- A TestPlanIt instance hosted on a `*.testplanit.com` subdomain

:::info Domain Restriction
The Marketplace version of this app **only works with `*.testplanit.com` subdomains** (e.g., `https://demo.testplanit.com`). This is an Atlassian Forge security requirement — apps must explicitly whitelist external domains in the manifest.

If you self-host TestPlanIt on a custom domain, see [Custom Domain Setup](#custom-domain-setup) below.
:::

## Installation

### From the Atlassian Marketplace

1. Search for **"TestPlanIt for Jira"** on the [Atlassian Marketplace](https://marketplace.atlassian.com/)
2. Click **Install** and select your Jira instance

### Manual Installation (Development)

```bash
cd forge-app
npx forge install
```

Select your Jira instance when prompted.

## Configuration

### Step 1: Generate a Forge API Key in TestPlanIt

1. Log into your TestPlanIt instance as an admin
2. Go to **Admin > Integrations**
3. Find or create a **Jira** integration
4. Click **Generate Forge API Key**
5. Copy the generated key

### Step 2: Configure the App in Jira

1. In Jira, go to **Settings (gear icon) > Apps > TestPlanIt Settings**
2. Enter your **TestPlanIt Instance URL** (e.g., `https://yourcompany.testplanit.com`)
3. Enter the **Forge API Key** from Step 1
4. Click **Test Connection** to verify connectivity
5. Click **Save Configuration**

![TestPlanIt settings page](/img/jira-forge-settings.png)

### Step 3: Verify

Navigate to any Jira issue that has linked test cases in TestPlanIt. The **TestPlanIt panel** will appear on the right side showing:

- **Test Cases** — Linked test cases with status
- **Test Runs** — Recent test runs referencing this issue
- **Sessions** — Exploratory testing sessions linked to this issue

Click any item to open it directly in TestPlanIt.

## Linking Tests to Jira Issues

Tests are linked by associating Jira issue keys in TestPlanIt:

1. In TestPlanIt, navigate to a test case, test run, or session
2. Link it to a Jira issue using the issue key (e.g., `PROJ-123`)
3. The linked test will automatically appear in the Jira issue panel

## Troubleshooting

### "Not Configured" Message

The app hasn't been configured yet. Go to **Jira Settings > Apps > TestPlanIt Settings** and enter your instance URL and API key.

### Connection Test Fails

- Verify the URL is correct and uses `https://`
- Ensure the URL is a `*.testplanit.com` subdomain
- Check that your TestPlanIt instance is accessible
- Make sure there's no trailing slash in the URL

### 401 Unauthorized Error

- Verify the Forge API Key is correct
- Regenerate the key in TestPlanIt if needed: **Admin > Integrations > Jira > Forge API Key**
- Make sure you're using the **Forge API Key**, not a regular API token

### Panel Shows "No Tests Linked"

- Confirm that test cases are linked to this Jira issue in TestPlanIt
- Check that the Jira issue key matches exactly (e.g., `PROJ-123`)

### Check Forge Logs

For deeper debugging, use the Forge CLI:

```bash
cd forge-app
npx forge logs
```

## Custom Domain Setup

If your TestPlanIt instance runs on a custom domain (not `*.testplanit.com`), you cannot use the Marketplace version. Instead, deploy your own Forge app:

1. Clone the [TestPlanIt repository](https://github.com/testplanit/testplanit)
2. Edit `forge-app/manifest.yml` — replace the domain whitelist with your domain:
   ```yaml
   permissions:
     external:
       fetch:
         backend:
           - 'your-domain.com'
           - '*.your-domain.com'
         client:
           - 'your-domain.com'
           - '*.your-domain.com'
       images:
         - 'your-domain.com'
         - '*.your-domain.com'
   ```
3. Create a new Forge app at the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
4. Update the `app.id` in `manifest.yml` with your new app ID
5. Build and deploy:
   ```bash
   cd forge-app
   npm install
   npm run build
   npx forge deploy
   npx forge install
   ```

See [CUSTOM_DOMAIN_SETUP.md](https://github.com/testplanit/testplanit/blob/main/forge-app/CUSTOM_DOMAIN_SETUP.md) for the full guide.

## Technical Details

- **Platform**: Atlassian Forge (Custom UI)
- **Runtime**: Node.js 24.x
- **Frontend**: React 18 with Tailwind CSS
- **Backend**: Forge Resolver functions
- **Storage**: Forge Storage API (per-installation key-value store)

### API Endpoints Used

The app calls these endpoints on your TestPlanIt instance:

| Endpoint | Purpose |
| ---------- | --------- |
| `GET /version.json` | Connection test (returns app version) |
| `GET /api/integrations/jira/test-info` | Fetch linked test cases, runs, and sessions |
| `GET /api/integrations/jira/generate-context` | Projects, templates, and readiness for Generate Test Cases |
| `POST /api/integrations/jira/generate-token` | Mint a short-lived token to stream test-case generation |
| `POST /api/integrations/jira/generate-stream` | Stream AI-generated test cases (browser-direct) |
| `POST /api/integrations/jira/import-test-cases` | Persist the confirmed generated cases |
| `GET /api/integrations/jira/quickscript-context` | Projects, export templates, readiness, and issue-linked cases for QuickScript |
| `POST /api/integrations/jira/quickscript-token` | Mint a short-lived token to stream QuickScript generation |
| `POST /api/integrations/jira/quickscript-stream` | Stream the generated QuickScript (browser-direct) |

Most endpoints require the `X-Forge-Api-Key` header for authentication; the streaming endpoints use a short-lived `X-Forge-Token` minted by their `*-token` counterpart.
