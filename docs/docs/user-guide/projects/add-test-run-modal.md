---
title: Add Test Run Modal
sidebar_position: 1 # First item under Test Runs
---

# Add Test Run Modal

This modal allows users to create new test runs within a project. It's typically accessed via the 'Add Test Run' or '+' buttons on the main [Test Runs](./runs.md) page.

The process involves two steps:

1. **Basic Information**: Entering details like name, configuration, milestone, etc.
2. **Test Case Selection**: Choosing which test cases from the repository to include in the run.

## Step 1: Basic Information

This step collects the core details for the new test run. The form is split into two columns:

**Left Column:**

- **Name** (Required): A unique name for the test run.
- **Description**: A rich-text editor (TipTap) for adding details or context about the run.
- **Configuration**: Select configurations for the test run:
  - **Single Configuration**: Select one pre-defined [Configuration](../configurations.md) from the dropdown
  - **Multiple Configurations**: Use the multi-select combobox to select multiple configurations simultaneously
  - **None**: Select "None" if no specific configuration applies

  When multiple configurations are selected, a separate test run will be created for each configuration, all sharing the same test cases. These runs are grouped together in a "Configuration Group" allowing you to view aggregated data across all configurations. See [Multi-Configuration Support](./run-details.md#multi-configuration-support) for details on viewing multi-configuration data.
- **Milestone**: A dropdown to link the test run to a specific project [Milestone](./milestones.md). Select "None" if it's not tied to a milestone.
  - If the modal was opened using the `+` button on a specific milestone group on the Test Runs page, that milestone will be pre-selected here.
  - Only active (non-completed) milestones are shown in the dropdown. Completed milestones are excluded since new test runs should be associated with ongoing work.
- **Docs**: Another rich-text editor for linking to or embedding relevant documentation.

**Right Column:**

- **State** (Required): A dropdown to set the initial state of the test run, based on the available [Test Run Workflows](../workflows.md) configured for the project. The default workflow state is usually pre-selected.
- **Tags**: Allows selection of existing [Tags](../tags.md) to categorize the run.
- **Attachments**: Upload and manage files relevant to the test run.
  - Use the upload area to add new files.
  - Existing uploaded files are displayed below the upload area.

**Actions:**

- **Cancel**: Closes the modal without saving.
- **Next**: Validates the basic information and proceeds to Step 2.

## Step 2: Test Case Selection

This step involves selecting the test cases to be included in the run.

- **Layout**: This step displays the [Test Case Repository](./repository.md) in selection mode.
  - The standard repository view (folders, filters, views) is available.
  - Checkboxes appear next to each test case.
  - A drawer icon in the header shows the count of currently selected cases and allows viewing/managing the selection.
- **Selection**: Check the box next to any test case you want to include in this run.
- **Selected Cases Drawer**: Clicking the drawer icon opens a panel showing the list of selected test cases, allowing you to review and remove items if needed.

**Actions:**

- **Back**: Returns to Step 1 (Basic Information) without losing entered data.
- **Save**: Finalizes the test run creation. It saves the basic information and links the selected test cases to the new run. The modal closes, and the user is usually notified of the successful creation.

_(This modal uses components like `BasicInfoDialog` and `TestCasesDialog` internally to manage the two steps.)_
