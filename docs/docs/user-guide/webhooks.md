---
sidebar_label: 'Webhooks'
title: 'Webhooks'
description: Configure inbound and outbound webhooks for real-time integration with external systems
---

# Webhooks

Webhooks let TestPlanIt exchange events with external systems in near-real time. They are configured per project from **Project Settings** → **Webhooks** and come in two flavors:

- **Inbound webhooks** receive events from your issue tracker (Jira, GitHub, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, or MantisBT) so issues linked in TestPlanIt stay in sync without manual refreshes.
- **Outbound webhooks** push TestPlanIt events (test runs, sessions, cases, issues) to a destination URL — typically a Slack channel, an automation tool, or a custom service that consumes a generic HMAC-signed payload.

## Overview

The Webhooks tab is split into two sections:

- **Inbound** — at most one webhook per project, locked to the provider of the project's active issue integration. Receives `issue-created` / `issue-updated` events from the external tracker and triggers a full sync of the linked TestPlanIt issue. If an inbound event references an issue that has not yet been imported, TestPlanIt creates the local issue automatically.
- **Outbound** — any number of destinations per project. Each outbound webhook has its own URL, secret, and event subscription list.

Both kinds share the same activity panel, health badge, and **Send Test** button, so administrators can verify wiring without waiting for real traffic.

## Inbound Webhooks

### Prerequisite: an active Issue Integration

Inbound webhooks are 1:1 with the project's active issue integration. The **Add** button is disabled when the project has no integration assigned, or when its provider does not support inbound webhooks (for example, the **Simple URL** integration is link-only and has no webhook surface).

When no integration is configured, the empty state reads "An Issue Integration is required..." and links to the project's **Issue Integrations** settings. Once an integration is assigned, the empty state changes to "Add one to receive issue updates from your assigned Issue Integration."

### Adding an inbound webhook

1. Navigate to **Project Settings** → **Webhooks**.
2. Click **Add Webhook** in the Inbound section.
3. For Jira, GitHub, GitLab, and Gitea/Forgejo/Gogs, the webhook is created immediately — TestPlanIt mints a random HMAC secret on the server.
4. For Azure DevOps, a credentials form appears. Type the username and password (typically a Personal Access Token used as the password) that the ADO Service Hook will send via Basic authentication.
5. For Redmine and MantisBT, the webhook is created immediately with **no secret** — their webhook plugins cannot sign requests, so the unguessable webhook URL itself is the credential. Treat the URL as a secret and rotate it (delete + recreate) if it leaks.
6. After creation, the webhook URL (and, for the HMAC providers, the secret) is revealed once. Copy it before dismissing the panel — it is not shown again.

### Configuring the external tracker

The reveal panel includes per-provider setup steps. The general flow is:

- **Jira** — In your Jira project's webhook settings, paste the URL, paste the secret as the HMAC signing secret, and subscribe the webhook to issue-created and issue-updated events.
- **GitHub** — In your repository's **Settings** → **Webhooks** page, paste the URL, paste the secret, set Content type to `application/json`, and subscribe to **Issues** events.
- **GitLab** — In your project's **Settings → Webhooks**, paste the URL, paste the secret into the **Secret token** field, and enable the **Issues events** trigger.
- **Gitea / Forgejo / Gogs** — In your repository's **Settings → Webhooks**, add a webhook, paste the URL, paste the secret, set the content type to `application/json`, and enable **Issue** events.
- **Azure DevOps** — Create a Service Hook of type **Web Hooks** for the **Work item updated** (and optionally **Work item created**) events. Paste the URL, then paste the username and password you typed into TestPlanIt as the Basic-Auth credentials.
- **Redmine** — Redmine has no built-in webhooks, so install the [`redmine_webhook`](https://github.com/suer/redmine_webhook) plugin and enable the **Webhooks** module on the project. Then under **Project → Settings → WebHook**, paste the URL. Requests are unsigned, so the URL is the credential — no secret is configured on either side.
- **MantisBT** — MantisBT has no built-in webhooks, so install and enable a MantisBT webhook plugin on the server. Configure it to fire on issue-created and issue-updated events and paste the URL as the target. Requests are unsigned, so the URL is the credential — no secret is configured on either side.

### One webhook per project

A project can have at most one inbound webhook, and that webhook is locked to the same provider as the project's active integration. This guarantees the receiver and the integration's adapter agree on payload shape and authentication.

When the project's integration is switched to a different provider, or removed entirely, the inbound webhook is removed automatically. The confirmation dialog on the **Issue Integrations** page surfaces an extra bullet warning of this whenever an inbound webhook exists, so administrators see the consequence before confirming. After the change, configure a fresh inbound webhook for the new provider if you still want event-driven sync.

### Auto-import of upstream issues

When an inbound event references an external issue that does not yet exist in TestPlanIt, the system imports it automatically as a new local issue. The project's creator (or its current owner of record) is recorded as the issue creator. This means issues filed directly in your external tracker can appear in TestPlanIt's Issues list without any manual import step.

### Milestone sync events (version/sprint)

If your project's [Milestones](./projects/milestones.md) are synced from a tracker's time-based artifacts (Jira **Fix Versions** or **Sprints**), the same inbound webhook that carries issue events can also carry **version** and **sprint** events. When these arrive, TestPlanIt refreshes the linked milestone's fields and issue membership (or converts the milestone to local if the upstream artifact was deleted or merged) without waiting for the next page load or manual sync.

Per-provider capability:

| Provider | Version/sprint events | Notes |
| --- | --- | --- |
| **Jira Cloud** | Full support — `jira:version_created`, `jira:version_updated`, `jira:version_moved`, `jira:version_released`, `jira:version_unreleased`, `jira:version_deleted` (plus `jira:version_deleted` with a `mergedTo` field for merges) and `jira:sprint_created`, `jira:sprint_updated`, `jira:sprint_started`, `jira:sprint_closed`, `jira:sprint_deleted` | These events support **no JQL, field, or property filtering** — unlike issue events, the admin webhook fires for every project on the site once subscribed. TestPlanIt filters to the correct project/board using the event's own payload, so this is safe, but it does mean the admin webhook cannot be scoped to "only this project" for version/sprint traffic. |
| **Jira Data Center** | Same admin webhook mechanism as Cloud | Event names and payload shapes are expected to match Cloud's admin webhook; verify parity against your specific Data Center version if you rely on near-real-time milestone refresh, since self-hosted instances can lag behind Cloud's webhook catalog. |
| **All other providers** (GitHub, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, MantisBT, Simple URL) | Not supported | These trackers don't expose an equivalent time-based-artifact event. Synced milestones on these providers still refresh on page load and via the project's manual **Sync now** action — there is no near-real-time push for milestone changes. |

:::warning Admin prerequisite: subscribe version/sprint events
Version and sprint events are **not** included by default when you subscribe a Jira site webhook to issue events. Your Jira administrator must explicitly add the version and sprint event types to the site webhook's subscribed-events list (in addition to issue-created/issue-updated) before any near-real-time milestone refresh will work. Without this step, synced milestones still work — they just fall back to page-load and manual-sync freshness only, the same as a polling-only provider.
:::

:::note
The 15-second freshness gate and per-milestone lock that already govern manual and page-load sync also apply to webhook-triggered refreshes, so a burst of version/sprint events during a busy sprint boundary can't overwhelm the sync worker.
:::

## Outbound Webhooks

### Adding an outbound webhook

1. Navigate to **Project Settings** → **Webhooks**.
2. Click **Add Webhook** in the Outbound section.
3. Fill in:
   - **Name** — an admin-facing label shown on the card and in delivery logs.
   - **URL** — the destination endpoint. Slack incoming-webhook URLs are auto-detected; everything else is treated as a generic HMAC endpoint.
   - **Subscribed events** — pick events from four sections: Cases, Issues, Test Runs, Sessions. Each section has a **Select all** shortcut.
4. Submit. For generic HMAC endpoints, TestPlanIt mints a signing secret and reveals it once — copy it into your receiving service before dismissing the panel.

Slack endpoints do not use a separate signing secret because Slack incoming webhooks already authenticate via the secret token embedded in the URL. The webhook URL itself is treated as a credential and redacted from logs.

### Subscribed events

Each event name follows a `subject.verb` convention. The reserved verbs are `created`, `updated`, `deleted`, `state_changed`, `completed`, `duplicated`, and `result_added`. Common examples include:

- `test_run.created`, `test_run.state_changed`, `test_run.completed`, `test_run.duplicated`, `test_run.result_added`
- `session.created`, `session.state_changed`, `session.completed`, `session.duplicated`, `session.result_added`
- `case.created`, `case.updated`, `case.deleted`
- `issue.created`, `issue.updated`, `issue.deleted`

Toggling a checkbox saves immediately; a brief check-mark flashes next to the event name to confirm the change reached the server.

### Slack vs generic HMAC

| Feature | Slack | Generic HMAC |
| --- | --- | --- |
| URL detection | Auto-detected from `hooks.slack.com` | Anything else |
| Signing secret | Not used (Slack URL is the credential) | Server-minted, revealed once |
| Payload shape | Slack-formatted message | TestPlanIt's standard event envelope, signed with HMAC-SHA256 |
| Rotation | Replace the URL by deleting and recreating the webhook | Use the **Rotate Secret** button (see below) |

## Health and Monitoring

Each webhook card shows a health badge — **Healthy**, **Degraded**, or **Disabled** — based on the recent delivery outcome.

The state machine is failure-driven:

- A webhook starts **Healthy**. Each consecutive delivery failure increments a counter.
- After five consecutive failures the badge turns **Degraded**.
- After ten consecutive failures the webhook is automatically **Disabled** and stops dispatching. The next attempt would have been delivery 11.
- A single successful delivery resets the counter and returns the webhook to **Healthy**.

Hovering the badge shows the most recent failure or success timestamp.

### Re-enabling a disabled webhook

When a webhook is **Disabled**, its card shows a **Re-enable** button next to **Send Test**. Confirming the dialog clears the failure counter, sets the health back to **Healthy**, and resumes dispatch. Auto-disable will trigger again if failures recur, so make sure the underlying problem (bad URL, expired credential, receiver outage) is fixed before re-enabling.

### Delivery activity

Below the URL each card shows three timestamps:

- **Last dispatched** — when the most recent attempt was made, regardless of outcome.
- **Last success** — when the last 2xx response was received.
- **Last failure** — when the last non-2xx response or transport error occurred.

The values render as human-friendly distances ("3 minutes ago"). "Never" indicates the corresponding event has not happened yet.

## Send Test

The **Send Test** button on each webhook card fires a synthetic event so you can verify the wiring end-to-end. The synthetic payload is byte-identical across clicks, so the second click of a working test reliably hits the receiver's deduplication path. Use this immediately after creating or rotating a webhook to confirm the URL and secret are configured correctly.

For inbound webhooks, the synthetic event uses sentinel identifiers an external tracker cannot legitimately produce, so the receiver short-circuits without affecting any real issue.

## Deliveries

The Webhooks page includes a **Deliveries** tab listing each dispatched attempt with:

- Event name, direction (inbound or outbound), and webhook config.
- HTTP status code and outcome.
- Timestamp.
- A drawer with the request payload preview and response details for diagnostics.

### Replay

Each outbound delivery in the list has a **Replay** action. Clicking it re-enqueues the same event payload for dispatch. The new attempt appears as a fresh delivery row that links back to the original via its replay metadata, so you can audit the chain.

Inbound deliveries cannot be replayed. Inbound delivery rows store only a digest of the payload (not the raw body), and TestPlanIt has no way to fabricate the original signed request from the upstream tracker. The deliveries tab shows an informational note in place of the Replay action for inbound rows.

### Bulk replay

The deliveries page supports selecting multiple rows and replaying them in one batch. The action filters out inbound rows automatically. The hard cap per batch is 100 deliveries; selecting more than 100 surfaces an error rather than partially enqueuing.

## Rotation

Inbound Jira and GitHub webhooks and outbound generic-HMAC webhooks all expose a **Rotate Secret** action. Rotation behavior differs slightly by direction:

- **Inbound (Jira / GitHub)** — Rotation is a hard cutover: a new token and a new HMAC secret are minted, the URL changes (because it embeds the token), and the previous values stop accepting traffic. Update the external tracker's webhook configuration with the new URL and secret immediately after rotating.
- **Outbound (generic HMAC)** — Rotation opens a brief two-secret window. The newly minted secret becomes active immediately, and the previous secret enters a retiring state. Both are accepted by signing logic during the window so receivers have time to re-key. The retiring secret has an auto-retire deadline shown on the card; you can shorten it by clicking **Retire now**, or extend it once if your receiver needs more time.

Inbound Azure DevOps webhooks do not have a separate secret to rotate (the credentials are typed by the admin and stored encrypted). To change ADO credentials, delete the webhook and recreate it. Inbound **Redmine** and **MantisBT** webhooks likewise have no secret — the unguessable URL token is the credential. To rotate it, delete the webhook and recreate it, then update the URL in the tracker.

Plaintext secrets are never read back from the database. They are returned only in the response to the create or rotate action and held in memory until you dismiss the reveal panel.

## Security

- **Encryption at rest** — Inbound HMAC secrets, ADO credentials, outbound HMAC secrets, and Slack URLs (which are themselves credentials) are encrypted with the same key-management infrastructure used elsewhere in the platform.
- **Reveal-once UX** — Plaintext secrets and full webhook URLs (with the embedded token) are shown only once per create or rotate. After dismissal, the URL renders with the token redacted.
- **Redacted logs** — Webhook URLs that contain a token are redacted in application logs. Audit events store webhook config IDs, not secrets.
- **HTTPS-only outbound** — TestPlanIt rejects `http://` URLs when creating outbound webhooks. (A deployment-only environment override exists for E2E test rigs but is not available through the user interface.)
- **Authorization** — Creating, rotating, and deleting webhooks requires a project-admin role on the target project.

## Live updates from inbound webhooks

When an inbound webhook arrives, TestPlanIt syncs the affected issue (or, for a synced milestone, the affected version/sprint — see [Milestone sync events](#milestone-sync-events-versionsprint) above) and pushes a scoped update event over a Server-Sent Events stream. Issue badges, lists, popovers, and detail views — and, for Milestones, the milestones list, milestone detail fields/badge/member table, and coverage — in any open browser tab update in near-real time without a manual refresh.

:::note Redmine status timing

TestPlanIt re-fetches the issue from the tracker on each inbound event. The `redmine_webhook` plugin sends its event from within Redmine's save hook (before the change commits), so an immediate re-fetch can briefly read the previous status; it self-corrects on the next event or sync. This is a limitation of the plugin's timing, not of the integration — other trackers send events after their change commits.

:::

The Issues SSE stream is project-scoped (`/api/issues/stream?projectId=<id>`); Milestones use a similar pair of per-milestone and per-project streams. Both share the long-lived-stream ingress requirements documented for in-app notifications. Operators deploying behind a load balancer should review [SSE Notifications and Live Updates](../sse-notifications.md) to make sure all of these streams are configured correctly.

## Reference

- **Inbound URL pattern** — `https://<your-testplanit-host>/api/webhooks/<token>`. The token is the only identifier the receiver needs; the URL itself authenticates the request alongside the provider's signature (HMAC for Jira / GitHub / Gitea, secret token for GitLab) or Basic-Auth credentials (ADO). For **Redmine** and **MantisBT**, the URL token is the sole credential — their webhook plugins send no signature.
- **Outbound payload signing** — Generic HMAC endpoints receive the JSON envelope and an HMAC-SHA256 signature header derived from the body and the active secret.
- **Bulk replay cap** — 100 deliveries per batch.
- **Auto-disable threshold** — 10 consecutive failures.
