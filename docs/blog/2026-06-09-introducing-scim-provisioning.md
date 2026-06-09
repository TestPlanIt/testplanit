---
slug: introducing-scim-provisioning
title: "Introducing SCIM 2.0: Your IdP Just Got the Keys"
description: "TestPlanIt v0.24.0 ships SCIM 2.0 provisioning. New hires get accounts on day one without anyone clicking 'Add User.' Departures take effect the moment HR closes the loop. Group membership shifts with reorgs. Audit trails write themselves."
authors: [bdermanouelian]
tags: [release, announcement, integration]
---

You hire someone. HR adds them to your identity provider. They walk into the office on Monday, sit down, open their laptop, and TestPlanIt is already there waiting for them — the right groups already attached, no "hey can you add me to the right project?" Slack DM.

That's the picture with SCIM 2.0. SAML put your IdP in charge of who can sign in to TestPlanIt; SCIM puts your IdP in charge of who exists at all.

<!-- truncate -->

## Where SAML Left Off

SAML has been in TestPlanIt for a while now, and if you've got it wired up to Okta, Entra, or any other IdP, sign-in is already a solved problem. New hires use their corporate account. Departures lose access the moment their IdP account is disabled.

SAML answers _who can sign in_. It doesn't answer _who exists, who they're grouped with, and whether they're active right now_.

The first time a user signs in via SAML, TestPlanIt creates an account for them — that's auto-provisioning. From that point on, the row is TestPlanIt's. Their group memberships are something an admin picked in TestPlanIt. Their role is something an admin picked in TestPlanIt. When someone changes teams or gets promoted, somebody opens **Admin → Users** and clicks. When someone leaves, the IdP closes the sign-in door, but the TestPlanIt row stays active and visible until an admin flips it inactive or deletes it. Audit history isn't at risk either way — TestPlanIt has always soft-deleted users so attribution survives — but somebody had to remember to do the tidy-up.

SCIM closes the gap. Where SAML gives the IdP the keys to the front door, SCIM gives it the keys to the user list. New hires get added. Group changes flow through. Departures get marked inactive automatically. The row still sticks around for audit purposes; it just stops showing up in active-user pickers without anyone clicking.

## What That Buys You

Your identity provider — Okta, Microsoft Entra, OneLogin, anything that speaks SCIM 2.0 — keeps TestPlanIt's user list in sync the same way it keeps every other enterprise tool's user list in sync. New hires show up in TestPlanIt automatically the instant they're added to the right IdP group, with the right groups already attached. Departures flip to inactive the moment HR closes the loop in the IdP. Reorgs that move someone from QA to Engineering shift their TestPlanIt group membership without anyone touching TestPlanIt.

You stop maintaining TestPlanIt's user list and start letting the IdP do its job — same way you already do for the other twenty SaaS tools in your stack.

## What Changes for Admins

A lot less work. A few specific things to know:

**You won't accidentally rename a SCIM-managed user.** The Users and Groups admin pages add a small **SCIM** badge to anyone provisioned through the IdP, and the edit / delete / password actions go quiet for those rows. The IdP is the source of truth — if you need to change a SCIM user, change them where they came from. The lockdown isn't there to restrict you; it's there to prevent the kind of two-system disagreement that takes hours to debug because everything looks correct in isolation.

**Your auditors get a clean answer.** "How do you provision and deprovision users?" — "SCIM 2.0, here's the audit log filtered to the SCIM source, here's the originating token, here's every change with a timestamp." Done.

**Bulk sync won't blow up your Slack channel.** The first time your IdP runs a full push — 2,000 new users on Monday morning — the outbound webhook system folds the flood into summary events instead of 2,000 individual Slack pings. Routine day-to-day syncs stay 1:1.

**Setup is one page.** Mint a token at **Admin → Authentication → SCIM Provisioning**, paste it into your IdP, click **Test SCIM**. If the test reports green, your IdP is going to work. If it reports red, you find out now instead of when payroll's 6 AM new-hire push runs and you have to explain why three people don't have access on their first day.

## What Doesn't Change

The good stuff. TestPlanIt is still TestPlanIt — the test cases, the runs, the sessions, the integrations, the reports, your data. SCIM only takes over the identity layer. Local accounts still work for the cases where they should (your demo logins, your admin-of-last-resort, your "we don't have an IdP" deployments). Self-registration, Magic Link, SSO — none of it goes away. SCIM is opt-in, layered on top.

## Who This Is For

If you're at a 50-person company already signing in via Okta SAML, SCIM is the obvious next step. The day you connect it, your onboarding checklist gets a line shorter, your offboarding cleanup goes from "check TestPlanIt for stale accounts" to "nothing to check," and group memberships stop being a thing somebody has to remember to set.

If you're at a 500-person company, the manual user management was already untenable. SCIM is the version of TestPlanIt you can stand behind in a security review.

If you're at a 5-person company, you probably don't need SCIM yet. We're still glad to have you. The local sign-up flow is right where you left it.

## How to Get It

1. Update to TestPlanIt v0.24.0.
2. Open **Admin → Authentication → SCIM Provisioning** and mint a token.
3. Drop the token into your IdP's SCIM connector — Okta, Entra, and OneLogin all work out of the box, and any other spec-compliant client will too.
4. (Optional) Subscribe a Slack channel or a custom HMAC endpoint to the SCIM lifecycle events at **Admin → Authentication → System Webhooks** so provisioning activity mirrors into your existing ops channels. Same machinery as the [project-level webhooks](/blog/introducing-webhooks), just scoped to system events.

Full setup walkthroughs for the three IdPs we tested most heavily live at [SCIM Provisioning](/docs/user-guide/scim) in the docs.
