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
2. Click the **Edit** (pencil) icon in the **Actions** column. (Note: The "Untested" status cannot be edited).
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
2. Click the **Delete** (trash can) icon in the **Actions** column. (Note: The "Untested" status cannot be deleted).
3. A confirmation dialog will appear, warning that this action cannot be undone.
4. Click **Delete** to confirm.
