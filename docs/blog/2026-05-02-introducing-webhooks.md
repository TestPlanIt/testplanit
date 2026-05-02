---
slug: introducing-webhooks
title: "Introducing Webhooks: Two-Way Sync with Your Issue Tracker and Anywhere Else"
description: "TestPlanIt v0.24.0 ships a full webhook system. Linked issues stay in sync with Jira, GitHub, and Azure DevOps in real time, and TestPlanIt events fan out to Slack or any signed URL the moment they happen."
authors: [bdermanouelian]
tags: [release, announcement, integration]
---

Until now, the link between a TestPlanIt test case and a Jira ticket worked one direction at a time. You could click **Sync** to pull the latest status, or wait for the on-demand refresh. If a developer moved a ticket while you were running a test session, you wouldn't know until you went looking. And on the other side, telling Slack that a regression run failed, or letting a custom service know that a milestone closed, meant writing custom integration code that nobody had time to write.

This release ships **webhooks**. Issues sync the moment they change in your tracker, badges and lists update live without a page refresh, and TestPlanIt events fan out to Slack or any signed URL automatically.

<!-- truncate -->

## Inbound Webhooks: Issues That Just Stay Current

Connect an inbound webhook to your project's issue integration and the conversation flips from pull to push. When someone updates a Jira ticket, a GitHub issue, or an Azure DevOps work item, the linked TestPlanIt issue updates within seconds. Status badges flip color. Lists reorder. Detail panes refresh themselves while you're still on the page.

If an event comes in for an issue that hasn't been imported yet, TestPlanIt creates it for you. No empty states, no "issue not found," no manual import.

Setup is a few clicks per project. TestPlanIt walks you through it for each provider.

## Outbound Webhooks: Push Anywhere

Outbound webhooks go the other way. Test runs, sessions, cases, and issue activity all become events you can ship to any URL.

Two destinations are supported on day one:

- **Slack.** Paste a Slack channel URL and TestPlanIt posts formatted updates with links back to the relevant page. Great for QA channels that want a feed of run completions or regression failures.
- **Any signed HTTPS URL.** Point at a CI gate, a dashboard, an automation tool, or anything else that can verify a signed POST. The receiver gets a JSON payload signed with a shared secret you control.

Each project can run as many outbound webhooks as it needs. Pick which event types each one subscribes to. Want a "regressions only" Slack post and a separate "everything" feed to a custom dashboard? Two configs, done.

## Live UI Updates

Inbound webhooks would be half a feature if you still had to refresh the page to see the result. So you don't. Every browser tab viewing a project receives updates the instant TestPlanIt does, with no extra clicks.

If your deployment was already configured for our existing real-time notifications, this works out of the box. If not, [the deployment doc](/docs/sse-notifications) covers what's needed.

## Health, Deliveries, and Replay

A webhook that silently fails for a week is worse than no webhook. Every webhook gets a **health badge** (Healthy, Degraded, or Disabled), a **delivery log** showing recent activity and any errors, and a **Replay** button on outbound deliveries so a Slack outage or transient 502 doesn't lose a notification permanently. Bulk replay is available too. If an endpoint goes dark long enough to auto-disable, one click brings it back.

## Security Defaults That Mean It

Webhook security is the kind of thing teams either nail on day one or paper over forever. We picked the former.

- Secrets are encrypted at rest and only revealed once at creation, so a leaked log doesn't expose them.
- Webhook URLs containing access tokens are redacted before they ever hit a log file.
- Outbound URLs are HTTPS-only.
- Every outbound payload is signed; replay attacks are blocked by deduplication.
- Rotating an outbound secret is a zero-downtime operation: the new secret takes effect immediately while the old one stays valid until you retire it.

If you switch your project's issue integration to a different provider, or remove the integration entirely, the inbound webhook is removed in the same step. This stops a stale webhook from sitting around for a provider it no longer matches.

## Getting Started

Webhooks live under **Project Settings** → **Webhooks**. The full per-provider walkthrough, including the exact events to subscribe to in Jira, GitHub, Azure DevOps, and Slack, lives in the [webhooks user guide](/docs/user-guide/webhooks).

## Upgrade to v0.24.0

Pull the latest, install, generate, and build. Docker users can pull the latest image. Full upgrade steps and notes for SSE-aware deployments are in the [release notes](/docs/) and [SSE deployment guide](/docs/sse-notifications).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!
