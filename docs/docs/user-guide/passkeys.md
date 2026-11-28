---
sidebar_label: 'Passkeys'
title: Passkeys
description: Sign in to TestPlanIt with a passkey instead of a password
---

# Passkeys

A passkey lets you sign in with your device's fingerprint reader, face recognition or PIN instead of typing your password. The passkey is stored by your device or password manager, and it only works on the TestPlanIt address it was created for.

A passkey is an additional way to sign in. Your password keeps working alongside it.

## Requirements

- TestPlanIt is served over HTTPS, or on `localhost`. Passkeys are not available when the application is reached over plain HTTP or by IP address.
- Your browser and device support passkeys.
- Your account has a password of its own: the **Internal** and **Email & SSO** authentication methods. **SSO Only** and **SCIM Provisioned** accounts cannot use passkeys.
- An administrator has left **Passkeys** enabled, and **Force SSO Login** is off.

## Adding a Passkey

1. Open your [profile](./user-profile.md) and find **Passkeys** at the bottom of the **Account** section.
2. Click **Add Passkey**.
3. Enter a name for the passkey, such as the device it lives on.
4. Enter your current password. If you use [two-factor authentication](./two-factor-authentication.md), also enter a code from your authenticator app.
5. Click **Add Passkey** and follow your browser's prompt.

The new passkey appears in the list with the date it was created and the date it was last used. An account can hold up to 10 passkeys.

:::note
You must be fully signed in to add a passkey. If you still have to finish a 2FA step or a required password change, complete that first.
:::

## Signing In with a Passkey

1. On the sign-in page, click **Sign in with a passkey**.
2. Choose the passkey in your browser's prompt and confirm with your fingerprint, face or PIN.

You do not enter an email address or a password. A passkey sign-in:

- Is not asked for a 2FA code, including when an administrator requires 2FA for all logins.
- Works while your password is locked out after too many failed attempts.

## Removing a Passkey

1. Open your profile and find **Passkeys** at the bottom of the **Account** section.
2. Click the delete icon next to the passkey and confirm.

The passkey stops signing in to TestPlanIt immediately. It stays on the device or password manager that holds it until you delete it there.

## Administrator Guide

### Turning Passkeys On or Off

Passkey sign-in is on by default. To change it, navigate to **Admin → Authentication → Authentication** and flip the **Passkeys** switch in the [Sign-in Providers](./sso.md#passkeys) table. The row shows **Configured** when the application is served over HTTPS or on `localhost`.

While the setting is off:

- The **Sign in with a passkey** button is hidden and passkey sign-ins are refused.
- Users cannot add passkeys.
- Existing passkeys are kept. Users can still see and remove them, and they work again when the setting is turned back on.

Passkeys are also unavailable for as long as **Force SSO Login** is on.

### Removing a User's Passkeys

- Open the user's profile and remove individual passkeys under **Passkeys** in the **Account** section. Administrators can remove another user's passkeys but cannot add one for them.
- [Revoke Password](./security-settings.md#revoke-password) removes all of the user's passkeys along with the password.
- Deactivating or deleting a user through [SCIM](./scim.md) removes their passkeys.

Changing or resetting a password does not remove passkeys. After a suspected account compromise, review the user's passkeys and remove any that are not theirs.

### Changing the Application Address

Passkeys are bound to the hostname in `APP_URL` (or `NEXTAUTH_URL`). If that hostname changes, existing passkeys stop working. Users sign in with their password and add new passkeys at the new address.

Changing only the path prefix of a [subpath deployment](../subpath-deployment.md) keeps existing passkeys working.

### Several Installs on One Host

A browser files passkeys under the host name, not the path. When more than one TestPlanIt install is served from the same host under different path prefixes:

- Each install keeps its own passkeys. Adding a passkey on one install never replaces a passkey from another, even when both hold the same user accounts.
- The browser lists the passkeys of every install on that host together. On an install under a path prefix, each passkey's account name ends with the prefix, for example `pat@example.com (/testplanit)`, so users can tell them apart.

### Audit Log

The [Audit Log](./audit-logs.md) records:

| Action | Description |
| -------- | ------------- |
| `PASSKEY_REGISTERED` | A user added a passkey |
| `PASSKEY_REMOVED` | A passkey was removed by its owner or an administrator |
| `LOGIN` | A successful passkey sign-in, with `provider: passkey` |
| `LOGIN_FAILED` | A refused passkey sign-in or a failed identity check while adding a passkey, with `provider: passkey` and the reason |

## Troubleshooting

### The "Sign in with a passkey" button is missing

The button is hidden when any of the following is true:

- TestPlanIt is not served over HTTPS or `localhost`.
- The browser does not support passkeys.
- An administrator switched **Passkeys** off.
- **Force SSO Login** is on.

### "That passkey could not be used to sign in"

- The passkey was removed from the account.
- The account was deactivated, or its authentication method no longer allows passkeys.
- The application's address changed since the passkey was created.

Sign in another way, then add a new passkey from your profile.

### "Passkeys are set up for a different address"

The address in the browser does not match the application URL TestPlanIt is configured with (`APP_URL`, or `NEXTAUTH_URL`), including the scheme and the port. Open TestPlanIt at its configured address, or have an administrator correct the setting. The server log records both addresses.

### "Set a password before adding a passkey"

The account has no password, for example after an administrator revoked it. Set a password from your profile, then add the passkey.

## Related Documentation

- [Security Settings](./security-settings.md)
- [Two-Factor Authentication](./two-factor-authentication.md)
- [Device-Bound Magic Link Sign-In](./passwordless-sign-in.md)
- [Single Sign-On](./sso.md)
