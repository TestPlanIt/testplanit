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
  - **Forecast**: The estimated time to execute the milestone's test cases.
  - **(View Mode Only) Child Milestones**: Displays any direct children of this milestone, showing their name, status badge, and dates. Clicking a child navigates to its own detail page.
  - **(View Mode Only)** A stack of icon-and-title cards follows — **Burndown**, **Issues**, **Test Runs**, and **Sessions**. Each card is an independently collapsible accordion that remembers whether you last left it expanded or collapsed (persisted per browser):
    - **Burndown**: The [execution burndown](#burndown) over the milestone window. Appears only when the milestone has both a window anchor and executable scope.
    - **Issues**: The [Issues card](#issues), whose header shows a single deduped issue total across its two sections.
    - **Test Runs**: Test Runs linked to this milestone and all descendant milestones. Runs from child milestones display a milestone label to indicate their source. Long lists are virtualized, loading each row as you scroll.
    - **Sessions**: Test Sessions linked to this milestone and all descendant milestones. Sessions from child milestones display a milestone label to indicate their source. Long lists are virtualized, loading each row as you scroll.
- **Right Panel (Controls & Details)**:
  - Displays/allows editing of core milestone properties using form controls.

## Viewing Details (View Mode)

In the default view mode:

- All fields are read-only.
- A **Back Arrow** button in the header navigates back to the main Milestones list.
- An **Activity** button — the leftmost of the header actions — opens a slide-out **Activity Log** sheet listing the milestone's audit history. Which entries appear is governed by the milestone audit-log read policy.
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

A milestone synced from an external tracker (currently Jira) shows a badge next to its name, for example **Jira · Sprint · active · Website**: the tracker's icon, the milestone's kind (**Release** or **Sprint**), its current tracker-reported state, and — space permitting — the Jira project the artifact belongs to.

- **Project admins** see the badge as a menu trigger. Clicking it opens:
  - **Open in Jira** — opens the linked artifact in a new tab. Disabled if no external URL is stored for the milestone.
  - **Unlink from Jira** — detaches the milestone from the tracker after a confirmation dialog explaining the consequences: sync stops, the milestone's fields become editable again, its synced issue links become manual (yours to keep or remove), and the milestone can be re-linked later by importing the same artifact again from the [Milestones list](./milestones.md).
- Everyone else sees the badge as a plain link to the tracker (or a static, non-clickable label if no URL is stored) — no menu.
- On narrow layouts the badge collapses one segment at a time — the Jira project, then state, then kind, then the provider name — down to just the tracker icon. The milestone name always wins the space contest: the badge gives up its segments before the name loses a single character. The full label remains available on hover.
- If the milestone's upstream artifact is deleted or merged into another artifact in the tracker, the badge becomes permanent and non-dismissible, reading **source removed in Jira** or **merged into \{target\}** (the latter links to the target milestone when it's still resolvable). This badge no longer offers a menu — the milestone has become local.
- A milestone that was **manually** unlinked shows **no badge at all**. Once you choose to unlink, the milestone behaves like any other local milestone with no residual marker.

The same badge appears on milestone cards on the [Milestones list](./milestones.md), and on the milestone group headers of the [Test Runs page](./runs.md) — there it opens the tracker directly for everyone, with no unlink option, since that page groups by milestone rather than managing them. Everywhere else milestones appear — session groupings, child-milestone lists, milestone pickers, and the admin projects table — a synced milestone is marked with a compact tracker icon (hover it for the provider and kind) instead of the full badge.

:::info Permissions Required
Unlinking a milestone from Jira requires **project admin** status — the project creator, a user with the **Project Admin** role on the project, or a user with `PROJECTADMIN`/`ADMIN` system access. See the [Permissions Guide](../permissions-guide.md).
:::

## Summary

At the top of the page (view mode only), a summary bar breaks down the test run and session results contributing to the milestone. When the milestone has related issues, two count chips appear next to it:

- **Target icon** — the number of issues **in scope**: issues linked to this milestone directly, whether synced from Jira or linked manually.
- **Bug icon** — the number of issues **found in testing**: defects surfaced by test runs and sessions linked to this milestone and its child milestones.

Hovering either chip shows its full label as a tooltip. Clicking a chip scrolls down to the [Issues card](#issues) and expands the matching section.

## Burndown

Once the milestone has both a window anchor and executable scope, a collapsible **Burndown** card charts execution progress over the milestone's window. A fresh, empty milestone has nothing to plot, so the card stays hidden until work exists.

- The **actual** line plots how many test items still lack a first result on each day, stepping down as executions land. Its window anchor is the milestone's **Start date**, or — when that's unset — the earliest recorded execution, falling back to the **created** date.
- When the milestone has a **Due date**, a dashed **Ideal** guideline runs from the remaining-at-start down to zero on that date.
- A **Today** marker highlights the current day within the window.

Hovering a point on the actual line shows that day and its remaining count.

### Schedule-health heat strip

When a Due date exists, a per-day **heat strip** sits beneath the x-axis, coloring each day by how far the actual remaining work sat from that day's ideal:

- **Ahead of ideal** shifts from green through blue to purple the further ahead the milestone runs.
- **On track** — sitting on the ideal line — is green.
- **Behind ideal** warms from yellow to red as the milestone falls further behind.
- Days not yet reached stay neutral.

A legend keys the strip with **Ahead of ideal**, **On track**, and **Behind ideal** swatches, and hovering a day shows how many items it was ahead of or behind ideal.

## Issues

The **Issues** card gathers every issue related to the milestone into two independently collapsible sections — **In scope** and **Found in testing**. Its header shows a single deduped issue total: the union of both sections, since one issue can appear in each. The card and each of its sections remember whether you last left them expanded or collapsed.

### In Scope

Issues that belong to this milestone: those synced automatically from the linked Jira sprint or version, plus any linked manually. Each row shows:

- **Test Cases** — the number of test cases linked to that issue **in this project**, as a badge that expands into a searchable case list. When the same issue also has test cases in other projects, a separate outlined **+N** badge totals those — see [Test cases from other projects](#test-cases-from-other-projects).
- **Coverage** — a chip summarizing the latest completed outcome of every test case linked to that issue, as one colored pip per status plus an Untested pip, or an **Uncovered** chip when none of the linked cases has a completed result yet. This project's cases are judged by their results from test runs on this milestone and its descendants; cases from other projects contribute the latest result from their own project's test runs.
- **Source** — **Synced** or **Manual**.

#### Test cases from other projects

An issue in scope here can also have test cases linked to it in other projects. Those cases count toward the milestone's overall picture without blurring this project's actionable numbers:

- The **Test Cases** column keeps the two totals separate: the solid badge counts this project's cases, and the outlined **+N** badge counts cases from other projects. Expanding **+N** lists those cases with each one's project alongside; clicking a case opens it in its own project in a new tab.
- The **Coverage** chip, the **% ready** badge, and the milestone-wide coverage totals blend the other-project cases and their results in — an issue only reads as fully passing once every linked case passes, whichever project it lives in.

You only ever see cases and results from projects you have access to: anything in a project you can't read is excluded from every count and list. Because of this, totals can legitimately differ between viewers with different project access.

The section header carries a **% ready** badge — the share of member issues that are fully passing (every linked test case passed), rounded to a whole percent. Hovering it breaks the total down by state (passed, failed, in progress, not run, uncovered). Uncovered and not-run issues count against readiness, so a milestone reaches 100% only once every in-scope issue is fully covered and passing.

Above the table, milestone-wide coverage totals roll up every listed issue's per-status pips — with a legend popover explaining the colors — plus a count of uncovered issues.

A filter row (search, coverage state, source, and issue type) appears once there's at least one issue to filter; it stays hidden on an empty section.

Select one or more issues and click **Create test run** to open the Add Test Run wizard pre-seeded with every non-deleted test case linked to the selected issues, with the contributing issues pre-linked to the new run.

Use **Link Issue** to attach an issue manually. Each row's overflow menu (⋮) offers **Generate Test Cases** — which opens the seeded generation wizard for that issue, for viewers with test-case create permission — and, for manually-linked rows only, **Unlink**. A synced link can't be unlinked here: its **Source** reads **Synced** and its menu offers no Unlink action — remove it from the version/sprint in Jira instead.

When the linked Jira sprint or version has more issues than are linked here — because an automatic sync hit its import cap, or membership has simply drifted since the last sync — a **More issues in Jira** panel appears below the table listing the missing issues, with an **Import & link** action to pull them in.

:::info Permissions Required

- **Linking an issue, unlinking a manually-linked issue, and creating a test run from selected issues** require the `Add/Edit` permission for the `Milestones` application area.
- **Import & link** (the overflow panel) requires **project admin** status.

:::

### Found in Testing

A read-only table of issues surfaced by test runs and sessions linked to this milestone **and its child milestones**. It uses the same table layout as **In scope**, with each row showing the issue (including its issue-type icon), a **Description** column, and the issue's status. An issue that also appears in **In scope** carries an **In scope** badge here.

This section has no linking controls of its own — to change what a milestone is linked to, use **In scope** above.

## Editing Details (Edit Mode)

Clicking the **Edit** button (or accessing via an edit link) activates Edit Mode:

- The **Back Arrow** is replaced with **Save** and **Cancel** buttons.
- A **Delete** button (icon: Trash2) appears.
- Fields in both panels become editable:
  - **Left Panel**: Milestone Name (Textarea), Documentation (`TipTapEditor`).
  - **Right Panel**: Status Toggles (Started/Completed), Dates (`DatePickerField`), Description (`TipTapEditor`), Type (Select), Parent (searchable milestone picker), Auto-Complete, and Notification settings.
- **Saving**: Click **Save** (icon: Save) to persist changes. A success/error toast message appears.
- **Canceling**: Click **Cancel** (icon: CircleSlash2) to discard changes and revert to the last saved state.
- **Deleting**: Click **Delete** to open the confirmation modal (cascades to children). On successful deletion, you are redirected back to the main Milestones list.

On a milestone that's actively synced from Jira, several fields are locked because the tracker owns them:

:::warning Managed by Jira
The **Name**, **Started**/**Completed** toggles, **Start**/**Due** dates, and **Description** are read-only while the milestone is synced — a compact **Managed by Jira** notice in the right panel explains this. A help icon on the notice reveals the full detail, and its title links out to the artifact in Jira when a URL is stored. The **Auto-Complete** toggle is hidden entirely, since the tracker (not the local auto-complete worker) owns whether a synced milestone is complete. **Type**, **Parent**, and the notification settings stay editable.

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
- **In Scope**: the milestone's member issues with their status, coverage, and source, plus milestone-wide coverage totals.
- **Found in Testing**: issues surfaced by the contributing test runs and sessions, with their status.
- **Traceability**: each member issue paired with its linked test cases and each case's latest in-scope result — the result status, the run it was executed in, and the execution date. An uncovered issue (one with no linked cases) appears once as a coverage gap; a linked case with no in-scope result reads **Not run**.
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
