# Trial Instance Configuration

This document explains how to configure trial expiration for TestPlanIt instances.

## Overview

When deploying TestPlanIt as a trial instance, you can set an expiration date that will automatically redirect users to a trial expired page when the trial period ends.

## Configuration

Trial instances are configured using environment variables:

### Required Variables

**`IS_TRIAL_INSTANCE`**
- Set to `true` to enable trial expiration checks
- Set to `false` (or omit) for production instances
- Example: `IS_TRIAL_INSTANCE=true`

**`TRIAL_END_DATE`**
- The date and time when the trial expires
- Must be in ISO 8601 format
- Example: `TRIAL_END_DATE=2025-12-31T23:59:59Z`
- When the current time exceeds this date, users will be redirected to `/trial-expired`

### Optional Variables

**`NEXT_PUBLIC_WEBSITE_URL`**
- URL where users can upgrade their account
- Default: `https://testplanit.com`
- Example: `NEXT_PUBLIC_WEBSITE_URL=https://yourcompany.com`

**`NEXT_PUBLIC_CONTACT_EMAIL`**
- Contact email for sales inquiries
- Default: `sales@testplanit.com`
- Example: `NEXT_PUBLIC_CONTACT_EMAIL=sales@yourcompany.com`

## Example Configuration

### For a 30-day Trial Starting Today

```bash
# Enable trial mode
IS_TRIAL_INSTANCE=true

# Set expiration to 30 days from now (example: December 31, 2025)
TRIAL_END_DATE=2025-12-31T23:59:59Z

# Customize upgrade URL and contact email
NEXT_PUBLIC_WEBSITE_URL=https://testplanit.com
NEXT_PUBLIC_CONTACT_EMAIL=sales@testplanit.com
```

### For Production Instances (No Trial)

```bash
# Disable trial mode (or omit the variable)
IS_TRIAL_INSTANCE=false
```

## How It Works

1. **Middleware Check**: On every request, the middleware (`proxy.ts`) checks if:
   - `IS_TRIAL_INSTANCE` is set to `true`
   - `TRIAL_END_DATE` is provided
   - Current date/time is past the expiration date

2. **Automatic Redirect**: If the trial has expired, users are automatically redirected to `/[locale]/trial-expired`

3. **Trial Expired Page**: The expiration page shows:
   - A clear message that the trial has expired
   - An "Upgrade Now" button linking to your website
   - A "Contact Sales" button with your sales email
   - A message about data retention

4. **No Authentication Required**: The `/trial-expired` route is public, so users can see the expiration message even if not logged in

## Setting Trial Dates

### When Provisioning a New Trial

The provisioning system should set the `TRIAL_END_DATE` when creating the trial instance:

```bash
# Calculate 30 days from now
TRIAL_END_DATE=$(date -u -d "+30 days" +"%Y-%m-%dT%H:%M:%SZ")
```

### Docker Deployment

Add the environment variables to your `docker-compose.yml` or container configuration:

```yaml
services:
  testplanit:
    environment:
      - IS_TRIAL_INSTANCE=true
      - TRIAL_END_DATE=2025-12-31T23:59:59Z
      - NEXT_PUBLIC_WEBSITE_URL=https://testplanit.com
      - NEXT_PUBLIC_CONTACT_EMAIL=sales@testplanit.com
```

### Kubernetes Deployment

Add to your ConfigMap or Secret:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: trial-config
data:
  IS_TRIAL_INSTANCE: "true"
  TRIAL_END_DATE: "2025-12-31T23:59:59Z"
  NEXT_PUBLIC_WEBSITE_URL: "https://testplanit.com"
  NEXT_PUBLIC_CONTACT_EMAIL: "sales@testplanit.com"
```

## Customizing the Expiration Page

The trial expired page content is defined in `messages/en-US.json` under the `TrialExpired` key:

```json
{
  "TrialExpired": {
    "title": "Your Trial Has Expired",
    "description": "Thank you for trying TestPlanIt! Your trial period has ended and this instance is no longer accessible.",
    "nextSteps": "To continue using TestPlanIt and access your test data, please upgrade to a paid plan or contact our sales team.",
    "upgradeButton": "Upgrade Now",
    "contactButton": "Contact Sales",
    "dataRetention": "Your test data is safely stored and will be available when you upgrade your account."
  }
}
```

You can modify these messages to match your branding and messaging.

## Testing

To test the trial expiration:

1. Set `IS_TRIAL_INSTANCE=true`
2. Set `TRIAL_END_DATE` to a date in the past (e.g., yesterday)
3. Restart the application
4. Visit any page - you should be redirected to `/trial-expired`

## Integration with Provisioning System

When provisioning a new trial instance, the provisioning system should:

1. Calculate the trial end date (e.g., 30 days from now)
2. Set the environment variables in the instance configuration
3. Store the trial end date in the website database for tracking
4. Deploy the instance with the trial configuration

Example provisioning code:

```typescript
// Calculate trial end date (30 days from now)
const trialEndDate = new Date();
trialEndDate.setDate(trialEndDate.getDate() + 30);
const trialEndISO = trialEndDate.toISOString();

// Set environment variables for the trial instance
const envVars = {
  IS_TRIAL_INSTANCE: 'true',
  TRIAL_END_DATE: trialEndISO,
  NEXT_PUBLIC_WEBSITE_URL: 'https://testplanit.com',
  NEXT_PUBLIC_CONTACT_EMAIL: 'sales@testplanit.com',
  // ... other env vars
};

// Deploy instance with env vars
await deployTrialInstance(customerId, envVars);
```

## Monitoring Trial Expirations

The website admin dashboard can query trials that are expiring soon:

```sql
SELECT *
FROM "TrialInstance"
WHERE status = 'ACTIVE'
  AND "trialEndDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
ORDER BY "trialEndDate" ASC;
```

This allows you to:
- Send warning emails before expiration
- Reach out to customers proactively
- Track conversion rates
