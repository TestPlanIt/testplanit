---
sidebar_label: 'Authentication'
title: Single Sign-On (SSO)
description: Configure and manage SSO authentication for your TestPlanIt instance
---

# Single Sign-On (SSO)

TestPlanIt supports multiple Single Sign-On (SSO) authentication methods to provide secure and convenient access for your users. This guide covers the configuration and management of SSO providers and their effects on the authentication flow.

## Supported SSO Providers

TestPlanIt currently supports the following SSO providers:

### Google OAuth

- Uses OAuth 2.0 for authentication with Google accounts
- Requires configuration of Google Cloud Console credentials
- Automatically provisions users on first login

### Apple Sign In

- Uses Sign In with Apple for authentication with Apple IDs
- Provides enhanced privacy with Hide My Email feature
- Requires Apple Developer account and configuration
- Automatically provisions users on first login

### Magic Link Authentication

- Passwordless email-based authentication
- No password required - users receive a secure link via email
- Simple and secure authentication method
- Requires email server configuration (SMTP)
- Enabled by default
- Automatically provisions users on first login

### SAML 2.0

- Supports any SAML 2.0 compliant identity provider
- Compatible with popular providers like Okta, Azure AD, OneLogin, etc.
- Flexible configuration for enterprise requirements

## SSO Configuration

### Accessing SSO Settings

SSO configuration is available to administrators at `/admin/sso`.

### Global Settings

#### Force SSO

When enabled, this setting:

- **Removes the traditional email/password login form** from the signin page
- **Completely disables the signup page** (returns 404)
- Requires all users to authenticate through configured SSO providers
- Prevents creation of local accounts

:::warning
Before enabling Force SSO, ensure:

1. At least one SSO provider is properly configured
2. All existing users can authenticate through the SSO provider
3. Admin accounts have SSO access to prevent lockout

:::

#### SAML Provider

Toggle to enable/disable SAML authentication. When enabled, additional configuration is required.

#### Apple Sign In

Toggle to enable/disable Apple Sign In authentication. When enabled, users can sign in using their Apple ID.

**Prerequisites:**

- Apple Developer account with Sign In with Apple capability
- Service ID configured for your web application
- Sign In with Apple private key
- Configuration through the Admin UI or environment variables

**Setup Steps:**

1. Go to the [Apple Developer Portal](https://developer.apple.com/)
2. Create a Service ID for your web application:
   - Navigate to "Certificates, Identifiers & Profiles"
   - Select "Identifiers" and create a new Service ID
   - Enable "Sign In with Apple" capability
   - Configure your domain and return URL
3. Create a Sign In with Apple Key:
   - Go to "Keys" section
   - Create a new key with "Sign In with Apple" enabled
   - Download the .p8 private key file (save this securely)
   - Note the Key ID
4. Configure in TestPlanIt:
   - Go to `/admin/sso` and click "Configure" next to Apple Sign In
   - Enter your Service ID (e.g., `com.example.testplanit`)
   - Enter your Team ID (10-character identifier)
   - Enter your Key ID (10-character identifier)
   - Paste the contents of your .p8 private key file
   - Save the configuration
5. Set the redirect URL in Apple Developer Portal:
   - Return URL: `https://your-domain.com/api/auth/callback/apple`
6. Enable Apple Sign In by toggling the switch

**Alternative: Environment Variable Configuration**

For deployment automation, you can also configure Apple Sign In via environment variables:

```bash
APPLE_CLIENT_ID=com.example.testplanit
APPLE_TEAM_ID=XXXXXXXXXX
APPLE_KEY_ID=YYYYYYYYYY
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...your private key content...
-----END PRIVATE KEY-----"
```

#### Magic Link Authentication

Toggle to enable/disable Magic Link authentication. When enabled, users can sign in by receiving a secure link via email, eliminating the need for passwords.

**Prerequisites:**

- Email server (SMTP) must be configured
- Email server credentials and settings are required
- Magic Link is **enabled by default** when email server is configured

**Setup Steps:**

1. Configure email server settings via environment variables:

```bash
EMAIL_SERVER_HOST=smtp.example.com
EMAIL_SERVER_PORT=587
EMAIL_SERVER_USER=your-smtp-username
EMAIL_SERVER_PASSWORD=your-smtp-password
EMAIL_FROM=noreply@example.com
```

2. In TestPlanIt, go to `/admin/sso`
3. The Magic Link option will show as "Configured" if email settings are present
4. Toggle the switch to enable/disable Magic Link authentication

**How It Works:**

1. User clicks "Sign in with Magic Link" on the sign-in page
2. User enters their email address
3. System sends a secure link to the provided email
4. User clicks the link in their email
5. User is automatically signed in
6. Links expire after use or after a set time period for security

**Benefits:**

- **Passwordless**: No passwords to remember or manage
- **Secure**: Links are single-use and time-limited
- **Simple**: Easy for users to understand and use
- **Accessible**: Works for all users with email access

**Security Considerations:**

- Magic links are single-use only
- Links expire after a set time period
- Email server must be properly secured (use TLS/SSL)
- Consider enabling email domain restrictions for additional security

:::tip
Magic Link authentication is ideal for users who prefer a password-free experience or for organizations that want to simplify the sign-in process while maintaining security.
:::

#### Enable Google OAuth

Toggle to enable/disable Google OAuth authentication. When enabled, users can sign in using their Google accounts.

**Prerequisites:**

- Google OAuth credentials must be configured through the Admin UI
- Click the "Configure" button next to Google OAuth to set up Client ID and Client Secret
- Create a Google Cloud Project and obtain OAuth 2.0 credentials from the Google Cloud Console

**Setup Steps:**

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API (if required)
4. Go to "Credentials" and create an "OAuth 2.0 Client ID"
5. Set authorized redirect URIs to: `https://your-domain.com/api/auth/callback/google`
6. Copy the Client ID and Client Secret
7. In TestPlanIt, go to `/admin/sso` and click "Configure" next to Google OAuth
8. Enter your Client ID and Client Secret
9. Enable Google OAuth by toggling the switch

### Registration Settings

TestPlanIt provides additional controls for managing user registration and access through email domain restrictions.

#### Email Domain Restrictions

The Email Domain Restrictions feature allows administrators to control which email domains are allowed to register for new accounts. This provides an additional layer of security and access control for your TestPlanIt instance.

**Key Features:**

- **Restrict Registration by Domain**: When enabled, only users with email addresses from approved domains can create accounts
- **Applies to All Registration Methods**: Domain restrictions apply to:
  - Email/password registration
  - Google OAuth sign-in (for new users)
  - Apple Sign In (for new users)
  - Magic Link (for new users)
  - SAML SSO sign-in (for new users)
- **Flexible Domain Management**: Add, remove, enable, or disable specific domains
- **Existing Users Unaffected**: Domain restrictions only apply to new registrations; existing users can continue to sign in regardless of their email domain

**Configuration:**

1. Navigate to `/admin/sso`
2. Find the "Registration Settings" section
3. Toggle "Restrict Email Domains" to enable the feature
4. Add allowed domains using the input field (e.g., `example.com`, `company.org`)
5. Manage existing domains:
   - Toggle individual domains on/off without removing them
   - Remove domains permanently with the X button

**Important Considerations:**

- When domain restriction is enabled with no allowed domains configured, **all new registrations will be blocked**
- Domain validation is case-insensitive (`Example.com` and `example.com` are treated the same)
- Subdomains must be explicitly added (e.g., `mail.example.com` is different from `example.com`)
- Users attempting to register with unauthorized domains will receive a clear error message

**Use Cases:**

- **Corporate Environments**: Restrict registration to company email domains only
- **Educational Institutions**: Allow only students and staff with institution email addresses
- **Partner Access**: Grant access to specific partner organization domains
- **Beta Testing**: Limit access to approved tester domains during beta phases

## Effects on Authentication Pages

### Sign In Page (`/signin`)

The sign-in page behavior changes based on SSO configuration:

#### Standard Mode (Force SSO Disabled)

- **Email/password form** is displayed as the primary authentication method
- **SSO options** appear below the form after an "Or" divider
- Users can choose between:
  - Traditional email/password login
  - Available SSO providers (Google OAuth, Apple Sign In, Magic Link, SAML)
- Link to signup page remains visible

#### Force SSO Mode (Force SSO Enabled)

- **Email/password form is completely hidden**
- **Only SSO provider buttons are displayed**
- Users must authenticate through one of the configured SSO providers
- No link to signup page (as signup is disabled)

#### Visual Flow

```mermaid
graph TD
    A[User visits /signin] --> B{Force SSO Enabled?}
    B -->|No| C[Show email/password form]
    C --> D[Show SSO options below]
    D --> E[Show signup link]
    B -->|Yes| F[Hide email/password form]
    F --> G[Show only SSO buttons]
    G --> H[No signup link]
```

### Sign Up Page (`/signup`)

The signup page behavior is significantly affected by SSO configuration:

#### Standard Mode (Force SSO Disabled)

- Signup page is **accessible**
- Users can create accounts with:
  - Name
  - Email
  - Password
  - Password confirmation
- Email verification is required
- Default user preferences are created

#### Force SSO Mode (Force SSO Enabled)

- Signup page returns **404 Not Found**
- All user provisioning happens through SSO providers
- No local account creation is allowed

## SAML Configuration

When SAML is enabled, administrators can configure SAML settings by clicking the settings icon next to the SAML provider.

### Required SAML Settings

#### Identity Provider Settings

- **Entry Point**: The SSO login URL provided by your identity provider
- **Issuer**: The Service Provider entity ID (your TestPlanIt instance)
- **Certificate**: The X.509 certificate from your identity provider

#### User Provisioning

- **Auto Provision Users**: Automatically create user accounts on first SSO login
- **Default Access Level**: The default role assigned to auto-provisioned users
  - USER (default)
  - TESTER
  - MEMBER
  - MANAGER
  - ADMIN

#### Attribute Mapping

Configure how SAML attributes map to TestPlanIt user fields:

- **Email Attribute**: SAML attribute containing the user's email
- **Name Attribute**: SAML attribute containing the user's display name
- **Groups Attribute**: SAML attribute containing user groups (optional)

### SAML Authentication Flow

1. User clicks "Sign in with [SAML Provider Name]"
2. Redirect to Identity Provider login page
3. User authenticates with Identity Provider
4. Identity Provider sends SAML assertion back to TestPlanIt
5. TestPlanIt validates the assertion
6. User account is created/updated based on configuration
7. User is logged into TestPlanIt

## User Experience

### First-Time SSO Users

When a user signs in via SSO for the first time:

1. **Google OAuth**:
   - User is prompted to authorize TestPlanIt
   - Account is automatically created with Google profile information
   - Default user preferences are applied

2. **Apple Sign In**:
   - User is prompted to authorize TestPlanIt with their Apple ID
   - Option to share or hide email address (Hide My Email feature)
   - Account is automatically created with Apple ID information
   - Default user preferences are applied
   - Name is only provided on first authorization

3. **SAML**:
   - User authenticates with their identity provider
   - If auto-provisioning is enabled, account is created
   - User attributes are mapped from SAML assertion
   - Default access level is assigned

### Existing Users

For users with existing TestPlanIt accounts:

- Email address is used to match SSO identity with existing account
- User profile may be updated with SSO provider information
- Access level remains unchanged (unless updated by SAML attributes)

## Security Considerations

### Security Best Practices

1. **Use HTTPS**: Always use HTTPS in production for secure authentication
2. **Certificate Validation**: Ensure SAML certificates are properly validated
3. **Regular Audits**: Periodically review SSO configurations and user access
4. **Backup Authentication**: Maintain admin accounts with alternative authentication methods

### Access Control

- SSO users inherit the same role-based access control as regular users
- Administrators can manage SSO user permissions through the standard user management interface
- SAML attribute mapping can automatically assign roles based on IdP groups

### Session Management

- SSO sessions follow the same timeout rules as regular sessions
- Single Logout (SLO) is supported for SAML providers
- Users can manually sign out to terminate their session

## Troubleshooting

### Common Issues

#### Google OAuth Not Working

- Verify Google OAuth credentials are configured in the Admin UI at `/admin/sso`
- Click "Configure" next to Google OAuth to verify Client ID and Client Secret are entered
- Check OAuth consent screen configuration in Google Cloud Console
- Ensure redirect URIs are properly configured in Google Cloud Console
- Verify the authorized redirect URI includes: `https://your-domain.com/api/auth/callback/google`
- Ensure Google OAuth is enabled (toggle switch is on) in the Admin UI

#### Apple Sign In Not Working

- Verify Apple Sign In credentials are configured in the Admin UI at `/admin/sso` or via environment variables
- Click "Configure" next to Apple Sign In to verify all fields are correctly entered:
  - Service ID (e.g., `com.example.testplanit`)
  - Team ID (10-character identifier from Apple Developer Portal)
  - Key ID (10-character identifier for your Sign In with Apple key)
  - Private Key (contents of .p8 file)
- Ensure the Service ID is configured with the correct domain and return URL in Apple Developer Portal
- Verify the return URL is set to: `https://your-domain.com/api/auth/callback/apple`
- Check that Sign In with Apple capability is enabled for your Service ID
- Ensure Apple Sign In is enabled (toggle switch is on) in the Admin UI
- Note: Apple Sign In requires HTTPS in production

#### SAML Authentication Fails

- Verify certificate is correctly formatted (PEM format)
- Check entry point URL is accessible
- Ensure clock synchronization between servers (SAML is time-sensitive)
- Review SAML assertion attributes match configuration

#### Users Cannot Access After Enabling Force SSO

- Temporarily disable Force SSO through database if needed
- Ensure at least one admin has SSO access before enabling
- Verify SSO provider is properly configured and tested

### Debug Mode

For troubleshooting, administrators can enable debug logging for SSO:

- Set `SSO_DEBUG=true` in environment variables
- Check application logs for detailed authentication flow
- Review SAML assertions and responses

## Migration Guide

### Transitioning to SSO

1. **Phase 1: Enable SSO alongside traditional login**
   - Configure SSO providers
   - Test with pilot users
   - Allow both authentication methods

2. **Phase 2: Encourage SSO adoption**
   - Communicate changes to users
   - Provide training and documentation
   - Monitor adoption rates

3. **Phase 3: Enable Force SSO (optional)**
   - Ensure all users have SSO access
   - Set grace period for transition
   - Enable Force SSO setting
   - Monitor for issues

### Data Migration

When transitioning existing users to SSO:

- User accounts are matched by email address
- Existing permissions and data are preserved
- Password fields become unused (but not deleted)
- User preferences remain intact

## API Integration

### SSO Status Endpoint

Applications can check SSO configuration:

```bash
GET /api/auth/sso-config
```

Response:

```json
{
  "forceSso": false,
  "providers": [
    {
      "type": "GOOGLE",
      "enabled": true,
      "name": "Google OAuth"
    },
    {
      "type": "APPLE",
      "enabled": true,
      "name": "Apple Sign In"
    },
    {
      "type": "SAML",
      "enabled": true,
      "name": "Corporate SSO"
    }
  ]
}
```

### Programmatic Authentication

For API access with SSO:

- Use API tokens for service accounts
- OAuth tokens for user-context operations
- SAML assertions cannot be used directly for API access

## Compliance

SSO implementation supports various compliance requirements:

- **GDPR**: User data minimization through IdP management
- **SOC 2**: Centralized authentication and audit trails
- **ISO 27001**: Enhanced access control and security
- **HIPAA**: Support for enterprise authentication standards

## Two-Factor Authentication (2FA) Integration

TestPlanIt supports TOTP-based two-factor authentication that can work alongside SSO. Administrators can enforce 2FA policies from the Registration Settings section.

### 2FA Enforcement Options

#### Force 2FA for Non-SSO Logins
- Requires 2FA for users signing in with email/password
- SSO logins (Google, Apple, SAML, Magic Link) are not affected
- Useful when SSO providers handle their own MFA

#### Force 2FA for All Logins
- Requires 2FA for all users, including SSO users
- SSO users must set up and verify 2FA after identity provider authentication
- Provides consistent security across all authentication methods

### SSO and Personal 2FA

When **Force 2FA for All Logins** is disabled:
- Users can optionally enable personal 2FA on their accounts
- Personal 2FA only applies to password-based logins
- SSO logins bypass personal 2FA settings
- A notice is displayed on user profiles to inform users of this behavior

When **Force 2FA for All Logins** is enabled:
- All users must complete 2FA regardless of login method
- Personal 2FA settings are enforced for SSO logins

For detailed 2FA configuration, see [Two-Factor Authentication](./two-factor-authentication.md).

## Future Enhancements

Planned SSO improvements include:

- OpenID Connect (OIDC) support
- Just-in-Time (JIT) provisioning enhancements
- SCIM support for user lifecycle management
- Additional SAML features (encrypted assertions, metadata import)