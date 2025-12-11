---
title: Test Run Details
sidebar_position: 3 # After Test Run Item
---

# Test Run Details Page

This page provides a detailed view of a specific test run, including its configuration, associated test cases, execution status, and related information.

It's accessed by clicking on a test run's name from the main [Test Runs](./runs.md) page.

## Page Layout

The page uses a resizable two-panel layout:

1. **Left Panel**: Contains the main content about the test run itself (description, docs) and the list of included test cases.
2. **Right Panel**: Displays metadata (state, configuration, milestone, tags, attachments, creator) and, when a test case is selected from the left panel, shows the details for executing that specific case.

## Header

The header displays:

- **Back Button**: Navigates back to the main [Test Runs](./runs.md) page (only visible in View mode).
- **Test Run Name**: The name of the test run. In Edit mode, this becomes an editable text area.
- **Action Buttons**:
  - **View Mode (Active Run)**:
    - **Edit** (`SquarePen` icon): Switches the page to Edit mode (if user has permission).
    - **Complete** (`CircleCheckBig` icon): Opens a confirmation dialog to mark the run as finished. Here you select the final "Done" state from the workflow and set the completion date. This action is irreversible (if user has permission).
  - **View Mode (Completed Run)**:
    - Displays a "Completed On [Date]" badge.
    - **Delete** (`Trash2` icon): Opens a confirmation dialog to permanently delete the test run and all its associated results. This action is irreversible (Admin only).
  - **Edit Mode**:
    - **Save** (`Save` icon): Saves changes made in Edit mode.
    - **Cancel** (`CircleSlash2` icon): Discards changes and returns to View mode.
    - **Delete** (`Trash2` icon): Opens a confirmation dialog to permanently delete the test run and all its associated results. This action is irreversible (Admin only).
- **Test Case Summary**: Below the title, a summary shows the progress of the test cases within the run (passed, failed, blocked, etc.).

## Left Panel Content

- **Description**: Displays the test run's description using a rich-text viewer. In Edit mode, this becomes an editable TipTap editor.
- **Documentation**: Displays linked documentation using a rich-text viewer. In Edit mode, this becomes an editable TipTap editor.
- **Test Cases Section**:
  - **Title**: "Cases in this Run".
  - **List**: Displays the [Test Case Repository](./repository.md) view, filtered to show only the test cases included in _this specific run_.
    - **View Mode**: Shows test cases with their current execution status (pass, fail, blocked, untested) and allows clicking on a case to view its execution details in the right panel.
    - **Edit Mode**: Allows selecting/deselecting test cases to be included in the run. The standard repository filtering and folder structure are available. A confirmation dialog appears if removing test cases, as this action deletes associated results.
    - **Run Mode**: When viewing a case in the right panel, the left panel shows the test cases list, allowing navigation between them.

## Multi-Configuration Support

When a test run is part of a Configuration Group (created during test run creation), you can view and analyze test results across multiple configurations simultaneously.

### Configuration Selector

Above the test cases section, a configuration selector allows you to:

- **View Single Configuration**: Select one configuration to see only test cases for that specific run
- **View Multiple Configurations**: Select multiple configurations to see aggregated data across all selected runs
- **Select All**: Quickly select all configurations in the group

### Multi-Configuration Data Display

When multiple configurations are selected:

- **Summary Statistics**: The test case summary shows aggregated counts across all selected configurations (e.g., "Total: 60 cases" when viewing 3 configurations with 20 cases each)
- **Status Distribution**: The donut chart displays combined status counts for all selected configurations
- **Test Cases Table**: Shows test cases with their configuration name displayed, allowing you to see status differences across environments
- **Tooltips**: Hovering over status indicators shows the configuration name for each test case
- **Filtering**: The ViewSelector filters work across all selected configurations, showing accurate counts

This feature is useful for:
- Comparing test results across different browsers, operating systems, or environments
- Getting an overview of testing progress across a matrix of configurations
- Identifying test cases that fail in specific configurations

## Right Panel Content

- **Default View / Edit Mode**: Displays metadata and controls:
  - **State**: Shows the current workflow state. In Edit mode, it becomes a dropdown to change the state.
  - **Configuration**: Shows the linked configuration. In Edit mode, it becomes a dropdown.
  - **Milestone**: Shows the linked milestone. In Edit mode, it becomes a dropdown (only active milestones are shown; completed milestones are excluded).
  - **Tags**: Displays assigned tags. In Edit mode, allows managing tags.
  - **Attachments**: Displays attachments. In Edit mode, allows uploading and managing attachments.
  - **Created By**: Shows the user who created the run (View mode only).
- **Test Case Execution View** (When a test case is selected from the left panel in View mode):
  - The right panel switches to display the `TestRunCaseDetails` component.
  - This allows users to view the test case steps, expected results, execute steps, record results (Pass/Fail/Block/Skip), add comments, and attach files specifically to the result of that test case execution within this run.
  - See [Test Case Execution](./test-case-execution.md) for details on this view.

## Dialogs

- **Remove Cases Confirmation**: Appears in Edit mode if the user attempts to save after removing test cases, warning that results will be deleted.

## Included Test Cases Table

This table lists all the test cases included in the current test run:

- **Checkbox**: For selecting multiple cases for bulk actions (e.g., assigning testers).
- **Order (#)**: The execution order within the run (can often be changed via drag-and-drop if the run is not locked).
- **Test Case Name**: Opens the [Test Case Execution](./test-case-execution.md) sidebar for that specific case.
- **Estimate**: The original estimated time (from the test case definition) needed to execute the case. Displayed in a human-readable format (e.g., "5m").
- **State**: The workflow state of the test case version included in the run.
- **Priority**: The priority of the test case version.
- **Assignee**: The user assigned to execute this test case within this run. Can often be assigned/changed here.
- **Status**: The current execution status for this case _within this run_ (e.g., Not Started, Passed, Failed). This often acts as a link to start or view the execution.
- **Last Result**: Sometimes shows the status of the most recent execution attempt if multiple attempts are allowed.
- **Tags**: Tags associated with the test case version.
- **Actions** (Ellipsis Menu):
    - **Execute**: Starts the test case execution flow.
    - **View Execution(s)**: Shows the history of attempts for this case in this run.
    - **Assign**: Allows changing the assigned tester.
    - **Remove**: Removes the test case from this run (often only possible before execution starts).
