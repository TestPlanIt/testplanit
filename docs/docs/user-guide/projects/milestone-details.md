---
title: Milestone Details
sidebar_position: 2 # Position within Milestones category
---

# Milestone Details Page

This page provides a detailed view and editing capabilities for a specific project milestone. You typically access this page by clicking on a milestone's name from the main [Project Milestones](./milestones.md) list.

## Layout

The page uses a resizable two-panel layout:

- **Left Panel (Main Content)**:
  - **Milestone Name**: Displays the name (editable in Edit Mode). A milestone synced from an external tracker shows a [source badge](#source-badge) next to the name.
  - **Documentation**: Shows the rich text documentation associated with this milestone (`docs` field). Editable in Edit Mode via a `TipTapEditor`.
  - **(View Mode Only)** Lists of:
    - **Child Milestones**: Displays any direct children of this milestone, showing their name, status badge, and dates. Clicking a child navigates to its own detail page.
    - **Associated Test Runs**: Lists Test Runs linked to this milestone and all descendant milestones. Runs from child milestones display a milestone label to indicate their source.
    - **Associated Sessions**: Lists Test Sessions linked to this milestone and all descendant milestones. Sessions from child milestones display a milestone label to indicate their source.
- **Right Panel (Controls & Details)**:
  - Displays/allows editing of core milestone properties using form controls.

## Viewing Details (View Mode)

In the default view mode:

- All fields are read-only.
- A **Back Arrow** button in the header navigates back to the main Milestones list.
- An **Edit** button (icon: SquarePen) is available for users with **ADMIN** or **PROJECTADMIN** access.
- An **Export PDF** button generates a print/evidence-grade PDF report of the milestone (see [Exporting to PDF](#exporting-to-pdf)).
- The right panel displays:
  - **Status Badge**: Shows the calculated status (Not Started, In Progress, Completed, Overdue).
  - **Completion Rate**: Displays the percentage of completed test results out of total test cases in test runs associated with this milestone and all descendant milestones.
  - **Dates**: Displays Start and Due dates.
  - **Description**: Shows the rich text description (`note` field). It's initially collapsed but expandable.
  - **Type**: Shows the selected Milestone Type.
  - **Parent**: Shows the parent milestone, if any.

## Source Badge

A milestone synced from an external tracker (currently Jira) shows a badge next to its name with three segments, for example **Jira · Sprint · active**: the tracker's icon, the milestone's kind (**Release** or **Sprint**), and its current tracker-reported state.

- **Project admins** see the badge as a menu trigger. Clicking it opens:
  - **Open in Jira** — opens the linked artifact in a new tab. Disabled if no external URL is stored for the milestone.
  - **Unlink from Jira** — detaches the milestone from the tracker after a confirmation dialog explaining the consequences: sync stops, the milestone's fields become editable again, its synced issue links become manual (yours to keep or remove), and the milestone can be re-linked later by importing the same artifact again from the [Milestones list](./milestones.md).
- Everyone else sees the badge as a plain link to the tracker (or a static, non-clickable label if no URL is stored) — no menu.
- On narrow layouts the badge collapses one segment at a time — state, then kind, then the provider name — down to just the tracker icon. The full label remains available on hover.
- If the milestone's upstream artifact is deleted or merged into another artifact in the tracker, the badge becomes permanent and non-dismissible, reading **source removed in Jira** or **merged into \{target\}** (the latter links to the target milestone when it's still resolvable). This badge no longer offers a menu — the milestone has become local.
- A milestone that was **manually** unlinked shows **no badge at all**. Once you choose to unlink, the milestone behaves like any other local milestone with no residual marker.

The same badge appears on milestone cards on the [Milestones list](./milestones.md).

:::info Permissions Required
Unlinking a milestone from Jira requires **project admin** status — the project creator, a user with the **Project Admin** role on the project, or a user with `PROJECTADMIN`/`ADMIN` system access. See the [Permissions Guide](../permissions-guide.md).
:::

## Summary

At the top of the page (view mode only), a summary bar breaks down the test run and session results contributing to the milestone. When the milestone has related issues, two count chips appear next to it:

- **Target icon** — the number of issues **in scope**: issues linked to this milestone directly, whether synced from Jira or linked manually.
- **Bug icon** — the number of issues **found in testing**: defects surfaced by test runs and sessions linked to this milestone and its child milestones.

Hovering either chip shows its full label as a tooltip. Clicking a chip scrolls down to the [Issues card](#issues) and expands the matching section.

## Issues

Below the summary, the **Issues** card gathers every issue related to the milestone into two independently collapsible sections. Each section remembers whether you last left it expanded or collapsed.

### In Scope

Issues that belong to this milestone: those synced automatically from the linked Jira sprint or version, plus any linked manually. Each row shows:

- **Coverage** — a chip summarizing the latest completed outcome of every test case linked to that issue, as one colored pip per status plus an Untested pip, or an **Uncovered** chip when none of the linked cases has a completed result yet.
- **Source** — **Synced** or **Manual**.

Above the table, milestone-wide coverage totals roll up every listed issue's per-status pips — with a legend popover explaining the colors — plus a count of uncovered issues.

A filter row (search, coverage state, source, and issue type) appears once there's at least one issue to filter; it stays hidden on an empty section.

Select one or more issues and click **Create test run** to open the Add Test Run wizard pre-seeded with every non-deleted test case linked to the selected issues, with the contributing issues pre-linked to the new run.

Use **Link Issue** to attach an issue manually, and the per-row action to unlink one. Synced issue links can't be unlinked here — they're marked "Managed by Jira" and must be removed from the version/sprint in Jira instead.

When the linked Jira sprint or version has more issues than are linked here — because an automatic sync hit its import cap, or membership has simply drifted since the last sync — a **More issues in Jira** panel appears below the table listing the missing issues, with an **Import & link** action to pull them in.

:::info Permissions Required

- **Linking an issue, unlinking a manually-linked issue, and creating a test run from selected issues** require the `Add/Edit` permission for the `Milestones` application area.
- **Import & link** (the overflow panel) requires **project admin** status.

:::

### Found in Testing

A read-only list of issues surfaced by test runs and sessions linked to this milestone **and its child milestones**. An issue that also appears in **In scope** carries an **In scope** badge here.

This section has no linking controls of its own — to change what a milestone is linked to, use **In scope** above.

## Editing Details (Edit Mode)

Clicking the **Edit** button (or accessing via an edit link) activates Edit Mode:

- The **Back Arrow** is replaced with **Save** and **Cancel** buttons.
- A **Delete** button (icon: Trash2) appears.
- Fields in both panels become editable:
  - **Left Panel**: Milestone Name (Textarea), Documentation (`TipTapEditor`).
  - **Right Panel**: Status Toggles (Started/Completed), Dates (`DatePickerField`), Description (`TipTapEditor`), Type (Select), Parent (Select), Auto-Complete, and Notification settings.
- **Saving**: Click **Save** (icon: Save) to persist changes. A success/error toast message appears.
- **Canceling**: Click **Cancel** (icon: CircleSlash2) to discard changes and revert to the last saved state.
- **Deleting**: Click **Delete** to open the confirmation modal (cascades to children). On successful deletion, you are redirected back to the main Milestones list.

On a milestone that's actively synced from Jira, several fields are locked because the tracker owns them:

:::warning Managed by Jira
The **Name**, **Started**/**Completed** toggles, **Start**/**Due** dates, and **Description** are read-only while the milestone is synced — an amber notice explains this in the right panel. The **Auto-Complete** toggle is hidden entirely, since the tracker (not the local auto-complete worker) owns whether a synced milestone is complete. **Type**, **Parent**, and the notification settings stay editable.

These locks lift once the milestone is no longer actively synced — either its upstream artifact was removed in Jira, or it was [manually unlinked](#source-badge) — at which point it behaves like any local milestone.
:::

:::info Permissions Required

- **Editing:** Requires the `Add/Edit` permission for the `Milestones` application area. Users without this permission cannot enter edit mode or save changes.
- **Deleting:** Requires the `Delete` permission for the `Milestones` application area. Users without this permission will not see the Delete button.
:::

## Exporting to PDF

The **Export PDF** button in the header generates a print- and evidence-grade PDF report of the milestone. Unlike screenshotting the page, the report is laid out aggregate-first, paginates cleanly with table headers that repeat on continuation pages, and stamps every page with a generation header (milestone name, generation date, and the user who produced it) plus a page-numbered footer — so an auditor can see when and by whom the report was produced.

The report aggregates the milestone **and all of its descendant sub-milestones**, and includes:

- **Milestone metadata**: name, status, start/due/created dates, owner, type, and parent path.
- **Summary**: completion rate, executed vs. total items, total elapsed and estimated time, and a status-count rollup (e.g. Passed / Failed / Blocked).
- **Contributing Test Runs**: one row per run with its per-status breakdown.
- **Contributing Sessions**: each session with its latest status.
- **Sub-milestones**: descendant milestones with their status.
- **Linked Issues**: issues linked to the contributing runs and sessions.
- **Review & Approval Decisions**: the decision (approved, rejected, etc.), reviewer, date, and comment for contributing runs and sessions that went through review.

Dates and durations are formatted for your locale. As with the test run and session PDF exports, the document body text is in English by design — see [Exported PDFs are in English](../../import-export.md#pdf-export).

## Automatic Completion

Milestones can be configured to automatically mark themselves as completed when their due date is reached.

:::note
Automatic Completion is unavailable while a milestone is actively synced from Jira — the tracker owns the milestone's completion state, so the **Auto-Complete** toggle is hidden (see [Editing Details](#editing-details-edit-mode)). It becomes available again once the milestone is local — either its upstream artifact was removed in Jira or it was manually unlinked.
:::

### Enabling Auto-Complete

1. Enter **Edit Mode** by clicking the Edit button
2. Set a **Due Date** for the milestone (required for auto-completion)
3. Toggle the **Auto-complete on due date** switch to ON
4. Save your changes

### How It Works

- A background job runs daily at 6:00 AM (server time)
- The job checks for milestones where:
  - Auto-completion is enabled
  - The milestone is not already completed
  - The due date has passed
- Matching milestones are automatically marked as completed
- This is useful for time-boxed milestones like sprints that should close regardless of completion status

### Use Cases

- **Sprints**: Automatically close sprints when the sprint period ends
- **Release Windows**: Mark release milestones as complete when the release date passes
- **Time-boxed Testing**: Close testing phases that must end by a specific date

:::tip
Auto-completion only affects the milestone itself. Child milestones are not automatically completed—each must have its own auto-completion setting if desired.
:::

## Due Date Notifications

When a milestone has a due date approaching (or is overdue), TestPlanIt can automatically notify all users who have participated in the milestone's work.

### Enabling Notifications

1. Enter **Edit Mode** by clicking the Edit button
2. Set a **Due Date** for the milestone
3. Toggle the **Notify days before due date** switch to ON
4. Enter the number of days before the due date to start sending notifications (default: 5 days)
5. Save your changes

### Who Receives Notifications

Notifications are sent to all users who have participated in the milestone, including:

- **Milestone creator** - The user who created the milestone
- **Test run creators** - Users who created test runs associated with the milestone
- **Assigned testers** - Users assigned to test cases within the milestone's test runs
- **Result submitters** - Users who have executed and submitted test results
- **Session creators** - Users who created exploratory testing sessions
- **Session assignees** - Users assigned to exploratory testing sessions

Each user receives only one notification per milestone per day, even if they appear in multiple roles.

### Notification Timing

- Notifications are processed daily at 6:00 AM (server time)
- Users receive notifications when:
  - The milestone is within the configured "notify days before" window
  - The milestone is overdue (past its due date)
- Notifications continue daily for overdue milestones until the milestone is marked as completed

### Notification Content

**Due Soon Notification**:

- Title: "Milestone Due Soon"
- Message: Milestone "\{name\}" in project "\{project\}" is due on \{date\}
- Links directly to the milestone details page

**Overdue Notification**:

- Title: "Milestone Overdue"
- Message: Milestone "\{name\}" in project "\{project\}" was due on \{date\}
- Links directly to the milestone details page

### Notification Delivery

Notifications follow each user's configured notification preferences:

- **In-App Only**: Notification appears in the notification center
- **In-App + Immediate Email**: Notification plus immediate email
- **In-App + Daily Digest**: Notification plus inclusion in daily digest email
- **Use Global Settings**: Follows system-wide defaults

For more details on notification preferences, see [Notifications](../notifications.md).

:::note
Notification settings are disabled when no due date is set. Setting a due date automatically enables notifications with a default of 5 days before the due date.
:::

## Comments

The milestone details page includes a **Comments** section at the bottom, allowing team members to discuss milestone progress, communicate blockers, and coordinate testing activities.

### Adding Comments

1. Scroll to the **Comments** section at the bottom of the page
2. Click in the comment editor field
3. Type your comment using the rich text editor
4. Use `@` to mention team members who should be notified
5. Click **Post Comment** to publish

### Comment Notifications

When you mention a user in a milestone comment:

- They receive an in-app notification with a link to the milestone
- Based on their notification preferences, they may also receive an email
- The notification includes the milestone name and custom icon for easy identification

### Example Comments

- **Progress Updates**: "@project-manager - All test runs are now complete. Ready for sign-off."
- **Risk Communication**: "Milestone at risk due to blocked test environment. @devops please advise."
- **Scope Changes**: "Adding additional test runs per new requirements from stakeholder meeting."
- **Coordination**: "@qa-team - Please prioritize the payment tests before end of sprint."

For more details on the commenting system, see [Comments & Mentions](../comments.md).
