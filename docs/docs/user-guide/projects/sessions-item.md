---
title: Session Item
sidebar_position: 2 # After Add Session
---

# Session Item Component

This component displays a summary of a single test session, typically shown in lists on the main [Sessions page](./sessions.md) (both Active and Completed tabs).

It provides a quick overview of the session's status and key information, presented in a consistent grid layout.

## Layout and Information

The component uses a 4-column grid, similar to the [Test Run Item](./test-run-item.md):

1. **Name & Note (Left Column)**:

    - **Name**: Displays the session name with a Compass icon. The name is a link that navigates to the [Session Details](./sessions-details.md) page for that specific session. Hovering over the name shows a link icon.
    - **Note**: A single line preview of the session's description (if provided), showing the plain text version.

2. **Status (Middle Column 1)**:

    - Displays the current workflow state of the session (e.g., "To Do", "In Progress") using the `WorkflowStateDisplay` component, showing the state's icon, name, and color.

3. **Results Summary (Middle Column 2)**:

    - Shows a summary of the results recorded within the session (e.g., counts of notes, bugs, questions) using the `SessionResultsSummary` component.

4. **Members & Actions (Right Column)**:
    - **Active Sessions**: Displays user avatars involved with the session (Creator, Assigned To) using the `MemberList` component.
    - **Completed Sessions**: Shows the associated [Milestone](./milestones.md) (if any) and the completion date.
    - **Actions Menu** (Visible on Active sessions for Admins/Project Admins):
      - A vertical ellipsis (`...`) button triggers a dropdown menu.
      - **Complete**: Opens the confirmation dialog to mark the session as finished. See [Session Details](./sessions-details.md#header) for more on completing a session.

## Styling

- The background and border colors of the item are subtly tinted based on the color associated with the session's current workflow state.
- Newly created sessions might have a temporary highlighted border or pulsing animation.
