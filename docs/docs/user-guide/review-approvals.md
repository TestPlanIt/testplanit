---
sidebar_position: 4
title: Review & Approval
---

# Review & Approval

Review & Approval gates workflow transitions behind reviewer sign-off. Any workflow state can be marked as **requires review**, after which a Test Case, Test Run, or Test Session can only enter (or pass through) that state once a reviewer has approved a request for it.

The feature is built on top of existing [Workflows](./workflows.md). A gated state behaves exactly like any other state during configuration, ordering, and reporting — the only difference is that a request must be approved before the entity can land on (or cross) that state.

## Concepts

### Gated workflow state

A workflow state with **Requires review** turned on. Transitions *into* this state are blocked unless there is a matching approved review request for the entity.

Gates apply per workflow scope (Test Cases, Test Runs, Sessions) independently. Marking the "Active" state in the Cases scope as gated has no effect on Test Runs or Sessions.

### Review request

A request asks a reviewer (a specific user, or any holder of a chosen role) to approve a transition for a specific entity to a specific target state. The request includes an optional comment from the requester, and the reviewer leaves a comment with their decision.

A request is one-shot: once it has been approved AND consumed by an actual transition, it can't be reused. Requesters can also cancel a request before a reviewer has decided.

### Strict transitive gates

When a transition crosses **multiple** gated states, **each** gate needs its own approved review request.

For example, with gates configured on order 4 (Active) and order 5 (Done), an entity moving from order 1 (Draft) directly to order 6 (Archived) must have approved requests targeting BOTH gates: an approval for Active AND an approval for Done. An approval for the later gate does **not** satisfy the earlier one — each gate is its own checkpoint.

This applies to direct edits, bulk edits, and milestone-completion cascades.

### Backward and same-state transitions

Moving an entity **back** along the workflow order, or saving it without changing the state, never triggers a review gate — the entity is not crossing any new gates.

## Administrator setup

### Step 1 — Turn on the system-level feature

The Review & Approval feature has a system kill switch. By default it is **off** — gating workflow transitions is a meaningful behavior change, so admins explicitly opt in. Turning the switch on enables the feature globally; turning it off disables every project, hides the request and reviewer UIs, and pauses any pending requests (they reappear when the feature is re-enabled).

1. Open **Administration → Workflows**.
2. At the top of the page, find the **Review Workflow** card.
3. Toggle the switch on.

Only system administrators can change this setting. Project administrators see the current state read-only.

### Step 2 — Opt projects in

Each project carries its own `Review Workflow` toggle. By default new projects are **opted out**. Project administrators flip the toggle on per project — that way the org can roll the feature out gradually instead of every project enforcing gates the moment the system switch flips.

Either path works:

- **Per project** — open the project, navigate to **Settings → Advanced**, toggle **Review Workflow** on. Useful for project administrators managing their own project.
- **Bulk from the admin surface** — open **Administration → Workflows**. While the system feature is on, the Review Workflow card lists every project with an inline switch; flip any project on or off without leaving the page. The list is searchable, sortable, and paginated. Useful for system administrators rolling the feature out across many projects.

When the system-level kill switch is off, the per-project toggle has no effect. When it is on, only projects with their own toggle on actually enforce gates.

If a project is opted in while the system feature is off, the project's Advanced settings page surfaces a warning under the toggle so admins know the preference is saved but inactive until a system administrator turns the feature on.

### Step 3 — Grant the Can Approve permission to reviewer roles

Reviewer eligibility is gated by a role-level **Can approve** permission, scoped per entity area (Test Cases, Test Runs, Sessions). Only users whose effective project role holds `Can approve` for the entity being reviewed appear in the assignee dropdown; the same check runs server-side on submit and again at decision time, so the gate cannot be bypassed via direct API.

By default the seeded `admin` role carries Can approve on all three review-relevant areas. Other roles start at off, so most teams will need to grant the permission to whichever role does the actual reviewing (for example, "Tech Lead" or "QA Lead").

1. Open **Administration → Roles**.
2. Click **Edit** on the role you want to grant approval rights to.
3. In the permission grid, find the rows for **Test Case Repository**, **Test Runs**, and **Sessions** — each carries an **Approve** column alongside Add/Edit, Delete, and Complete. The column is hidden on other areas (approval is meaningless outside the three review-relevant scopes).
4. Toggle **Approve** on for whichever areas this role should approve.
5. Save.

System administrators (access = ADMIN) bypass the Can Approve check at decision time, so an admin can always decide on a pending review even if their project role doesn't carry the permission. This is intentional — admins can unblock stalled reviews — but they still only appear in the assignee dropdown if their role grants Can approve, so the day-to-day reviewer pool stays predictable.

### Step 4 — Mark workflow states as gated

This is where the actual gates are defined.

1. Open **Administration → Workflows**.
2. Find the workflow state you want to gate (Cases, Runs, or Sessions scope).
3. Click **Edit** on the state.
4. Turn on **Requires review**.
5. Click **Submit**.

![The Edit Workflow dialog with the Requires Review switch turned on](/img/screenshots/user-guide/review-approvals/requires-review-toggle.png)

A gated state is shown everywhere a workflow state is displayed — case-detail pages, dropdowns, the inbox, etc. — with a small **warning glyph** next to the state name. Hovering reveals "Requires review".

:::tip Pick gates carefully
A typical pattern is to gate one or two states that represent meaningful sign-off points (for example, "Active" for cases or "Done" for runs). Gating every state in a workflow forces a review on every move and quickly becomes friction.
:::

## Requesting a review

When a tester needs to advance a case, run, or session into (or across) a gated state, they request a review instead of changing the state directly.

1. Open the test case, test run, or session.
2. Click **Request review**.
3. In the dialog:
    - **Target state** — the workflow state you want the entity to land on. The dropdown shows gated states clearly with the warning glyph.
    - **Reviewer** — pick a specific user **or** a role (e.g. "QA Lead"). The dropdown is filtered down to those that hold the **Can approve** permission for the entity area you're requesting on (Test Cases, Test Runs, or Sessions). Users whose effective project role does not grant Can approve, and roles that do not grant the permission for that area, are hidden from the picker entirely — there's no way to assign a review to a user or role that wouldn't be able to act on it. The role chip on the pending banner exposes a hover tooltip naming every project-eligible holder of that role, so the requester always knows who can act. If the person you expect isn't there, ask an administrator to grant their role Can approve for the relevant area on **Administration → Roles**.
    - **Comment** — optional message for the reviewer (rich text; supports `@mentions`). If you leave the comment blank, TestPlanIt fills it in with a sensible default — `Please review the transition from {fromState} → {toState}.` (and, for role-assigned reviews, appends `Requesting approval from the {roleName} group.`) — so the reviewer always sees something useful in the comment thread.
4. Click **Submit**.

![The Request Review sheet with target state, reviewer, and comment fields populated](/img/screenshots/user-guide/review-approvals/request-review-sheet.png)

The entity now displays a **Pending review** badge with the reviewer's name (or role) and a tooltip showing who is being asked.

![The pending review banner on a test case detail page, naming the reviewer and the target state](/img/screenshots/user-guide/review-approvals/status-banner-pending.png)

When the reviewer is a role, the banner renders a role chip with a small role icon. Hovering it surfaces the list of project-eligible holders so the requester knows exactly who can act on the request — no hunting through project members to figure out who got pinged.

![The role chip on a pending review banner expanded to its hover tooltip, listing every project-eligible holder of the role](/img/screenshots/user-guide/review-approvals/role-assignee-chip-tooltip.png)

### Cancelling a request

If the requester changes their mind before a decision lands, they can cancel:

1. Open the entity.
2. Click the **Pending review** banner.
3. Click **Cancel request**.

Cancelling does not affect the entity's current state. Anyone who was asked to review the request — the direct assignee or every role holder — is notified so they can drop the item from their queue, and the cancellation is emitted as a `review_completed` webhook event with `decision: "CANCELLED"`.

## Reviewing a request

Reviewers find pending requests in their inbox:

1. Click the **Review inbox** icon in the top navigation bar (an inbox icon with a count badge when there are pending items). The icon is hidden for users who have no access to any project with **Review Workflow** turned on — there's nothing for them to act on.
2. The inbox shows two tabs:
    - **Pending** — requests assigned to you, directly or via a role you hold.
    - **Decided** — requests you've already decided on.
3. Click a request to open the entity in a side panel showing:
    - Requester name and comment
    - Current state and target state
    - History of comments on this request

![The reviewer inbox at /reviews showing the Pending tab with three rows and approve / request changes / reject row actions](/img/screenshots/user-guide/review-approvals/reviewer-inbox.png)

To decide:

- **Approve** — the request flips to APPROVED. The next time the entity is transitioned to the target state (by the requester saving the form, by a bulk edit, or by milestone completion), the approval is consumed.
- **Reject** — the request flips to REJECTED. The transition is not allowed; the requester can submit a new request after addressing feedback.
- **Comment** — leave a note without deciding (useful for asking the requester for clarification). The request stays in PENDING.

Decisions can include a comment, which appears in the request history and in any associated notifications.

:::tip Keep rejected cases out of test runs
If a rejected case is sent back to a Not Started workflow state, you can keep it out of new and existing runs automatically by turning on **Exclude Draft Cases from Test Runs** under the project's [Advanced settings](./projects.md#exclude-draft-cases-from-test-runs). With that toggle on, the rejected case disappears from the Add Cases picker and is removed from any open run where it has not yet been executed; executed run-cases are kept (read-only) so the historical result stays visible.
:::

![The Approve confirmation dialog with the requester, entity name, target state, and an optional approval note field](/img/screenshots/user-guide/review-approvals/approve-dialog.png)

:::important Roles vs users
When a request is assigned to a **role**, any project member who holds that role can decide. The first decision wins — there is no need for every role-holder to act. Other role-holders see the request flip to DECIDED in their inbox the next time they refresh.
:::

## Review reminders

If a review request sits in `PENDING` for too long, TestPlanIt nudges the reviewer so the request doesn't get lost. A scheduled job runs hourly and scans for `PENDING` requests older than a configurable threshold; for each one it sends the reviewer a **Review still pending** notification — in-app, and via email if their preferences allow it.

The default threshold is **1 day**. Reminders are recurring: once a reminder fires, TestPlanIt stamps the request and waits another full threshold before re-pinging, so reviewers aren't spammed but stale requests do continue to surface.

### Who gets reminded

- The **direct user assignee**, if the request named one specific reviewer.
- **Every project-eligible role holder**, if the request was role-assigned (same fan-out as the original request notification).

The original **requester is never pinged** — they already know they sent it. Soft-deleted requests are excluded from the scan.

### Configuring reminders

The reminder controls live inside the **Review Workflow** card on **Administration → Workflows**, just below the system feature toggle (visible to system administrators only, and only when the system feature is on):

1. Flip **Send reminder notifications for pending reviews** off to disable reminders entirely. The scheduled job still runs, but it short-circuits without scanning. Existing reminder rows stay in their recipients' inboxes; no new ones fire.
2. With reminders enabled, set **Remind reviewers after** *N* **day(s)** to the cadence you want. Minimum 1 day. Click **Save** to persist.

The reminder threshold (`review_reminder_threshold_days`) and the on/off state are stored together as a single integer in `AppConfig`: `0` means disabled, any positive integer means "remind after this many days of inactivity, and again every *N* days after that until the request is decided."

:::caution Pairing reminder cadence with the daily-digest email mode
If users on this instance use the daily-digest email mode and you set the reminder threshold to a value shorter than 24 hours of real time (not currently possible — minimum is 1 day — but worth knowing for future flexibility), the same reminder could land in their digest multiple times. The 1-day minimum on the UI makes this a non-issue in practice: even with `threshold = 1`, the daily digest can include at most one reminder row per pending request.
:::

### Slack and webhook subscribers (stretch)

Each reminder also emits an outbound webhook event, in three entity-scoped variants — `case.review_reminder`, `test_run.review_reminder`, and `session.review_reminder`. Subscribers configured on a project's **Settings → Webhooks** can route these to Slack (formatted with a "Review reminder" header showing the pending duration alongside the entity / requester / assignee context) or to any generic HMAC endpoint as structured JSON.

## Bulk operations

### Bulk-edit test cases

When you bulk-edit test cases in the repository and change the state to a gated one, the modal pre-validates the gate per case **before** you click Save:

- If every selected case can transition cleanly (already approved, or not crossing any gate), Save fires normally.
- If any case is missing an approval, the modal shows a red inline message naming the blocking gate and listing the blocked cases by name. The Save button is disabled with a tooltip explaining what to fix.

This pre-validation prevents you from losing your other edits to a 403 round-trip — fix the blocked cases first, then try again.

### Milestone completion

Completing a milestone optionally cascades through every active test run and session and flips them into a "done" state. When the chosen done state is gated (or any intermediate gate sits between a run/session's current state and the done state), milestone completion enforces strict transitive gates per entity.

If any run or session lacks an approval for any gate in its path, the entire cascade is rolled back and an error toast names the first blocked entity and the gate that needs approval. The milestone is not partially completed.

This means a milestone completion across a team's full test run set can require many approvals. Plan ahead: kick off review requests during the run, not at completion time.

## Feature-flag behavior

### System-level off

When an administrator turns off the system-level **Review Workflow** card:

- The **Request review** button is hidden everywhere.
- The **Review inbox** entry is hidden from the navigation.
- The **Requires review** toggle on workflow state edit forms is locked.
- Any in-flight requests are preserved silently in the database. They reappear in their reviewers' inboxes the moment the feature is re-enabled.
- Transitions to previously-gated states are no longer blocked.

### Per-project off

When the system feature is on but a project has its own toggle off:

- The Request review button is hidden in that project.
- Transitions to gated states are not blocked in that project.
- Any pending requests for entities in that project are preserved and reappear if the project re-enables.

### Re-enabling

Toggling either flag back on resurfaces every preserved pending request to its assignees. Reviewers will see their inbox count jump.

## Notifications

Reviewers receive an in-app notification (and an email, if email notifications are enabled in [Notification Preferences](./notifications.md)) when:

- A request is **assigned** to them directly, or to a role they hold.
- A request they own (or are watching) is **decided**.
- A request is **cancelled** by the requester.
- A request they're assigned to has **been pending past the reminder threshold** (see [Review reminders](#review-reminders) above).

Requesters receive a notification when a reviewer decides on a request they submitted.

## Outbound webhooks

Review events can be delivered to external systems (Slack, generic HMAC endpoints) via the project's outbound webhook configuration. Two event verbs are emitted, in three entity-scoped variants:

| Event name | Fires when |
| --- | --- |
| `case.review_requested` / `test_run.review_requested` / `session.review_requested` | A reviewer is requested on a Test Case / Test Run / Session |
| `case.review_completed` / `test_run.review_completed` / `session.review_completed` | The request is approved, sent back for changes, rejected, or cancelled |
| `case.review_reminder` / `test_run.review_reminder` / `session.review_reminder` | The scheduled reminder fires on a request that's been pending past the configured threshold (see [Review reminders](#review-reminders)) |

To subscribe:

1. Open the project's **Settings → Webhooks**.
2. Add or edit an outbound config.
3. Under **Subscribed events**, expand the entity section (Test cases, Test runs, or Sessions) and check **Review requested** and/or **Review completed**.
4. Save.

The Slack adapter renders each event as a color-coded message (green for approved, red for rejected, yellow for changes-requested, neutral for cancelled or requested) with the requester, assignee, target state, and any comment. Generic HMAC endpoints receive the structured JSON payload — entity identity, requester + assignee identity, transition (from-state + to-state), and decision metadata for completed events.

## Frequently asked questions

**Can I require multiple reviewers on the same request?**
Not today. A request has one assignee — either one user or one role. The first decision from any qualifying reviewer wins. If you need a multi-stakeholder sign-off, configure two adjacent gated states (e.g. "Tech review" → "PM review") so each transition gets its own request.

**What happens if the reviewer no longer has project access?**
A role-assigned request that resolves to zero project-eligible reviewers is still visible in the requester's UI but cannot be acted on until project access is restored or the request is reassigned (cancel and re-submit).

**Can I see who has approved which transitions for an entity?**
Yes. The **Decided** tab in the Review inbox shows requests you decided. Per-entity history is also available — open the entity, scroll to the review history section, and you'll see the chain of requests and decisions.

**Does Review & Approval apply to API-driven updates?**
Yes. The gate is enforced at the API layer, so updates from the ZenStack auto-API, server actions, and direct HTTP routes all honor the gate. Service accounts that bypass the gate must be granted explicit project administrator access AND the per-project toggle must be turned off; there is no per-request bypass.

**Does the feature support custom workflow states per project?**
Yes — gates honor the project assignments on the underlying workflow state (see [Workflows](./workflows.md)). A gate marked on a state assigned to specific projects only applies to those projects.
