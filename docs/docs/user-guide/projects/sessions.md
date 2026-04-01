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

2. **Tabs**:
    - **Active**: Shows sessions that are currently in progress (not marked as completed).
    - **Completed**: Shows sessions that have been marked as completed.

## Active Tab

This is the default view. Active sessions are grouped by their associated milestone:

- **Milestone Groups**: Each milestone with associated active sessions is displayed as a collapsible section header. The header shows:
  - Milestone Icon and Name ([See Milestone Details](./milestone-details.md))
  - Milestone Status Badge (e.g., Upcoming, In Progress, Completed)
  - Milestone Dates (Start/End/Due)
  - An **Add Session** button (`+` icon) specific to that milestone, allowing you to quickly create a session linked to it.
- **Unscheduled Sessions**: Sessions not linked to any milestone are grouped under a special "Unscheduled" section header.
  - This section also has an **Add Session** button to create an unscheduled session.
- **Session Items**: Within each group (Milestone or Unscheduled), individual sessions are listed. See [Session Item Details](./sessions-item.md) for more information on how each session is displayed.

  _Sessions within milestone groups are sorted by creation date. Milestones themselves are sorted logically (often chronologically based on start/end dates or a defined order)._

- **Empty State**: If there are no active sessions, a message is displayed, along with a prominent **Create Session** button (if the user has permission).

## Completed Tab

This tab displays a flat list of all sessions that have been marked as completed.

- **Sorting**: Completed sessions are sorted by their **completion date**, with the most recently completed sessions appearing first.
- **Session Items**: Each completed session is displayed using the [Session Item](./sessions-item.md) component, showing key details.
- **Empty State**: If there are no completed sessions, a message indicating this is shown.

## Multi-Configuration Sessions

Sessions support selecting multiple configurations when creating or duplicating. When multiple configurations are selected, one session is created per configuration, all sharing the same metadata (name, template, state, milestone, tags, etc.) and linked via a shared configuration group ID. This is useful for testing across multiple environments (e.g., Chrome, Firefox, Safari) without manually creating separate sessions. See [Add Session - Multi-Configuration Support](./sessions-add.md#multi-configuration-support) for details.

## Session Duplication

Any session can be duplicated from its context menu (three-dot menu on the session item). Duplicating opens the Add Session dialog pre-populated with the original session's metadata, allowing you to quickly re-test scenarios for regression cycles or new milestones. Results are not copied — the new session starts fresh. See [Add Session - Session Duplication](./sessions-add.md#session-duplication) for details.
