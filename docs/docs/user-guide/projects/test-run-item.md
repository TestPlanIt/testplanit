---
title: Test Run Item
sidebar_position: 2 # After Add Test Run Modal
---

# Test Run Item Component

This component displays a summary of a single test run, typically shown in lists on the main [Test Runs](./runs.md) page (both Active and Completed tabs).

It provides a quick overview of the run's status and key information, presented in a consistent two-line layout.

## Layout and Information

The item is laid out in two lines, so a run's identity always reads first and
its detail follows beneath.

**Identity line**

- **Selection Checkbox**: Shown at the start of the row for users with edit, complete, or delete permission. Ticking it selects the run for [bulk operations](./runs.md#bulk-operations).
- **Name**: Displays the test run name with a Play Circle icon, or a Bot icon for automated runs. The name is a link that navigates to the [Test Run Details](./run-details.md) page for that specific run. Hovering over the row shows a link icon, and the full name is always available in a tooltip when it is too long to fit.
- **Indicators**: A **lock icon** when the run's [composition is locked](./run-details.md#composition-lock), a **multi-configuration icon** when the run belongs to a configuration group, a flame for runs created in the last few minutes, and a **pending review badge** when the run is awaiting a decision.
- **Configuration**: The run's configuration, when it has one.
- **Status**: The current workflow state, using the `WorkflowStateDisplay` component — the state's icon, name, and associated color.
- **Actions Menu**: A vertical ellipsis (`...`) button opens a dropdown with **Edit**, **Duplicate**, **Complete**, and the record key, subject to your permissions.

**Detail line**

- **Test Case Summary**: The execution status of the cases in the run, using the `TestRunCasesSummary` component — a segmented bar plus counts, elapsed time and total estimate. Every segment links to its case. When a run has more cases than the bar can seat, the bar **scrolls horizontally** rather than hiding the cases that no longer fit.
- **Milestone**: The associated [Milestone](./milestones.md), when the run has one and the surrounding list is not already grouped by milestone.
- **Completion Date**: Shown in place of the members on completed runs.
- **Members**: User avatars involved with the run (creator, assigned testers, executors), shown at the end of the line using the `MemberList` component. These are the same three roles the [My Test Runs filter](./runs.md#what-counts-as-taking-part) matches on, so filtering by it keeps the runs your avatar appears on.

**Note line**

- A single line preview of the test run's description, when one is set. Uses the plain text version from the rich-text editor.

## Responsive Behavior

The item adapts to the width of the area holding it rather than to the browser
window, so the same run shown in a narrow side panel collapses independently of
a full-width list.

As the row narrows, information gives way in a fixed order, least important
first: the note, then the forecast-style detail and configuration, then the
milestone, then the member avatars, and finally the smaller indicator glyphs.
The run name is the last thing to give up space, and even then it truncates
rather than disappearing, with the full text in its tooltip.

## Styling

- The background and border colors of the item are subtly tinted based on the color associated with the test run's current workflow state.
- Newly created test runs (e.g., after adding via the modal) might have a temporary highlighted border or pulsing animation to draw attention.
