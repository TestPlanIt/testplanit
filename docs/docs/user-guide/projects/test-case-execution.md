---
title: Test Case Execution
sidebar_position: 4 # After Test Run Details
---

# Test Case Execution View

When you select a specific test case from the list within an active [Test Run](./run-details.md), the right panel changes to show the details for executing that case within the context of the run.

This view allows you to follow the test steps, record results, add comments, and manage attachments specific to this execution.

## Layout and Components

This view typically includes:

1. **Header**:

    - **Test Case Name**: Displays the name of the test case being executed.
    - **Current Status**: Shows the current overall status (e.g., Untested, Passed, Failed, Blocked) for this case _within this specific run_.
    - **Navigation**: **Previous Case** and **Next Case** buttons, with the case's position in the list, move between test cases without returning to the main list.
    - **Close Button**: Returns the right panel to the default Test Run metadata view.

2. **Overall Result Controls**: Buttons to record a result for the _entire test case_ within this run:

    - **Add Result**: Opens the **Add Result** dialog, where you choose a status from the project's result statuses and add result details, elapsed time, attachments, and linked issues.
    - **Pass & Next**: Records a passing result and moves to the next case. The arrow beside it lists the project's other statuses for recording one of those instead.

3. **Steps List**: Displays the steps defined in the test case, usually including:

    - **Step Number/Order**.
    - **Action/Description**: The instruction for the step.
    - **Expected Result**: What should happen after performing the action.
    - **Layout**: The icon above the steps switches between the expected result sitting under its step (the default) and the two side by side. The choice is saved to your profile and is shared with the case details view and editor. On a narrow panel, steps stack regardless.
    - **Step Results**: In the **Add Result** dialog each step can be given its own status, notes, and linked issues. A step recorded with a failure status marks the case as failed in the run.

4. **Result Details**: A rich-text editor in the **Add Result** dialog for notes on the overall execution of the test case in this run (e.g., explaining why it was blocked, general observations).

5. **Attachments**: An area in the **Add Result** dialog to upload attachments relevant to the _overall_ execution result of this test case within the run.

## Execution Workflow

1. **Select Case**: Click a test case from the list in the left panel of the Test Run Details page.
2. **Review Steps**: Read the action and expected result for each step.
3. **Perform Action**: Execute the test step action in the system under test.
4. **Record the Result**: Click **Pass & Next** if every step passed, or click **Add Result** to choose another status.
5. **Add Step Details (Optional)**: In the **Add Result** dialog, set a status, notes, or linked issues on individual steps.
6. **Add Overall Details (Optional)**: Add result details, elapsed time, attachments, or linked issues, then save.
7. **Navigate/Close**: Use the **Previous Case** / **Next Case** buttons or the Close button to move to another case or return to the run overview.

## Editing the Test Case In Place

If you hold the **Test Case Repository** add/edit permission, an **Edit Test Case** button (pencil icon) appears next to the Previous/Next navigation in the panel header. Clicking it replaces the execution view with the same edit form used on the [Test Case Details](./repository-case-details.mdx) page, so you can correct the name, steps, or fields before recording a result.

- **Save** creates a new version of the test case and returns to the execution view. Results recorded afterwards reference the new version.
- **Cancel** discards the changes and returns to the execution view.

## Result Validation and Editing

A project can apply rules that govern how results are recorded and corrected. These are configured by administrators and surface during execution:

- **Required result fields**: If the case's template includes a [required Result Field](../templates-fields.md#required-result-fields), the result can't be saved without it. The quick **Pass & Next** button (and per-iteration quick-status buttons) open the full **Add Result** dialog, pre-set to the chosen status, so you can fill in the required field before saving.
- **Result edit window**: After a result is recorded, it can be edited in place only for as long as the project's [Result Edit Window](../projects.md#advanced-settings) allows. Once that window closes, recording a correction creates a new attempt instead of overwriting the existing result, so the full history is preserved. System administrators can always edit a result.
- **Flip justification**: If the project [requires justification on a result flip](../projects.md#advanced-settings), changing one completed outcome to a different completed outcome prompts for **Result Details** explaining the change before the result is saved. This covers any pair of completed statuses whose pass/fail judgment differs — including changes to or from any status marked as **Completed** on the Admin > Statuses page. Moving to or from a non-completed status (Untested, Retest, Blocked) is not gated.
- **Issue on failure**: If the project [requires a linked issue on failure](../projects.md#advanced-settings), recording a failure status (any status marked **Failure** on the Admin > Statuses page) requires at least one linked issue — on the result or on a failing step. Choosing a failure status from a quick-status button opens the **Add Result** dialog with a prompt to link an issue before saving.
- **Dependencies**: If the project [enforces test case dependencies](./settings/advanced.md#enforce-test-case-dependencies-in-test-runs), a case is marked **Blocked** while any case it depends on has not passed in this run. The panel lists the prerequisites it is waiting on, the result controls (including per-iteration results and bulk skip on a parameterized case) are disabled, and a result sent anyway is refused. The case's own status is unchanged, and any result it already has can still be edited. Once the last prerequisite passes, the case opens and its assignee is notified. Prerequisites that aren't in the run are listed as a warning but don't block.
