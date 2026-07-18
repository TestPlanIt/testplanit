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
    - **Edit**: Switches the page to Edit mode (if user has permission).
    - **Duplicate**: Opens the duplication dialog to create a copy of the test run.
    - **Export PDF**: Exports the test run to a PDF document including all metadata, description, documentation, test cases (ordered by run order) with their execution status, results, step results, custom field values, and attachments. Available for both regular and JUnit/automated test runs.
    - **Assign**: Opens the [Distribute assignments](#distributing-assignments) dialog to spread the run's test cases across several team members at once (requires add/edit permission on Test Runs).
    - **Lock composition**: A toggle that freezes the run's case set. See [Composition lock](#composition-lock).
    - **Complete**: Opens a confirmation dialog to mark the run as finished. Here you select the final "Done" state from the workflow and set the completion date. This action is irreversible (if user has permission).
  - **View Mode (Completed Run)**:
    - Displays a "Completed On [Date]" badge.
    - **Duplicate**: Opens the duplication dialog to create a copy of the test run.
    - **Export PDF**: Exports the test run to PDF (available on completed runs as well).
    - **Delete**: Opens a confirmation dialog to permanently delete the test run and all its associated results. This action is irreversible (Admin only).
  - **Edit Mode**:
    - **Save**: Saves changes made in Edit mode.
    - **Cancel**: Discards changes and returns to View mode.
    - **Delete**: Opens a confirmation dialog to permanently delete the test run and all its associated results. This action is irreversible (Admin only).
  - **Activity**: Available in view mode for both regular and automated runs. Opens the run's [Activity Log](../audit-logs.md#viewing-an-items-activity) — a scoped history of every change, including test cases added or removed, results recorded, and status changes. Visible to anyone who can view the run.
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

## Distributing Assignments

The **Assign** button in the header (View mode, active runs) opens the **Distribute assignments** dialog, which spreads the run's test cases across several team members in one step — instead of assigning each case individually. It is available to users with add/edit permission on Test Runs and is disabled once a run is completed.

Rather than splitting cases at random, the distributor keeps related work together and balances the load, so testers spend less time switching context.

### Team members

Select one or more members to distribute the cases among. Only users with access to the project are listed.

### Options

- **Configurations** (multi-configuration runs only): distribute across **All configurations** in the group, or **This run only** (the currently viewed configuration).
- **Configuration strategy** (multi-configuration runs only):
  - **Split by configuration** (default): each tester owns whole configurations. Best when environments are expensive to set up, or specific people own specific environments, since each tester stays in one environment.
  - **Keep configurations together**: each tester owns a set of cases across every configuration. Best when the cost of learning a case outweighs the cost of switching environments, since each case is learned once and then repeated across configurations.
- **Group similar cases** (on by default): keeps cases in the same repository section — and sharing the same tags — with one tester, reducing context switching. (Applies to the Keep configurations together strategy.)
- **Balance by**:
  - **Estimated time** (default): balances the summed case estimates so each tester receives roughly equal _effort_. Cases without an estimate fall back to the median estimate; if no case has an estimate, this falls back to case count.
  - **Number of cases**: balances the case count so each tester receives roughly the same _number_ of cases.
- **Existing assignments**:
  - **Only fill unassigned cases** (default): leaves already-assigned cases untouched and distributes the rest.
  - **Reassign everything**: redistributes every case, overwriting existing assignees.

Completed cases are always skipped, as they can no longer be modified.

### Preview

A live preview updates as you change the options, showing each selected member with the number of **Cases** and the total **Estimate** they will receive. For multi-configuration runs, a column per configuration shows the per-environment breakdown; the **Team Member** and **Cases** columns stay pinned while the configuration columns scroll. Any skipped cases (already assigned, or completed) are noted below the table.

Click **Assign** to apply the distribution. Each assignee is notified of their newly assigned cases.

## Composition Lock

Composition locking freezes **which cases are in a run** so a cycle can start against a fixed scope. A locked run's case set can't change — but the run keeps running.

When a run is locked:

- **Frozen**: adding cases (including from the repository **Add to Test Run** action), removing cases, and reordering them. In the run's case table the drag handles disappear, and Edit mode shows the cases read-only.
- **Still works**: recording results, assigning testers, editing run metadata (name, state, configuration, milestone, tags, attachments), and adding comments.

A locked run is marked with a **lock icon** next to its name — on the run page and in the [Test Runs](./runs.md) list — and the cases section shows a banner explaining that the composition is frozen.

This is different from **completing** a run: completion permanently freezes _everything_ (composition and results), whereas a composition lock freezes only the case set while execution continues, and it can be unlocked.

### Locking and unlocking

- **Lock**: use the **Lock composition** toggle in the run header. Any user with add/edit permission on Test Runs can lock a run.
- **Unlock**: only the run's **creator**, a **Project Admin**, or a **system administrator** can unlock. For everyone else the toggle appears but is disabled, so an in‑flight scope can't be quietly reopened by any editor.

### Automatic locking

A project can lock runs automatically when they enter execution — enable **Lock run composition when execution starts** in the project's [Advanced settings](settings/advanced.md#lock-run-composition-when-execution-starts). Auto‑locked runs behave exactly like manually locked ones and can be unlocked the same way.

The lock is enforced everywhere — in the interface, through the API, and at the database — so a locked run's composition can't be changed by any path, whether or not the lock was applied automatically.

## Right Panel Content

- **Default View / Edit Mode**: Displays metadata and controls:
  - **State**: Shows the current workflow state. In Edit mode, it becomes a dropdown to change the state.
  - **Configuration**: Shows the linked configuration. In Edit mode, it becomes a dropdown limited to [Configurations](../configurations.md) assigned to this project.
  - **Milestone**: Shows the linked milestone. In Edit mode, it becomes a searchable dropdown (type to filter; only active milestones are shown; completed milestones are excluded).
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
    - **Remove**: Removes the test case from this run (not available once the run's [composition is locked](#composition-lock) or completed).
