---
title: Test Runs
sidebar_position: 5 # Position after Repository
---

# Test Runs Page

This page provides an overview of all test runs within the current project. Test runs are specific instances where a set of test cases are executed against a particular configuration or environment.

## Page Layout

The page is structured within a card layout and features:

1. **Header**:

    - Displays the title "Test Runs".
    - Shows the current Project Name and Icon.
    - Includes an **Add Test Run** button (visible to users with appropriate permissions - Admin or Project Admin) to open the [Add Test Run Modal](./add-test-run-modal.md).

2. **Tabs**:
    - **Active**: Shows test runs that are currently in progress (not marked as completed).
    - **Completed**: Shows test runs that have been marked as completed.

## Filtering

The Test Runs page includes a **Type Filter** dropdown that allows you to filter test runs by their type:

- **All**: Shows both manual and automated test runs (default)
- **Manual**: Shows only manual test runs
- **Automated**: Shows only automated test runs

:::tip Shareable Filter URLs
The selected filter is saved in the URL, so you can share a filtered view with teammates or bookmark it for quick access. When someone opens the shared link, they'll see the same filter applied.
:::

## Active Tab

This is the default view. Active test runs are grouped by their associated milestone:

- **Milestone Groups**: Each milestone with associated active test runs is displayed as a collapsible section header. The header shows:
  - Milestone Icon and Name ([See Milestone Details](./milestone-details.md))
  - Milestone Status Badge (e.g., Upcoming, In Progress, Completed)
  - Milestone Dates (Start/End/Due)
  - An **Add Test Run** button ( `+` icon) specific to that milestone, allowing you to quickly create a run linked to it.
- **Unscheduled Runs**: Test runs not linked to any milestone are grouped under a special "Unscheduled" section header.
  - This section also has an **Add Test Run** button to create an unscheduled run.
- **Test Run Items**: Within each group (Milestone or Unscheduled), individual test runs are listed. See [Test Run Item Details](./test-run-item.md) for more information.

  _Test runs within milestone groups are sorted by creation date. Milestones themselves are sorted logically (often chronologically based on start/end dates or a defined order)._

- **Empty State**: If there are no active test runs, a message is displayed, along with a prominent **Create Test Run** button (if the user has permission).

### Drag and Drop to Milestones

Active test runs can be reassigned to different milestones using drag and drop:

1. **Hover** over a test run to reveal the grip handle (⋮⋮) on the left side
2. **Drag** the test run by the grip handle
3. **Drop** it onto a different milestone group or the "Unscheduled" section

The milestone assignment is updated immediately. Visual feedback shows valid drop targets as you drag.

:::info Permissions Required
Drag and drop is only available to users with edit permissions for test runs. Completed test runs cannot be dragged.
:::

## Completed Tab

This tab displays a flat list of all test runs that have been marked as completed.

- **Sorting**: Completed runs are sorted by their **completion date**, with the most recently completed runs appearing first.
- **Test Run Items**: Each completed run is displayed using the [Test Run Item](./test-run-item.md) component, showing key details.
- **Empty State**: If there are no completed test runs, a message indicating this is shown.
