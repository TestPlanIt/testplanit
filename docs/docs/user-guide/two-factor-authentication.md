---
sidebar_label: 'Two-Factor Authentication'
title: Two-Factor Authentication (2FA)
description: Configure and use two-factor authentication for enhanced account security
---

# Two-Factor Authentication (2FA)

TestPlanIt supports Time-based One-Time Password (TOTP) two-factor authentication to provide an additional layer of security for user accounts. This guide covers how users can enable 2FA on their accounts and how administrators can enforce 2FA policies organization-wide.

## Overview

Two-factor authentication requires users to provide two forms of identification when signing in:

1. **Something you know**: Your password
2. **Something you have**: A time-based code from an authenticator app

This significantly reduces the risk of unauthorized access, even if a password is compromised.

## Supported Authenticator Apps

TestPlanIt's TOTP implementation works with any standard authenticator app, including:

- **Google Authenticator** (iOS/Android)
- **Microsoft Authenticator** (iOS/Android)
- **Authy** (iOS/Android/Desktop)
- **1Password** (iOS/Android/Desktop)
- **Bitwarden** (iOS/Android/Desktop)

## User Guide: Setting Up 2FA

### Enabling Two-Factor Authentication

1. Navigate to your **User Profile** page
2. Find the **Two-Factor Authentication** section
3. Toggle the 2FA switch to enable setup
4. A QR code will be displayed along with a manual entry secret

### Scanning the QR Code

1. Open your authenticator app
2. Select "Add Account" or tap the "+" button
3. Choose "Scan QR Code"
4. Point your camera at the QR code displayed in TestPlanIt
5. The account will be added automatically

### Manual Entry (Alternative)

If you cannot scan the QR code:

1. In your authenticator app, choose "Enter manually" or "Enter setup key"
2. Enter the secret key displayed below the QR code
3. Set the account name to identify this is for TestPlanIt

### Verifying Setup

After adding the account to your authenticator app:

1. Enter the 6-digit code shown in your authenticator app
2. Click **Verify**
3. If successful, you'll see your backup codes

### Backup Codes

Upon successful 2FA setup, you'll receive **10 backup codes**. These are critical for account recovery:

- Each code can only be used **once**
- Store them securely (password manager, printed copy in a safe location)
- Use a backup code if you lose access to your authenticator app
- You can regenerate backup codes from your profile (requires verification)

:::warning
Save your backup codes immediately! They will only be shown once during setup. If you lose access to your authenticator app and don't have backup codes, you may be locked out of your account.
:::

## Signing In with 2FA

### Standard Sign-In Flow

1. Enter your email and password as usual
2. After successful password verification, you'll be prompted for your 2FA code
3. Open your authenticator app and enter the current 6-digit code
4. Click **Verify** to complete sign-in

### Using a Backup Code

If you don't have access to your authenticator app:

1. On the 2FA verification screen, click **Use backup code**
2. Enter one of your 8-character backup codes
3. Click **Verify**
4. The backup code is consumed and cannot be used again

:::tip
After using a backup code, consider regenerating your backup codes from your profile to ensure you have a full set available.
:::

## Managing 2FA Settings

### Disabling 2FA

To disable two-factor authentication on your account:

1. Go to your **User Profile**
2. Toggle the 2FA switch to off
3. Enter your current 2FA code or a backup code to confirm
4. 2FA will be disabled

:::note
If your organization has enforced 2FA (see Admin Settings below), you will not be able to disable 2FA on your account.
:::

### Regenerating Backup Codes

If you've used backup codes or want to generate new ones:

1. Go to your **User Profile**
2. Click **Regenerate Backup Codes**
3. Enter your current 2FA code to verify your identity
4. New backup codes will be generated
5. **Save the new codes** - the old codes are now invalid

## Administrator Guide

### 2FA Enforcement Settings

Administrators can configure organization-wide 2FA policies from the **Admin > SSO** settings page under **Registration Settings**.

#### Force 2FA for Non-SSO Logins

When enabled:

- Users signing in with **email/password** must have 2FA enabled
- Users without 2FA will be redirected to set it up before accessing the application
- Does **not** affect SSO logins (Google, Apple, SAML, Magic Link)

**Use Case**: Require additional security for password-based logins while allowing SSO users to rely on their identity provider's security controls.

#### Force 2FA for All Logins

When enabled:

- **All users** must have 2FA enabled, including SSO users
- SSO users will be prompted to set up and verify 2FA after their identity provider authenticates them
- Provides consistent security across all authentication methods

**Use Case**: Maximum security for organizations that want to ensure 2FA regardless of how users authenticate.

### Enforcement Behavior

| Setting | Password Login | SSO Login |
|---------|----------------|-----------|
| Both disabled | 2FA optional | 2FA optional |
| Non-SSO only | 2FA required | 2FA optional |
| All logins | 2FA required | 2FA required |

### SSO and Personal 2FA

When **Force 2FA for All Logins** is NOT enabled:

- Users who set up personal 2FA will only be prompted when using password login
- SSO logins bypass personal 2FA settings
- A notice is displayed on user profiles to inform users of this behavior

When **Force 2FA for All Logins** IS enabled:

- SSO users must complete 2FA verification after identity provider authentication
- Personal 2FA settings are enforced for all login methods

### Preventing 2FA Disable

When either enforcement setting is enabled:

- Users cannot disable 2FA on their accounts
- The disable option is hidden and API requests to disable return an error
- This ensures compliance with the organization's security policy

## Security Considerations

### Best Practices

1. **Use a reputable authenticator app** with backup/sync capabilities
2. **Store backup codes securely** - treat them like passwords
3. **Enable 2FA organization-wide** if handling sensitive data
4. **Use SSO with MFA** from your identity provider for additional security layers

### Recovery Options

If a user is locked out:

1. **Backup codes**: User enters one of their backup codes
2. **Admin assistance**: Administrators can reset a user's 2FA through the admin panel (requires verification)

### Audit Trail

All 2FA-related actions are logged:

- 2FA setup completion
- 2FA verification attempts (success/failure)
- Backup code usage
- 2FA disable events
- Backup code regeneration

## Troubleshooting

### "Invalid verification code"

- Ensure your device's clock is synchronized (TOTP is time-sensitive)
- Wait for a new code to appear and try again
- Verify you're using the correct account in your authenticator app

### "Too many attempts"

- 2FA verification is rate-limited for security
- Wait a few minutes before trying again
- Use a backup code if you continue to have issues

### Lost Authenticator App Access

1. Use one of your backup codes to sign in
2. Go to your profile and disable 2FA
3. Set up 2FA again with your new device/app
4. Save the new backup codes

### Code Not Working After Device Change

- If you restored from a backup, your authenticator accounts should transfer
- If not, use a backup code and re-setup 2FA
- Some apps (like Authy) sync across devices automatically

## API Reference

### 2FA Settings Endpoint

```
GET /api/auth/two-factor/settings
```

Returns the current 2FA enforcement settings:

```json
{
  "force2FAAllLogins": false,
  "force2FANonSSO": true
}
```

### Check User 2FA Status

User 2FA status is included in session data and can be checked via the user profile API.

## Related Documentation

- [Single Sign-On (SSO)](./sso.md) - Configure SSO providers
- [User Profile](./user-profile.md) - Manage your account settings
- [Users](./users.md) - User management for administrators
