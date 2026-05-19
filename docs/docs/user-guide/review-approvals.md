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

The Review & Approval feature has a system kill switch. By default it is **on**; switching it off disables every project, hides the request and reviewer UIs, and pauses any pending requests (they reappear when the feature is re-enabled).

1. Open **Administration → Workflows**.
2. At the top of the page, find the **Review Workflow** card.
3. Toggle the switch on or off.

Only system administrators can change this setting. Project administrators see the current state read-only.

### Step 2 — Opt projects in or out

Each project carries its own `Review Workflow` toggle. By default new projects are opted in. Project administrators can opt out per project (for example, to give one team an unenforced sandbox while the rest of the org runs gated workflows).

1. Open the project.
2. Navigate to **Settings → Advanced**.
3. Toggle **Review Workflow** on or off.

When the system-level kill switch is off, the per-project toggle has no effect. When it is on, only projects with their own toggle on actually enforce gates.

### Step 3 — Mark workflow states as gated

This is where the actual gates are defined.

1. Open **Administration → Workflows**.
2. Find the workflow state you want to gate (Cases, Runs, or Sessions scope).
3. Click **Edit** on the state.
4. Turn on **Requires review**.
5. Click **Submit**.

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
    - **Reviewer** — pick a specific user **or** a role (e.g. "QA Lead"). Roles only list members who have access to this project, so you can't accidentally assign a review to someone who couldn't act on it.
    - **Comment** — optional message for the reviewer (rich text; supports `@mentions`).
4. Click **Submit**.

The entity now displays a **Pending review** badge with the reviewer's name (or role) and a tooltip showing who is being asked.

### Cancelling a request

If the requester changes their mind before a decision lands, they can cancel:

1. Open the entity.
2. Click the **Pending review** banner.
3. Click **Cancel request**.

Cancelling does not affect the entity's current state.

## Reviewing a request

Reviewers find pending requests in their inbox:

1. Click the **Review inbox** icon in the top navigation bar (a chat-bubble icon with a count badge when there are pending items).
2. The inbox shows two tabs:
    - **Pending** — requests assigned to you, directly or via a role you hold.
    - **Decided** — requests you've already decided on.
3. Click a request to open the entity in a side panel showing:
    - Requester name and comment
    - Current state and target state
    - History of comments on this request

To decide:

- **Approve** — the request flips to APPROVED. The next time the entity is transitioned to the target state (by the requester saving the form, by a bulk edit, or by milestone completion), the approval is consumed.
- **Reject** — the request flips to REJECTED. The transition is not allowed; the requester can submit a new request after addressing feedback.
- **Comment** — leave a note without deciding (useful for asking the requester for clarification). The request stays in PENDING.

Decisions can include a comment, which appears in the request history and in any associated notifications.

:::important Roles vs users
When a request is assigned to a **role**, any project member who holds that role can decide. The first decision wins — there is no need for every role-holder to act. Other role-holders see the request flip to DECIDED in their inbox the next time they refresh.
:::

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

Requesters receive a notification when a reviewer decides on a request they submitted.

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
