---
title: Sessions
sidebar_position: 6 # Position after Test Runs & Results
---

# Sessions Page

Sessions are used for exploratory testing or other types of unstructured testing activities. This page provides an overview of all test sessions within the current project.

## Page Layout

Similar to the Test Runs page, this page is structured within a card layout and features:

1. **Header**:

    - Displays the title "Sessions".
    - Shows the current Project Name and Icon.
    - Includes an **Add Session** button (visible to users with appropriate permissions - Admin or Project Admin) to open the [Add Session dialog](./sessions-add.md).

2. **Summary Cards**: A collapsible **Summary** section of chart cards (work distribution, recent session results, and completion trend). Collapse it with its header to give the session list the full page; the choice is remembered per project in your browser.

3. **Tabs**:
    - **Active**: Shows sessions that are currently in progress (not marked as completed).
    - **Completed**: Shows sessions that have been marked as completed.

## Active Tab

This is the default view. Active sessions are grouped by their associated milestone:

- **Milestone Groups**: Each milestone with associated active sessions is displayed as a collapsible section header. The header shows:
  - Milestone Icon and Name ([See Milestone Details](./milestone-details.md))
  - Milestone Status Badge (e.g., Upcoming, In Progress, Completed)
  - Milestone Dates (Start/End/Due)
  - An **Add Session** button specific to that milestone, allowing you to quickly create a session linked to it.
- **Unscheduled Sessions**: Sessions not linked to any milestone are grouped under a special "Unscheduled" section header.
  - This section also has an **Add Session** button to create an unscheduled session.
- **Session Items**: Within each group (Milestone or Unscheduled), individual sessions are listed. See [Session Item Details](./sessions-item.md) for more information on how each session is displayed.

  _Sessions within milestone groups are sorted by creation date. Milestones themselves are sorted logically (often chronologically based on start/end dates or a defined order)._

- **Empty State**: If there are no active sessions, a message is displayed, along with a prominent **Create Session** button (if the user has permission).

## Bulk Operations

Several sessions can be changed in one step. Users with edit, complete, or delete permission for sessions see a **checkbox** at the start of each session row; without any of those permissions the checkboxes are hidden entirely.

Ticking at least one checkbox reveals a toolbar above the list. Each action button carries the number of selected sessions it will apply to, and the **X** button deselects everything. On narrow windows the buttons collapse into a single **⋮** menu.

- **Edit**: Opens a dialog for changing the **milestone**, **workflow state**, **assignee**, and **tags** of every selected session. Tick the fields you want to change — untouched fields keep each session's current value. The assignee field can also bulk-**unassign**, and tags are **added** to each session's existing tags, never replacing them.
- **Complete**: Completes every selected active session at once. Like the single-session dialog, you pick the done state and the completion date; each session records a version snapshot exactly as it would when completed individually.
- **Delete**: Deletes the selected sessions after confirmation. Historical data remains in the project, and deleted sessions can be restored from the [Trash](../trash.md).

**Edit** and **Complete** skip sessions that are already completed, and each button's count reflects only the selected sessions it will actually touch. **Delete** applies to any selected session, so on the **Completed** tab it is the one action available.

Actions you lack permission for are not shown, and every change is checked per session on the server — if some sessions cannot be updated, the rest still go through and a message reports how many failed.

## Completed Tab

This tab displays a flat list of all sessions that have been marked as completed.

- **Sorting**: Completed sessions are sorted by their **completion date**, with the most recently completed sessions appearing first.
- **Session Items**: Each completed session is displayed using the [Session Item](./sessions-item.md) component, showing key details.
- **Empty State**: If there are no completed sessions, a message indicating this is shown.

## Multi-Configuration Sessions

Sessions support selecting multiple configurations when creating or duplicating. When multiple configurations are selected, one session is created per configuration, all sharing the same metadata (name, template, state, milestone, tags, etc.) and linked via a shared configuration group ID. This is useful for testing across multiple environments (e.g., Chrome, Firefox, Safari) without manually creating separate sessions. See [Add Session - Multi-Configuration Support](./sessions-add.md#multi-configuration-support) for details.

Grouping can also be corrected after the fact — a session can join, change, or leave a group from the **Configuration Group** field on its [details page](./sessions-details.md).

## Session Duplication

Any session can be duplicated from its context menu (three-dot menu on the session item). Duplicating opens the Add Session dialog pre-populated with the original session's metadata, allowing you to quickly re-test scenarios for regression cycles or new milestones. Results are not copied — the new session starts fresh. See [Add Session - Session Duplication](./sessions-add.md#session-duplication) for details.
