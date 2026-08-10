---
title: Session Item
sidebar_position: 2 # After Add Session
---

# Session Item Component

This component displays a summary of a single test session, typically shown in lists on the main [Sessions page](./sessions.md) (both Active and Completed tabs).

It provides a quick overview of the session's status and key information, presented in a consistent two-line layout.

## Layout and Information

The item is laid out in two lines: identity above, detail below.

**Identity line**

- **Selection Checkbox**: Shown at the start of the row for users with edit, complete, or delete permission. Ticking it selects the session for [bulk operations](./sessions.md#bulk-operations).
- **Name**: Displays the session name with a Compass icon. The name is a link that navigates to the [Session Details](./sessions-details.md) page for that specific session. Hovering over the row shows a link icon, and the full name is always available in a tooltip when it is too long to fit.
- **Indicators**: A **multi-configuration icon** when the session belongs to a configuration group, a flame for sessions created in the last few minutes, and a **pending review badge** when the session is awaiting a decision.
- **Configuration**: The session's configuration, when it has one.
- **Status**: The current workflow state (e.g. "To Do", "In Progress") using the `WorkflowStateDisplay` component, showing the state's icon, name, and color.
- **Actions Menu**: A vertical ellipsis (`...`) button opens a dropdown, subject to your permissions:
  - **Edit**: Navigates to the session detail page in edit mode (available on active sessions).
  - **Complete**: Opens the confirmation dialog to mark the session as finished. See [Session Details](./sessions-details.md#header) for more on completing a session.
  - **Duplicate**: Opens the [Add Session](./sessions-add.md#session-duplication) dialog pre-populated with the session's metadata, allowing quick re-creation for regression cycles or new milestones.

**Detail line**

- **Results Summary**: The results recorded within the session using the `SessionResultsSummary` component — a segmented bar plus counts of notes, bugs and questions. The bar **scrolls horizontally** when a session has more results than it can seat.
- **Milestone**: The associated [Milestone](./milestones.md), when the session has one and the surrounding list is not already grouped by milestone.
- **Completion Date**: Shown in place of the members on completed sessions.
- **Members**: User avatars involved with the session (Creator, Assigned To), shown at the end of the line using the `MemberList` component. These are the same two roles the [My Sessions filter](./sessions.md#what-counts-as-taking-part) matches on, so filtering by it keeps the sessions your avatar appears on.

**Note line**

- A single line preview of the session's description, when one is set, showing the plain text version.

## Styling

- The background and border colors of the item are subtly tinted based on the color associated with the session's current workflow state.
- Newly created sessions might have a temporary highlighted border or pulsing animation.
