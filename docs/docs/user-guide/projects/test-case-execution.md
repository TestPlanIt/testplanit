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
    - **Navigation**: May include Previous/Next buttons to move between test cases in the run sequence without returning to the main list.
    - **Close Button** (`X` icon): Returns the right panel to the default Test Run metadata view.

2. **Overall Result Controls**: Buttons to set the overall status for the _entire test case_ within this run:

    - **Pass** (`Check` icon): Marks the entire case as passed.
    - **Fail** (`X` icon): Marks the entire case as failed.
    - **Block** (`CircleSlash` icon): Marks the case as blocked (e.g., due to an environment issue or dependency).
    - **Skip** (`SkipForward` icon): Marks the case as skipped.
    - _(Setting an overall result might automatically update step results accordingly, depending on configuration.)_

3. **Steps List**: Displays the steps defined in the test case, usually including:

    - **Step Number/Order**.
    - **Action/Description**: The instruction for the step.
    - **Expected Result**: What should happen after performing the action.
    - **Step Result Controls**: Individual Pass/Fail/Block/Skip buttons _for each step_. Setting a step result often updates the overall case result automatically (e.g., failing one step fails the case).
    - **Step Comment Area**: An optional field to add notes specific to the execution of that step.
    - **Step Attachments**: An option to attach files (screenshots, logs) directly related to the result of that specific step.

4. **Overall Comments**: A rich-text editor area to add comments relevant to the overall execution of the test case in this run (e.g., explaining why it was blocked, general observations).

5. **Overall Attachments**: An area to upload and view attachments relevant to the _overall_ execution result of this test case within the run.

## Execution Workflow

1. **Select Case**: Click a test case from the list in the left panel of the Test Run Details page.
2. **Review Steps**: Read the action and expected result for each step.
3. **Perform Action**: Execute the test step action in the system under test.
4. **Record Step Result**: Click the Pass, Fail, Block, or Skip button for the step based on the outcome.
5. **Add Step Details (Optional)**: Add comments or attach files directly to the step if needed.
6. **Repeat**: Continue for all steps.
7. **Set Overall Result**: If not automatically set by step failures, use the overall result buttons at the top.
8. **Add Overall Details (Optional)**: Add overall comments or attachments.
9. **Navigate/Close**: Use the Previous/Next buttons or Close button to move to another case or return to the run overview.
