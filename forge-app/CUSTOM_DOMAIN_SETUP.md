# Custom Domain Setup Guide

If you self-host TestPlanIt on your own domain (not a `*.testplanit.com` subdomain), you **cannot** use the marketplace version of this Jira app.

Instead, you must create and deploy your own Forge app instance.

---

## Why This Limitation Exists

Atlassian Forge requires apps to explicitly whitelist all external domains they communicate with for security reasons. The marketplace version only whitelists `*.testplanit.com` domains.

If you use a custom domain like:
- `testplanit.yourcompany.com`
- `qa.example.com`
- `http://localhost:3000`

You need your own Forge app deployment.

---

## Setup Instructions for Custom Domains

### Prerequisites

1. **Node.js 22.x or 24.x** — Node 20 reached end-of-life (April 2026) and Forge
   no longer recommends it. The repo ships and is tested on Node 24.
2. **npm** — deploy this app with npm, **not pnpm**. The Forge CLI bundles
   `node_modules` at deploy time and does not understand pnpm's symlinked store.
   In the monorepo, work from an isolated copy outside the pnpm workspace.
3. **Atlassian account** with access to create Forge apps
4. **A Developer Space** — every new Forge app must belong to one (Atlassian's
   container for managing and billing apps). You'll pick or create it during
   `forge register`. The first admin of a new space also becomes its billing
   admin, so for a company deployment create it under a company-owned account.
5. **Forge CLI** (`npm install -g @forge/cli`)

### Step 1: Clone the Repository

```bash
git clone <your-testplanit-repo>
cd testplanit/forge-app
npm install
```

### Step 2: Create Your Own Forge App

1. Go to https://developer.atlassian.com/console/myapps/
2. Click **"Create"** → **"Forge app"**
3. Enter app name: **"TestPlanIt (Your Company)"**
4. Click **Create**
5. Copy the **App ID** (looks like `ari:cloud:ecosystem::app/...`)

### Step 3: Update manifest.yml

Edit `manifest.yml`:

```yaml
app:
  id: ari:cloud:ecosystem::app/YOUR-APP-ID-HERE
  runtime:
    name: nodejs24.x   # or nodejs22.x; avoid nodejs20.x (end-of-life)

permissions:
  scopes:
    - read:jira-work
    - write:jira-work
    - read:jira-user   # required: the app reads /rest/api/3/myself to attribute generated cases
    - storage:app
  external:
    fetch:
      backend:
        - 'your-domain.com'           # Replace with your domain
        - '*.your-domain.com'          # Supports subdomains
      client:
        - 'your-domain.com'
        - '*.your-domain.com'
    images:
      - 'your-domain.com'
      - '*.your-domain.com'
```

**Important:** Replace:
- `YOUR-APP-ID-HERE` with your app ID from Step 2
- `your-domain.com` with your actual TestPlanIt domain

**Examples:**

If your TestPlanIt runs at `https://testplanit.mycompany.com`:
```yaml
external:
  fetch:
    backend:
      - 'mycompany.com'
      - '*.mycompany.com'
```

If your TestPlanIt runs at `https://qa.example.org`:
```yaml
external:
  fetch:
    backend:
      - 'example.org'
      - '*.example.org'
```

### Step 4: Configure Authentication

1. Create an API token:
   - Go to https://id.atlassian.com/manage/api-tokens
   - Click **"Create API token"**
   - Name it: **"Forge CLI"**
   - Copy the token

2. Update `.env.forge`:
   ```bash
   export FORGE_EMAIL="your-email@example.com"
   export FORGE_API_TOKEN="your-token-here"
   ```

3. Load credentials:
   ```bash
   source .env.forge
   ```

4. Verify login:
   ```bash
   npx forge whoami
   ```

### Step 5: Build and Deploy

```bash
# Build webpack bundles
npm run build

# Deploy to Forge (development environment)
npx forge deploy
```

You should see:
```
✔ Deployed
Deployed <your-app-name> to the development environment.
```

### Step 6: Install on Your Jira

```bash
npx forge install
```

Select your Jira instance when prompted.

### Step 7: Configure the App in Jira

1. Go to **Jira → Apps → Manage Apps**
2. Find **TestPlanIt** (or your custom app name)
3. Click **"TestPlanIt Settings"**
4. Enter your custom domain: `https://testplanit.yourcompany.com`
5. Click **"Test Connection"**
6. Click **"Save Configuration"**

### Step 8: Test

1. Navigate to any Jira issue
2. Look for the TestPlanIt panel on the right
3. Verify it loads data from your custom domain

---

## Updating Your Deployment

When you need to update the app:

```bash
cd testplanit/forge-app
source .env.forge
npm run build
npx forge deploy
```

No need to reinstall - updates are automatic.

---

## Adding Additional Domains

If you have multiple TestPlanIt instances on different domains, add them all:

```yaml
external:
  fetch:
    backend:
      - 'domain1.com'
      - '*.domain1.com'
      - 'domain2.com'
      - '*.domain2.com'
      - 'another-domain.org'
      - '*.another-domain.org'
```

Then redeploy.

---

## Troubleshooting

### "Authorization failed" Error
- Make sure you ran `source .env.forge`
- Verify account with `npx forge whoami`
- Check that the account created the Forge app

### "Connection test failed"
- Verify your domain is in the manifest
- Check that TestPlanIt is accessible at the URL
- The app tests connectivity against `/version.json` and validates the key
  against `/api/integrations/jira/test-connection` — confirm both respond

### "Not logged in" Error
- Run `source .env.forge` before each terminal session
- Or add credentials to your shell profile

### Permission Errors
- Ensure you have `read:jira-work`, `write:jira-work`, `read:jira-user`, and `storage:app` scopes
- Check that your domain is listed under all three: `backend`, `client`, and `images`

---

## Important Notes

1. **Each custom domain requires its own Forge app**
   - You cannot share one Forge app across different domains
   - Exception: Subdomains of the same domain work together

2. **Not for marketplace distribution**
   - Custom domain apps are for internal use only
   - They cannot be published to Atlassian Marketplace

3. **Maintenance responsibility**
   - You are responsible for maintaining and updating your own deployment
   - Updates to the source code require redeployment

4. **Development vs Production**
   - Use `npx forge deploy` for the development environment
   - Use `npx forge deploy --environment production` for production
   - Test thoroughly in development before promoting to production

---

## Support

For questions about custom domain setup:
- Check Forge documentation: https://developer.atlassian.com/platform/forge/
- Review TestPlanIt Jira integration docs: https://docs.testplanit.com/docs/user-guide/integrations/#1-jira-integration
- Contact: admin@testplanit.com

---

## Alternative: Use TestPlanIt Subdomains

**Recommended:** Instead of self-hosting on custom domains, consider using a `*.testplanit.com` subdomain:

- Request a subdomain: yourcompany.testplanit.com
- Use the marketplace version of this app
- No custom deployment needed
- Automatic updates from the marketplace

Contact TestPlanIt support to request a branded subdomain for your organization.
