# TestPlanIt Jira App - Marketplace Release Guide

## Changes Made for Multi-Tenant Support

Your Forge app has been updated to support **customer-hosted TestPlanIt instances**. Users can now install the app from the marketplace and configure their own TestPlanIt URL.

### Key Changes:

1. **Configuration Page** - Added admin settings page at `Apps → Manage Apps → TestPlanIt Settings`
2. **Dynamic URLs** - Removed hardcoded `dev.testplanit.com`, now uses stored instance URL
3. **Storage API** - Saves instance URL per Jira installation
4. **Wildcard Permissions** - Updated manifest to allow connections to any TestPlanIt domain

---

## Release Steps

### 1. Login to Forge CLI

```bash
cd forge-app
pnpm exec forge login
```

This will open a browser for Atlassian authentication.

### 2. Deploy to Development Environment

```bash
pnpm run deploy
```

This builds webpack and deploys to your development environment.

### 3. Test the App

Install on a test Jira site:

```bash
pnpm exec forge install
```

**Test checklist:**
- [ ] Configure TestPlanIt instance URL in settings
- [ ] Test connection button works
- [ ] Visit a Jira issue and verify panel loads
- [ ] Link a test case to an issue
- [ ] Verify all links open correct TestPlanIt pages
- [ ] Test with different instance URLs (demo.testplanit.com, allego.testplanit.com)

### 4. Deploy to Production Environment

Once testing is complete:

```bash
pnpm exec forge deploy --environment production
```

### 5. Create Marketplace Listing

Go to [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/):

1. Select your app (ID: `c087f256-596f-4719-89fb-69407583fff9`)
2. Navigate to **Distribution** tab
3. Click **Distribute app** → **Atlassian Marketplace**

### 6. Prepare Marketplace Materials

#### Required Assets:

**App Icon** (256x256 PNG)
- High quality logo representing TestPlanIt
- Simple, recognizable design

**Screenshots** (minimum 3)
1. Issue panel showing linked test cases
2. Settings page with configuration UI
3. Test run details in expanded view
4. (Optional) Session results visualization

**Marketing Description**

```
Connect your Jira issues with TestPlanIt test management platform.

Key Features:
• View linked test cases directly in Jira issues
• Track test runs and results without leaving Jira
• Monitor exploratory testing sessions
• Seamlessly navigate to TestPlanIt for detailed testing workflows
• Support for self-hosted and cloud TestPlanIt instances

Perfect for teams using TestPlanIt who want deeper integration with their Jira workflow.
```

**Long Description**

Expand on features, use cases, benefits. Include:
- Installation instructions
- Configuration steps
- How to link test cases
- Screenshots with explanations

**Support Information**
- Support Email: support@testplanit.com
- Documentation URL: https://docs.testplanit.com
- Privacy Policy URL: https://testplanit.com/privacy
- Terms of Service URL: https://testplanit.com/terms

#### Pricing Model

Choose your pricing strategy:
- Free
- Free trial with paid tiers
- Subscription-based

### 7. Complete Marketplace Submission

Fill in all required fields:

- **App Name**: TestPlanIt for Jira
- **Tagline**: Connect Jira issues with TestPlanIt test management
- **Category**: Testing & QA
- **Target Audience**: QA Teams, Software Developers, Project Managers
- **Supported Products**: Jira Software, Jira Service Management
- **Permissions Justification**:
  - `read:jira-work` - Read issue details to display in panel
  - `write:jira-work` - Link test cases to issues
  - `storage:app` - Store customer's TestPlanIt instance URL
  - `external:fetch` - Connect to customer's TestPlanIt instance

### 8. Submit for Review

Click **Submit for Review**

Atlassian's review process typically takes **5-10 business days**.

They will check:
- Security best practices
- Performance and reliability
- User experience
- Compliance with marketplace guidelines

### 9. Handle Review Feedback

If changes are requested:
1. Make the required changes
2. Redeploy: `pnpm run deploy`
3. Resubmit for review

### 10. Publish!

Once approved, your app will be live on the Atlassian Marketplace!

---

## Post-Launch Checklist

- [ ] Monitor app installations and usage
- [ ] Set up support channels (email, docs, forum)
- [ ] Create user documentation
- [ ] Monitor logs for errors: `pnpm exec forge logs`
- [ ] Collect user feedback
- [ ] Plan future updates and features

---

## User Setup Instructions (to include in docs)

### IMPORTANT: Domain Requirements

**The marketplace version of this app ONLY works with `*.testplanit.com` subdomains.**

This is due to Atlassian Forge security requirements that mandate explicit domain whitelisting in the app manifest.

#### ✅ Supported Configurations (Marketplace App):
- `https://demo.testplanit.com`
- `https://allego.testplanit.com`
- `https://yourcompany.testplanit.com`
- Any subdomain of `testplanit.com`

#### ❌ NOT Supported (Marketplace App):
- `https://testplanit.yourcompany.com`
- `https://custom-domain.com`
- `http://localhost:3000`
- Any domain that is not a subdomain of `testplanit.com`

### For Self-Hosted Custom Domains

**If you run TestPlanIt on your own domain** (not a `*.testplanit.com` subdomain), you must:

1. **Clone this repository**
2. **Update `manifest.yml`** with your domain:
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
3. **Create your own Forge app** at https://developer.atlassian.com/console/myapps/
4. **Update the app ID** in `manifest.yml` with your new app ID
5. **Build and deploy** using the instructions in this README
6. **Install on your Jira** instance using `forge install`

**Note:** You cannot use the marketplace version if you self-host on a custom domain.

---

### For Jira Administrators (Using Marketplace App):

1. **Verify** your TestPlanIt instance uses a `*.testplanit.com` subdomain
2. **Install the app** from Atlassian Marketplace
3. Go to **Apps → Manage Apps**
4. Find **TestPlanIt** in the list
5. Click **Configure** or access **TestPlanIt Settings**
6. Enter your TestPlanIt instance URL (e.g., `https://demo.testplanit.com`)
7. Click **Test Connection** to verify
8. Click **Save Configuration**

### For End Users:

1. Navigate to any Jira issue
2. Find the **TestPlanIt** panel on the right side
3. Linked test cases, runs, and sessions will appear automatically
4. Click any item to open it in TestPlanIt

---

## Technical Details

### Architecture

- **Frontend**: React 18 with Forge Custom UI
- **Backend**: Forge Resolver functions
- **Storage**: Forge Storage API (per-installation)
- **Build**: Webpack 5 with Babel

### Files Modified

- [manifest.yml](manifest.yml) - Added admin page, updated permissions
- [src/index.js](src/index.js) - Added storage functions, dynamic URLs
- [src/frontend/app.jsx](src/frontend/app.jsx) - Updated to use dynamic URLs
- [src/frontend/settings.jsx](src/frontend/settings.jsx) - New configuration UI
- [webpack.config.js](webpack.config.js) - Multi-entry build config

### API Endpoints Used

Your app calls these TestPlanIt endpoints:

- `GET /api/health` - Connection testing
- `GET /api/integrations/jira/test-info` - Fetch linked test data
- `POST /api/integrations/jira/link-issue` - Link test cases to issues

Make sure these endpoints are available in all TestPlanIt instances.

---

## Troubleshooting

### App not loading in Jira
- Check Forge logs: `pnpm exec forge logs`
- Verify deployment: `pnpm exec forge environments list`

### Connection test failing
- Verify TestPlanIt instance is accessible
- Check CORS configuration on TestPlanIt
- Ensure `/api/health` endpoint exists

### Links not working
- Verify instance URL has no trailing slash
- Check browser console for errors
- Test direct URL in browser

---

## Support & Resources

- **Forge Documentation**: https://developer.atlassian.com/platform/forge/
- **Marketplace Guide**: https://developer.atlassian.com/platform/marketplace/
- **Forge Community**: https://community.developer.atlassian.com/
- **TestPlanIt Docs**: https://docs.testplanit.com

---

## Next Steps

1. Test the deployment thoroughly
2. Gather screenshots and marketing materials
3. Write comprehensive documentation
4. Submit to marketplace
5. Monitor and iterate based on user feedback

Good luck with your marketplace launch! 🚀
