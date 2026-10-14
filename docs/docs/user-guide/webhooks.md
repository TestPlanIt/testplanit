---
sidebar_label: 'Webhooks'
title: 'Webhooks'
description: Configure inbound and outbound webhooks for real-time integration with external systems
---

# Webhooks

Webhooks let TestPlanIt exchange events with external systems in near-real time. They are configured per project from **Project Settings** → **Webhooks** and come in two flavors:

- **Inbound webhooks** receive events from your issue tracker (Jira, GitHub, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, MantisBT, or ClickUp) so issues linked in TestPlanIt stay in sync without manual refreshes.
- **Outbound webhooks** push TestPlanIt events (test runs, sessions, cases, issues) to a destination URL — typically a Slack channel, an automation tool, or a custom service that consumes a generic HMAC-signed payload.

## Overview

The Webhooks tab is split into two sections:

- **Inbound** — at most one webhook per project, locked to the provider of the project's active issue integration. Receives `issue-created` / `issue-updated` events from the external tracker and triggers a full sync of the linked TestPlanIt issue. If an inbound event references an issue that has not yet been imported, TestPlanIt creates the local issue automatically.
- **Outbound** — any number of destinations per project. Each outbound webhook has its own URL, secret, and event subscription list.

Both kinds share the same activity panel, health badge, and **Send Test** button, so administrators can verify wiring without waiting for real traffic.

## Inbound Webhooks

An inbound webhook lets an external system push events into TestPlanIt. Two kinds of system can send them:

- **Issue tracker** — the project's active [Issue Integration](./integrations.md) sends issue updates that keep linked issues in sync.
- **Code repository** — a repository connected under **Project Settings → Impact Analysis** sends pull request and push events that start an [Impact Analysis](impact.md) and compose a test run. See [Repository Webhooks](#repository-webhooks).

Both kinds are added with the same **Add inbound webhook** button on the **Inbound** tab and listed together beneath it, one card per webhook.

### Adding an inbound webhook

1. Navigate to **Project Settings** → **Webhooks**.
2. Click **Add inbound webhook**. A three-step wizard opens.
3. **Source** — choose **Issue tracker** or **Code repository**. An option that cannot be used yet says why: the project has no issue integration (or its provider has no webhook surface, such as **Simple URL**), the issue-tracker webhook already exists, no repository is connected for Impact Analysis, or every connected repository already has a webhook.
4. **Configure** — for an issue tracker, the wizard names the provider the webhook will verify. For a repository, choose the repository (when several are connected), optionally set the base branch pushes compare against, and switch the **Pull requests**, **Pushes** and **Pushes to other branches** events on or off; each event switched on becomes a **Create Test Run** action on the new webhook. Azure DevOps, for either source, asks for the username and password (typically a Personal Access Token as the password) that the Service Hook will send via Basic authentication. ClickUp offers an optional secret field: leave it blank to have TestPlanIt register the webhook in ClickUp for you, or paste the secret ClickUp returned if you created the webhook yourself. Click **Create webhook**.
5. **Connect** — the webhook URL and, for providers that sign requests, the secret are shown once, together with setup steps for the provider. Copy them before clicking **Done**; they are not shown again.

For Jira, GitHub, GitLab, Gitea/Forgejo/Gogs and Bitbucket, TestPlanIt mints a random HMAC secret on the server. For ClickUp the secret is minted by ClickUp when the webhook is registered; TestPlanIt stores it encrypted and never shows it. Redmine and MantisBT webhooks have **no secret** — their webhook plugins cannot sign requests, so the unguessable webhook URL itself is the credential. Treat the URL as a secret and rotate it (delete + recreate) if it leaks.

### Configuring the external tracker

The Connect step includes per-provider setup steps. The general flow is:

- **Jira** — In your Jira project's webhook settings, paste the URL, paste the secret as the HMAC signing secret, and subscribe the webhook to issue-created and issue-updated events.
- **GitHub** — In your repository's **Settings** → **Webhooks** page, paste the URL, paste the secret, set Content type to `application/json`, and subscribe to **Issues** events.
- **GitLab** — In your project's **Settings → Webhooks**, paste the URL, paste the secret into the **Secret token** field, and enable the **Issues events** trigger.
- **Gitea / Forgejo / Gogs** — In your repository's **Settings → Webhooks**, add a webhook, paste the URL, paste the secret, set the content type to `application/json`, and enable **Issue** events.
- **Azure DevOps** — Create two Service Hooks of type **Web Hooks**, one for **Work item created** and one for **Work item updated**. In each, paste the URL, then paste the username and password you typed into TestPlanIt as the Basic-Auth credentials.
- **Redmine** — Redmine has no built-in webhooks, so install the [`redmine_webhook`](https://github.com/suer/redmine_webhook) plugin and enable the **Webhooks** module on the project. Then under **Project → Settings → WebHook**, paste the URL. Requests are unsigned, so the URL is the credential — no secret is configured on either side.
- **MantisBT** — MantisBT has no built-in webhooks, so install and enable a MantisBT webhook plugin on the server. Configure it to fire on issue-created and issue-updated events and paste the URL as the target. Requests are unsigned, so the URL is the credential — no secret is configured on either side.
- **ClickUp** — ClickUp has no webhook settings page; webhooks are created through its API and ClickUp mints the signing secret. Leave the secret blank in the wizard and TestPlanIt registers the webhook with ClickUp for the project's linked List using your own ClickUp authorization (authorize the integration first), subscribed to the `taskCreated` and `taskStatusUpdated` events. If you create the webhook yourself with ClickUp's **Create Webhook** API, subscribe it to the same two events, point it at the URL, and paste the secret ClickUp returned instead. Deleting the TestPlanIt webhook removes a registration TestPlanIt made; rotating the secret registers a fresh one. A registration that listens for `taskStatusUpdated` alone never hears about new tasks; rotate the secret to register it for both events.

### One issue-tracker webhook per project

A project can have at most one issue-tracker webhook, and that webhook is locked to the same provider as the project's active integration. This guarantees the receiver and the integration's adapter agree on payload shape and authentication.

When the project's integration is switched to a different provider, or removed entirely, the inbound webhook is removed automatically. The confirmation dialog on the **Issue Integrations** page surfaces an extra bullet warning of this whenever an inbound webhook exists, so administrators see the consequence before confirming. After the change, configure a fresh inbound webhook for the new provider if you still want event-driven sync.

### Issue tracker actions

The issue-tracker webhook's card lists its **Actions**, which say what TestPlanIt does when the tracker reports an issue event. They work like a [repository webhook's actions](#actions): **Add** one, change it with the pencil, turn it off with its switch, and drag the handle to reorder. Each action shows what it last did. Actions run in the background once the webhook has been answered.

Every action has a **Trigger**:

- **Any issue event** — any event the tracker sends about an issue.
- **Issue created** — an issue TestPlanIt hasn't seen before.
- **Issue status changes** — an issue moves into one of the action's statuses. Choose at least one status; an issue created directly in one of them counts too.

and an **Action**:

- **Import Issues** — add the issue to the project, so issues filed in the tracker appear in TestPlanIt's Issues list (and on Requirements, when the project classifies them as requirements) without a manual import. An issue TestPlanIt already has is always kept up to date, with or without an import action.
- **Create Test Run** — create a test run of the test cases linked to the issue, named after it (`DEMO-42: Checkout with saved card`) and linked to it, with the issue and the action in its description. Turn on **Include child issues** to also take the cases linked to the issue's child issues. A run is only created when there are cases to take; drafts are left out when the project excludes them. The run can also be [executed automatically](#executing-automated-cases).
- **Generate Test Cases with AI** — draft test cases for the issue with the project's [AI model](./llm-integrations.md), the way the repository's Generate wizard does, from the issue's title, description, status and priority. Choose the **Template** and **State** the drafts take (the project's defaults when unset), how many to draft (the Generate wizard's ranges), whether to auto-generate tags (on unless switched off), and the **Users** and **Groups** to tell when the drafts are ready; each person's notification preferences still apply. The drafts go in a top-level folder named after the action (`Issue status changes → Generate Test Cases with AI · To Do`), one folder per action, whose note records the webhook, trigger, filters, template and state that fill it. Drafting runs as its own background job, so a slow model never holds up the other actions. An issue that already has linked test cases is left alone, so a status action never drafts twice for the same issue, and the action can't be saved for a project without an active AI model.

**Filters** narrow which issues an action takes: **Statuses** (the tracker's own status names, suggested from the issues the project already holds; type a name to add one it doesn't), **Issue types**, **Labels** (an issue with any of them matches), and **Requirements only**. An empty filter matches every issue.

New issue-tracker webhooks start with an **Any issue event → Import Issues** action, so issues the tracker reports are imported as before; delete it, or add filters, to import fewer. Imported issues, created runs and drafted test cases are recorded as made by the built-in **System** user; drafts link to the issue they came from, and each reviewer named on the action gets an **AI-drafted test cases** notification linking to the folder.

### Milestone sync events (version/sprint)

If your project's [Milestones](./projects/milestones.md) are synced from a tracker's time-based artifacts (Jira **Fix Versions** or **Sprints**), the same inbound webhook that carries issue events can also carry **version** and **sprint** events. When these arrive, TestPlanIt refreshes the linked milestone's fields and issue membership (or converts the milestone to local if the upstream artifact was deleted or merged) without waiting for the next page load or manual sync.

Per-provider capability:

| Provider                                                                                                           | Version/sprint events                                                                                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Jira Cloud**                                                                                                     | Full support — `jira:version_created`, `jira:version_updated`, `jira:version_moved`, `jira:version_released`, `jira:version_unreleased`, `jira:version_deleted` (plus `jira:version_deleted` with a `mergedTo` field for merges) and `jira:sprint_created`, `jira:sprint_updated`, `jira:sprint_started`, `jira:sprint_closed`, `jira:sprint_deleted` | These events support **no JQL, field, or property filtering** — unlike issue events, the admin webhook fires for every project on the site once subscribed. TestPlanIt filters to the correct project/board using the event's own payload, so this is safe, but it does mean the admin webhook cannot be scoped to "only this project" for version/sprint traffic. |
| **Jira Data Center**                                                                                               | Same admin webhook mechanism as Cloud                                                                                                                                                                                                                                                                                                                 | Event names and payload shapes are expected to match Cloud's admin webhook; verify parity against your specific Data Center version if you rely on near-real-time milestone refresh, since self-hosted instances can lag behind Cloud's webhook catalog.                                                                                                           |
| **All other providers** (GitHub, GitLab, Gitea/Forgejo/Gogs, Azure DevOps, Redmine, MantisBT, ClickUp, Simple URL) | Not supported                                                                                                                                                                                                                                                                                                                                         | These trackers don't expose an equivalent time-based-artifact event. Synced milestones on these providers still refresh on page load and via the project's manual **Sync now** action — there is no near-real-time push for milestone changes.                                                                                                                     |

:::warning Admin prerequisite: subscribe version/sprint events
Version and sprint events are **not** included by default when you subscribe a Jira site webhook to issue events. Your Jira administrator must explicitly add the version and sprint event types to the site webhook's subscribed-events list (in addition to issue-created/issue-updated) before any near-real-time milestone refresh will work. Without this step, synced milestones still work — they just fall back to page-load and manual-sync freshness only, the same as a polling-only provider.
:::

:::note
The 15-second freshness gate and per-milestone lock that already govern manual and page-load sync also apply to webhook-triggered refreshes, so a burst of version/sprint events during a busy sprint boundary can't overwhelm the sync worker.
:::

## Repository Webhooks

A second kind of inbound webhook comes from the application's **code repositories** rather than from an issue tracker. When a project has [Impact Analysis](impact.md) enabled, each repository connected under **Project Settings → Impact Analysis** can send pull request and push events to TestPlanIt. An event starts an analysis when one of the webhook's [actions](#actions) is triggered by it, and each matching action turns the analysis's affected tests into a new test run.

### Adding a repository webhook

1. Navigate to **Project Settings** → **Webhooks**, **Inbound** tab, and click **Add inbound webhook**.
2. Choose **Code repository** as the source. A project with several repositories gets one webhook per connection; the wizard lists the connections that do not have one yet.
3. Pick the repository, optionally set the **base branch**, switch the **Pull requests**, **Pushes** and **Pushes to other branches** events on or off, and click **Create webhook**. Each event switched on becomes a **Create Test Run** action. GitHub, GitLab, Gitea and Bitbucket webhooks get a server-minted secret; Azure DevOps asks for the username and password the Service Hook will send.
4. Copy the URL (and secret) from the Connect step; they are shown once. The step names the events to enable on the provider side.

### Events

- **Pull requests** — when a pull request is **opened** (or reopened), TestPlanIt compares the merge base of its target branch with the pull request head and runs the analysis. A run composed from it is named after the pull request (`PR #12: Fix checkout`). Later pushes to the pull request do not start another analysis; open the run's analysis and refine it, or reopen the pull request.
- **Pushes** — a push to the **base branch** compares the push's `before` and `after` commits. A run composed from it is named after the range (`main abc1234…def5678`). When the pushed head commit is the provider's merge or squash commit for a pull request, the run is named after both (`main abc1234…def5678 (PR #12: Fix checkout)`) and its note links to the pull request as well as to the compare page. Branch creations and deletions are ignored.
- **Pushes to other branches** — a push to any other branch is compared against the base branch the way a pull request is: from the merge base with the base branch to the pushed head. Every push then produces an analysis and a run, so add an action for this event only when you want a run per push; without one, a pull request's feature branch does not produce a second run alongside the pull request's own.

The **base branch** is set on the webhook's card and defaults to the connection's branch under Impact Analysis (or the repository default when none is configured). Set it when the branch you integrate on differs from the one the connection tracks. An event no enabled action is triggered by is recorded and ignored.

### Actions

The **Actions** list on the webhook's card says what TestPlanIt does with each event. Every action has a **Trigger** and an **Action**; a repository webhook's actions create a test run. Click **Add** to add one, the pencil to change one, and the switch to turn one off without removing it. Actions run in the order listed; drag an action's handle to reorder them. Each action shows what it last did, with a link to the run it created.

A **Create Test Run** action takes the tests the analysis puts in the **pinned** and **affected** tiers, the same tests a run started by hand selects to begin with. To take more or fewer, set a **Minimum score**: the run then holds every test the analysis scores at or above that number (0–100), whatever its tier, so a low value also pulls in related tests and a high one keeps only the strongest matches. Leave it empty to use the tiers. The score each test received stays visible on the run's analysis, so a threshold can be tuned from the analyses the webhook has already produced. When the project excludes draft cases from runs, drafts are left out.

A run is only created when the analysis finds at least one test to take; otherwise the action and the delivery say so. The run is created by the built-in **System** user, in the project's default run state, with the event's links in its note (the pull request, or a push's compare page and the pull request it merged), and the first run made from an analysis is linked to it as if a reviewer had accepted every affected test. Each action creates one run per analysis: when the same change arrives again (a reopened pull request, or a commit range analyzed recently), the action reports the run it already made instead of creating another. Two actions triggered by the same event each create their own run, which lets one event produce, say, a narrow run of the strongest matches and a broader one.

### Executing automated cases

A **Create Test Run** action can also send its run for [automated execution](automated-execution.md) as soon as it exists, the way **Execute automated cases** on the run would. In the action, turn on **Execute automated cases**, choose the [execution target](automated-execution.md), optionally a branch or ref (blank uses the target's default branch), and the values of the target's parameters. Like the target's own inputs, these values are stored and sent to the CI system in the clear, so never put a token in them. The option is unavailable until the project has an enabled execution target, and is turned off when the target it used is deleted or disabled and no other enabled target remains. An action whose target is gone shows its target badge in red; hover it to see why.

The run is then requested on that target, covering its automated cases; manual cases stay in the run for testers. Nothing is requested when the run has no automated cases, or when the target has been deleted or disabled since the action was saved; the action keeps the target and warns that it is gone until you choose another. When no execution is requested, the delivery records the reason (`execute:no_automated_cases`, `execute:target_not_found`, `execute:target_disabled`). The request also follows the same limits as the run's **Execute** button: a run that is already completed or already executing records `execute:run_completed` or `execute:execution_in_progress`, and a project past its execution rate limit records `execute:rate_limited`.

### Deliveries

Repository deliveries appear on the **Deliveries** tab like any other. The subject moves from the event (`pull_request:12`, `push:main`) to the analysis (`analysis:77`) and then to the run (`run:300`); a delivery that was received but not acted on carries the reason (`ignored:push_other_branch`, `ignored:event_disabled`, `ignored:no_affected_cases`, `execute:target_not_found`, `duplicate`). A change with nothing to compare, such as a pull request whose head is already on its target branch, is recorded as `ignored:same_commit` (or `ignored:ref_not_found` when a commit can't be found) and answered with success, so the repository doesn't keep retrying it.

### Provider setup

- **GitHub / Gitea** — repository **Settings → Webhooks**: paste the URL and secret, content type `application/json`, events **Pull requests** and **Pushes**.
- **GitLab** — project **Settings → Webhooks**: paste the URL, paste the secret as the secret token, triggers **Merge request events** and **Push events**.
- **Bitbucket Cloud** — repository **Settings → Webhooks**: paste the URL and secret, triggers **Pull request created** and **Repository push**.
- **Azure DevOps** — Service Hooks of type **Web Hooks** for **Pull request created** and **Code pushed**, with the username and password typed into TestPlanIt as Basic authentication.

Repository webhooks are independent of the issue-tracker webhook above: changing or removing the project's issue integration leaves them in place, and disconnecting the repository under Impact Analysis removes its webhook.

## Outbound Webhooks

### Adding an outbound webhook

1. Navigate to **Project Settings** → **Webhooks**.
2. Click **Add Webhook** in the Outbound section.
3. Fill in:
   - **Name** — an admin-facing label shown on the card and in delivery logs.
   - **URL** — the destination endpoint. Slack incoming-webhook URLs are auto-detected; everything else is treated as a generic HMAC endpoint.
   - **Subscribed events** — pick events from five sections: Cases, Issues, Test Runs, Sessions, Alerts. Each section has a **Select all** shortcut.
4. Submit. For generic HMAC endpoints, TestPlanIt mints a signing secret and reveals it once — copy it into your receiving service before dismissing the panel.

Slack endpoints do not use a separate signing secret because Slack incoming webhooks already authenticate via the secret token embedded in the URL. The webhook URL itself is treated as a credential and redacted from logs.

### Subscribed events

Each event name follows a `subject.verb` convention. The reserved verbs are `created`, `updated`, `deleted`, `state_changed`, `completed`, `duplicated`, and `result_added`. Common examples include:

- `test_run.created`, `test_run.state_changed`, `test_run.completed`, `test_run.duplicated`, `test_run.result_added`, `test_run.execution_requested`, `test_run.execution_completed`
- `session.created`, `session.state_changed`, `session.completed`, `session.duplicated`, `session.result_added`
- `case.created`, `case.updated`, `case.deleted`
- `issue.created`, `issue.updated`, `issue.deleted`
- `alert.triggered` — emitted when an [alert](./alerts.md) that has **Also send an alert.triggered webhook event** switched on fires; the payload carries the rule, the metric, the subject with a link, and the observed, baseline and threshold values
- `dataset.row.acquired`, `dataset.row.released` — emitted by the [test-data reservation](../test-data-reservation.md) (dataset row lease) API; payloads carry row identifiers only, never the row's values

**Issue event scope.** An `issue.created` or `issue.updated` event fans out to every project that links the issue — through that project's repository cases, test runs, run results, run step results, sessions, or session results — in addition to the issue's home project. An issue with no home project (one that exists only through an integration) still fans out to every project that links it. `issue.deleted` is the exception: it is delivered to the issue's home project only, because the cross-project links are already gone by the time the delete fires.

Toggling a checkbox saves immediately; a brief check-mark flashes next to the event name to confirm the change reached the server.

### Slack vs generic HMAC

| Feature        | Slack                                                  | Generic HMAC                                                  |
| -------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| URL detection  | Auto-detected from `hooks.slack.com`                   | Anything else                                                 |
| Signing secret | Not used (Slack URL is the credential)                 | Server-minted, revealed once                                  |
| Payload shape  | Slack-formatted message                                | TestPlanIt's standard event envelope, signed with HMAC-SHA256 |
| Rotation       | Replace the URL by deleting and recreating the webhook | Use the **Rotate Secret** button (see below)                  |

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

For inbound webhooks, the synthetic event uses sentinel identifiers an external tracker cannot legitimately produce, so the receiver short-circuits without affecting any real issue. An issue-tracker webhook receives a synthetic issue update; a repository webhook receives a synthetic pull request (number 0), which is verified and recorded as `synthetic` on the Deliveries tab without starting an analysis.

## Deliveries

The Webhooks page includes a **Deliveries** tab listing each dispatched attempt with:

- Event name, direction (inbound or outbound), and webhook config.
- HTTP status code and outcome.
- Timestamp.

A delivery that was handled but acted on nothing carries a reason starting with `ignored:` (for example `ignored:not_imported` for an issue no Import Issues action takes, `ignored:no_cases` for a run with no linked cases, `ignored:has_cases` for an issue whose cases a Generate Test Cases with AI action would duplicate, or `ignored:no_llm` for a project without an active AI model). These appear in muted text and count as succeeded in the status filter. Any other reason, such as `run:no_workflow`, `execute:target_disabled` or `draft:` followed by the model's error, is a failure and appears in red.

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

Inbound Azure DevOps webhooks do not have a separate secret to rotate (the credentials are typed by the admin and stored encrypted). To change ADO credentials, delete the webhook and recreate it. Inbound **Redmine** and **MantisBT** webhooks likewise have no secret — the unguessable URL token is the credential. To rotate it, delete the webhook and recreate it, then update the URL in the tracker. Rotating an inbound **ClickUp** webhook that TestPlanIt registered removes the old registration in ClickUp and creates a new one with a fresh ClickUp-minted secret; a webhook you registered yourself must be deleted and recreated with the new secret.

Plaintext secrets are never read back from the database. They are returned only in the response to the create or rotate action and held in memory until you dismiss the reveal panel.

## Security

- **Encryption at rest** — Inbound HMAC secrets, ADO credentials, outbound HMAC secrets, and outbound URLs (a Slack URL is itself a credential) are encrypted with the same key-management infrastructure used elsewhere in the platform. After an outbound webhook is saved, its settings show only the URL's origin and last four characters.
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

- **Inbound URL pattern** — `https://<your-testplanit-host>/api/webhooks/<token>`. The token is the only identifier the receiver needs; the URL itself authenticates the request alongside the provider's signature (HMAC for Jira / GitHub / Gitea / ClickUp, secret token for GitLab) or Basic-Auth credentials (ADO). For **Redmine** and **MantisBT**, the URL token is the sole credential — their webhook plugins send no signature.
- **Outbound payload signing** — Generic HMAC endpoints receive the JSON envelope and an HMAC-SHA256 signature header derived from the body and the active secret.
- **Bulk replay cap** — 100 deliveries per batch.
- **Auto-disable threshold** — 10 consecutive failures.
