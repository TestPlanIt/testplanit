---
slug: password-policy-security-hardening
title: "Password Policy & Security Hardening"
description: "TestPlanIt v0.22.0 adds a dedicated Security admin page with configurable password policies, account lockout, forced password changes, password revocation, and a real-time password strength indicator."
authors: [bdermanouelian]
tags: [release, announcement, security]
---

TestPlanIt v0.22.0 introduces a dedicated **Security** page in the admin panel, giving administrators full control over password policy, account lockout rules, and enforcement actions — plus a real-time password strength indicator for end users.

<!-- truncate -->

## Why a Security Page?

Until now, password requirements were limited to a minimum length check during signup. There was no way to enforce character complexity, prevent password reuse, expire old passwords, or lock out accounts after failed login attempts.

For teams managing sensitive test data — especially those working toward SOC 2 or ISO 27001 compliance — these are table-stakes controls. v0.22.0 fills that gap with a single admin page that covers the full lifecycle of password security.

## What's New

### Configurable Password Policy

Navigate to **Admin → Security** to configure:

- **Minimum password length** (8–128 characters)
- **Character requirements** — uppercase, lowercase, numbers, and custom special characters
- **Password history** — prevent reuse of the last N passwords (up to 24)
- **Password expiration** — force password changes after a configurable number of days (up to 365)

All settings use slider controls for quick adjustment, with the current value displayed alongside each slider.

### Account Lockout

Protect against brute-force attacks with configurable lockout rules:

- **Lockout threshold** — lock accounts after 1–20 consecutive failed attempts
- **Lockout duration** — keep accounts locked for 1–60 minutes

### Enforcement Actions

Sometimes you need to act immediately — after a security incident, a compliance audit, or when offboarding a user from credential-based access.

- **Force Password Change** — require an individual user or all internal users to set a new password on their next login. Available from the user table's three-dot menu and as a bulk action on the Security page.
- **Revoke Password** — remove a user's password entirely, limiting them to SSO or Magic Link authentication. Useful for transitioning users away from password-based login.

Both actions include confirmation dialogs, guard against self-lockout (you can't force-change or revoke your own password), and are fully audit-logged.

### Password Strength Indicator

Every password form — signup, change password, and forced password change — now displays a real-time strength indicator:

- A **four-level strength bar** (Weak, Fair, Strong, Very Strong) powered by [zxcvbn](https://github.com/zxcvbn-ts/zxcvbn), which evaluates password strength using pattern matching and entropy estimation rather than simple rule checks
- A **policy checklist** that shows which requirements are met as the user types

This gives users immediate, actionable feedback before they submit — reducing failed submissions and encouraging stronger passwords.

## Server-Side Enforcement

All policy checks are enforced server-side, not just in the UI. The password validation pipeline runs on every password change endpoint, checking minimum length, character classes, special characters, and password history. Slider ranges in the UI match the server-side validation bounds, so there's no mismatch between what the admin configures and what the server enforces.

## Try It Out

Upgrade to v0.22.0 and navigate to **Admin → Security** to configure your password policy. See the [Security Settings documentation](/docs/user-guide/security-settings) for a full walkthrough of every setting.
