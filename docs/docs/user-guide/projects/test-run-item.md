---
title: Test Run Item
sidebar_position: 2 # After Add Test Run Modal
---

# Test Run Item Component

This component displays a summary of a single test run, typically shown in lists on the main [Test Runs](./runs.md) page (both Active and Completed tabs).

It provides a quick overview of the run's status and key information, presented in a consistent grid layout.

## Layout and Information

The component uses a 4-column grid:

1. **Name & Note (Left Column)**:

    - **Name**: Displays the test run name with a Play Circle icon. The name is a link that navigates to the [Test Run Details](./run-details.md) page for that specific run. Hovering over the name shows a link icon.
    - **Note**: A single line preview of the test run's description (if provided). Uses the plain text version from the rich-text editor.

2. **Status (Middle Column 1)**:

    - Displays the current workflow state of the test run using the `WorkflowStateDisplay` component. This typically includes the state's icon, name, and associated color.

3. **Test Case Summary (Middle Column 2)**:

    - Shows a summary of the execution status of the test cases included in the run using the `TestRunCasesSummary` component. This usually includes counts or percentages of passed, failed, blocked, skipped, or untested cases.

4. **Members & Actions (Right Column)**:
    - **Active Runs**: Displays user avatars involved with the run (creator, assigned testers, executors) using the `MemberList` component.
    - **Completed Runs**: Shows the associated [Milestone](./milestones.md) (if any) and the completion date.
    - **Actions Menu** (Visible on Active runs for Admins/Project Admins):
      - A vertical ellipsis (`...`) button triggers a dropdown menu.
      - **Complete**: Opens the **Complete Test Run Dialog** to mark the run as finished.

## Styling

- The background and border colors of the item are subtly tinted based on the color associated with the test run's current workflow state.
- Newly created test runs (e.g., after adding via the modal) might have a temporary highlighted border or pulsing animation to draw attention.
