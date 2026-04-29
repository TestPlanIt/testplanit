# TestPlanIt for Jira - Forge App

A [Forge](https://developer.atlassian.com/platform/forge/) app that displays TestPlanIt test cases, test runs, and exploratory testing sessions directly in Jira issue panels.

## How It Works

- **Issue Panel**: Shows linked test cases, test runs, and sessions on every Jira issue
- **Settings Page**: Admin configuration for TestPlanIt instance URL and API key
- **API Key Auth**: Secure communication via `X-Forge-Api-Key` header with timing-safe validation

The app calls two endpoints on your TestPlanIt instance:
- `GET /version.json` — connection test
- `GET /api/integrations/jira/test-info?issueKey=...&issueId=...` — fetch linked test data

## Domain Requirements

The **Marketplace version** only works with `*.testplanit.com` subdomains (e.g., `https://demo.testplanit.com`). This is an Atlassian Forge security requirement — apps must explicitly whitelist external domains.

For custom domains, see [CUSTOM_DOMAIN_SETUP.md](CUSTOM_DOMAIN_SETUP.md).

## Project Structure

```
forge-app/
├── manifest.yml              # Forge app manifest (modules, permissions)
├── src/
│   ├── index.js              # Backend resolvers (getTestInfo, settings, etc.)
│   └── frontend/
│       ├── app.jsx           # Issue panel UI
│       └── settings.jsx      # Admin settings page UI
├── static/                   # Webpack output (built frontend bundles)
├── webpack.config.js         # Multi-entry webpack config
├── deploy.sh                 # Build + deploy script
└── CUSTOM_DOMAIN_SETUP.md    # Guide for self-hosted custom domains
```

## Development

### Prerequisites

- Node.js 24.x
- [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/)
- Access to an Atlassian account with a Jira Cloud instance

### Setup

```bash
cd forge-app

# Install dependencies
npm install

# Login to Forge CLI
npx forge login

# Build webpack bundles
npm run build
```

### Local Development with Tunnel

```bash
npm run build
npx forge tunnel
```

This runs the backend locally while serving the frontend from Forge, useful for debugging resolver functions.

### Deployment

**Important**: The forge-app uses npm (not pnpm) for deployment due to Forge CLI compatibility. If you're in the monorepo with pnpm, deploy from an isolated copy:

```bash
# Option 1: Use the deploy script (if outside pnpm workspace)
./deploy.sh

# Option 2: Deploy from isolated copy (recommended in monorepo)
cp -r forge-app /tmp/forge-app-deploy
cd /tmp/forge-app-deploy
rm -rf node_modules
npm install
npm run build
npx forge deploy                          # staging
npx forge deploy --environment production # production
```

### Environments

- **Staging**: `forge deploy` (default) — for testing
- **Production**: `forge deploy --environment production` — marketplace version

Each environment has separate Forge Storage, so settings configured in staging don't affect production.

## User Setup

### For Jira Administrators

1. Install the app from [Atlassian Marketplace](https://marketplace.atlassian.com/) (or via `forge install` for dev)
2. Go to **Jira Settings (gear) > Apps > TestPlanIt Settings**
3. Enter your TestPlanIt instance URL (e.g., `https://yourcompany.testplanit.com`)
4. Generate a Forge API key in TestPlanIt: **Admin > Integrations > Jira > Forge API Key**
5. Paste the API key and click **Test Connection**
6. Click **Save Configuration**

### For End Users

Navigate to any Jira issue — the TestPlanIt panel appears on the right side showing linked test cases, test runs, and sessions. Click any item to open it in TestPlanIt.

## Marketplace

See [MARKETPLACE_RELEASE.md](MARKETPLACE_RELEASE.md) for the full marketplace submission guide.

## License

MIT
