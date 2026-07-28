---
sidebar_position: 5
title: Statuses
---

# Statuses Administration

Statuses represent the different states a Session Result or Test Case Result can be in, often used for quick visual indication through color-coding (e.g., Pass, Fail, Blocked, Untested). This section explains how administrators can define and manage these statuses.

To access this page, enter the Administration area and select **Statuses** from the left-hand navigation menu.

## Viewing Statuses

The Statuses page displays a table listing all configured statuses with the following columns:

- **Name**: The user-friendly name of the status, displayed alongside its color indicator.
- **System Name**: The internal identifier used by the system (unique, cannot be changed after creation).
- **Aliases**: (Optional) Alternative system names, separated by commas, that might be used for integrations or imports.
- **Enabled**: A switch indicating if the status is active and available for use.
- **Success**: A switch indicating if this status represents a successful outcome (e.g., "Pass"). Mutually exclusive with "Failure".
- **Failure**: A switch indicating if this status represents a failed outcome (e.g., "Fail"). Mutually exclusive with "Success".
- **Completed**: A switch indicating if this status signifies that the item is considered complete or finished (e.g., "Pass", "Fail", "Exception").
- **Scope**: Icons representing the areas where this status is applicable (e.g., Test Runs, Sessions, Automation). Hovering over an icon reveals the scope name.
- **Projects**: A count or list indicating which specific projects this status is assigned to.
- **Actions**: Buttons to **Edit** or **Delete** the status.

  :::info Note on "Untested"
  The system includes a special, non-editable, non-deletable status with the System Name `untested`. This status is typically used as the default for new test results and cannot be modified or deleted.
  :::

## Adding a New Status

1. Click the **Add Status** button located at the top right of the table.
2. A modal window will appear. Configure the new status:
    - **Color**: Select a color for the status using the color picker (required).
    - **Name**: Enter a descriptive, user-friendly name (e.g., "Passed", "Needs Retest") (required).
    - **System Name**: Enter a unique internal identifier (required). It must start with a letter and contain only letters, numbers, and underscores. This is often auto-generated based on the Name but can be customized.
    - **Aliases**: (Optional) Enter any alternative system names, separated by commas. Must follow the same format rules as System Name.
    - **Enabled**: Toggle on/off. Defaults to on.
    - **Success**: Toggle on/off. Defaults to off. Toggling this on will automatically turn off "Failure".
    - **Failure**: Toggle on/off. Defaults to off. Toggling this on will automatically turn off "Success".
    - **Completed**: Toggle on/off. Defaults to off.
    - **Scope**: Use the multi-select dropdown to choose which areas (Cases, Runs, Sessions) this status applies to. You can use the "Select All" link.
    - **Projects**: Use the multi-select dropdown to assign this status to specific projects. You can use the "Select All" link.
3. Click **Submit**.

## Editing an Existing Status

1. Locate the status you wish to modify in the table.
2. Click the **Edit** icon in the **Actions** column. (Note: The "Untested" status cannot be edited).
3. A modal window will appear. You can modify:
    - Color
    - Name
    - Aliases
    - Enabled / Success / Failure / Completed toggles
    - Scope assignments
    - Project assignments
    - _(Note: System Name cannot be changed after creation)._
4. Click **Submit** to save the changes.

## Deleting a Status

Deleting a status marks it as inactive and removes its assignments.

1. Locate the status you wish to remove in the table.
2. Click the **Delete** icon in the **Actions** column. (Note: The "Untested" status cannot be deleted).
3. A confirmation dialog will appear, warning that this action cannot be undone.
4. Click **Delete** to confirm.

## Result Editing Policy

The **Result editing policy** card on the Statuses page controls how long after a result is recorded it can still be edited **in place**, across all projects. Recorded results are never overwritten silently — once the editing window closes, a correction is captured as a new attempt, preserving the full result history.

Choose one of three modes:

- **No restriction (projects decide)**: There is no system-wide limit. Each project decides its own behavior in its [Advanced settings](./projects.md#advanced-settings). This is the default.
- **Disable editing everywhere**: In-place editing is turned off for every project, and projects **cannot** re-enable it. Corrections always require a new attempt.
- **Allow editing up to a maximum window**: Set a **Maximum window (minutes)**. Projects may edit results up to this limit, and may **tighten** it (a shorter window, or disabling editing entirely) in their Advanced settings, but never **loosen** it beyond the system maximum.

After choosing a mode (and a window, where applicable), click **Save policy**.

:::info System administrators
System administrators can always edit a recorded result, regardless of the policy. The editing window applies to project administrators and other users. All edits are recorded in the [Audit Log](./audit-logs.md) with the before and after values.
:::

## Abandoned Automation Cleanup

The **Abandoned automation cleanup** card on the Statuses page controls whether automated test runs that stopped receiving results are closed automatically, across all projects.

When a CI job is aborted or its agent dies, the run it created never receives its completion call and stays **In Progress** indefinitely — it lingers in the Active tab and on the runs page's [Automation Runs card](./projects/runs.md#automation-runs-in-progress). With cleanup enabled, a background sweep runs every 15 minutes and closes any incomplete automated run that has received no results for the configured idle time, so a run is closed at most ~15 minutes after crossing its threshold. Manual runs are never touched — they may legitimately stay open for months.

Choose one of two modes:

- **Off (abandoned runs stay open)**: No system-wide cleanup. Individual projects can still opt in through their [Advanced settings](./projects.md#abandoned-automation-cleanup). This is the default, so existing installations are unaffected on upgrade.
- **Close abandoned automated runs automatically**: Set the idle threshold in minutes (minimum 15, matching the sweep cadence). A run is considered abandoned only when _nothing_ has been imported for that long — an in-flight run with a quiet stretch is left alone, so pick a threshold comfortably longer than the longest pause a healthy run can have. A full day (1440 minutes) is a safe default.

After choosing a mode (and a threshold, where applicable), click **Save policy**.

A swept run is marked completed and moved to the project's first **Done** run state, unless the project configured a different target state in its Advanced settings. Each closure is recorded in the [Audit Log](./audit-logs.md) and emits the usual `test_run.state_changed` and `test_run.completed` [webhook events](./webhooks.md).
