# TestPlanIt for Jira - Marketplace Description

Use this content when submitting to Atlassian Marketplace.

---

## App Name
TestPlanIt for Jira

## Tagline
Connect Jira issues with TestPlanIt test management platform

---

## Short Description (140 characters)
View linked test cases, runs, and exploratory sessions directly in Jira issues. Seamless integration with TestPlanIt.

---

## Description (Marketplace Listing)

**Connect your Jira issues with TestPlanIt's powerful test management platform.**

TestPlanIt for Jira brings your test management data directly into your Jira workflow, allowing teams to see test cases, test runs, and exploratory testing sessions without leaving Jira.

### Key Features

✅ **Issue Panel Integration** - View linked test cases directly in Jira issues
✅ **Test Run Tracking** - Monitor test execution progress and results
✅ **Exploratory Sessions** - Track exploratory testing activities
✅ **One-Click Navigation** - Jump directly to detailed test data in TestPlanIt
✅ **Real-time Sync** - Always see the latest test information
✅ **Easy Configuration** - Simple setup with your TestPlanIt instance URL

### Perfect For

- QA teams using TestPlanIt who want tighter Jira integration
- Development teams tracking test coverage per issue
- Project managers monitoring test progress
- Organizations using both Jira and TestPlanIt

### How It Works

1. Install the app from the marketplace
2. Configure your TestPlanIt instance URL in settings
3. Link test cases to Jira issues in TestPlanIt
4. View all linked tests directly in the Jira issue panel

---

## ⚠️ IMPORTANT: Domain Requirements

**This app works ONLY with `*.testplanit.com` subdomains.**

### ✅ Supported:
- demo.testplanit.com
- allego.testplanit.com
- yourcompany.testplanit.com
- Any `*.testplanit.com` subdomain

### ❌ NOT Supported:
- testplanit.yourcompany.com
- custom-domain.com
- Self-hosted on custom domains

**Self-hosted users:** If you run TestPlanIt on your own domain, you'll need to create your own Forge app deployment. [See custom domain setup guide](https://github.com/yourorg/testplanit/tree/main/forge-app/CUSTOM_DOMAIN_SETUP.md).

**Need a subdomain?** Contact TestPlanIt support to request a branded `*.testplanit.com` subdomain for your organization.

---

## Installation & Setup

### Requirements
- Active Jira instance (Cloud)
- TestPlanIt instance on a `*.testplanit.com` subdomain
- Jira Administrator access for configuration

### Setup Steps

1. **Install** the app from Atlassian Marketplace
2. **Configure** in Jira:
   - Go to Apps → Manage Apps → TestPlanIt Settings
   - Enter your TestPlanIt URL (e.g., `https://demo.testplanit.com`)
   - Test connection
   - Save configuration
3. **Link tests** in TestPlanIt by adding Jira issue keys
4. **View** linked tests in the Jira issue panel

### Support

- **Documentation:** https://docs.testplanit.com/docs/user-guide/integrations/#1-jira-integration
- **Email:** admin@testplanit.com
- **Website:** https://testplanit.com

---

## Screenshots to Include

1. **Issue Panel** - Show TestPlanIt panel in Jira issue with linked test cases
2. **Settings Page** - Configuration UI with URL entry and test connection
3. **Test Details** - Expanded view showing test run results and history
4. **Session Results** - Exploratory testing session summary

---

## Keywords/Tags

test management, testing, QA, quality assurance, test cases, test runs, exploratory testing, test tracking, integration

---

## Category

Testing & QA

---

## Pricing

Free (or choose your pricing model)

---

## Privacy & Security

- **Data Storage:** Only stores your TestPlanIt instance URL (using Forge Storage API)
- **Data Access:** Reads Jira issue metadata to display in panel
- **External Communication:** Connects to your configured TestPlanIt instance
- **No Third-Party Sharing:** Data is never shared with third parties

### Permissions Explained

- `read:jira-work` - Read Jira issue details to display in the panel
- `write:jira-work` - Link test cases to issues (future feature)
- `storage:app` - Store your TestPlanIt instance URL configuration
- `external:fetch` - Connect to your TestPlanIt instance to retrieve test data

---

## Support & Resources

- Documentation: https://docs.testplanit.com/docs/user-guide/integrations/#1-jira-integration
- GitHub: https://github.com/yourorg/testplanit
- Privacy Policy: https://testplanit.com/privacy
- Terms of Service: https://testplanit.com/terms

---

## Version History

### 5.0.0 (Current)
- Initial marketplace release
- Issue panel with test case display
- Configuration page for instance URL
- Support for test runs and exploratory sessions
- Real-time data syncing

---

## Frequently Asked Questions

**Q: Can I use this with my self-hosted TestPlanIt?**
A: Only if it's hosted on a `*.testplanit.com` subdomain. For custom domains, you'll need to create your own Forge app. [Learn more](CUSTOM_DOMAIN_SETUP.md)

**Q: Is my data secure?**
A: Yes. We only store your instance URL. All test data stays in your TestPlanIt instance.

**Q: Does this work with Jira Data Center?**
A: No, this is a Forge app for Jira Cloud only.

**Q: Can I customize which tests appear?**
A: Tests are linked by adding Jira issue keys in TestPlanIt. Only explicitly linked tests appear.

**Q: What if I can't connect to my instance?**
A: Verify your instance URL is correct and uses `https://`. Make sure it's a `*.testplanit.com` subdomain. Check that your instance is accessible and the `/api/health` endpoint works.

---

## Technical Details

- **Platform:** Atlassian Forge
- **Runtime:** Node.js 20.x
- **UI Framework:** React 18 with Forge Custom UI
- **Compatible With:** Jira Cloud (Software, Service Management)

---

## Contact

**Vendor:** TestPlanIt
**Email:** admin@testplanit.com
**Website:** https://testplanit.com
**Support:** https://testplanit.com/support
