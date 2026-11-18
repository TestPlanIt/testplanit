---
sidebar_position: 15
title: Shared Steps
---

# Shared Steps

Shared Steps are reusable groups of test steps. A test case references a group instead of copying its steps, so updating the group updates every test case that uses it.

## Overview

A shared step group has a **name** and an ordered list of steps, each with a **step** and an **expected result**. Groups belong to one project.

Shared Steps are useful for procedures that many test cases repeat:

- Login procedures
- Setup and teardown operations
- Common navigation flows
- Standard verification steps

**Example: a "Standard User Login" group**

```text
1. Navigate to the login page          → Login form is displayed
2. Enter a valid username and password → Fields accept the input
3. Click "Sign In"                     → The dashboard is displayed
```

## The Shared Steps Page

Click **Shared Steps** in the project sidebar. The page lists every shared step group in the project with its step count.

- Use the filter box to find a group by name.
- Select a group to see its steps and the test cases that use it.
- **Edit** and **Delete** act on the selected group.

Creating, editing, and deleting groups requires permission for the **Shared Steps** application area — see the [Permissions Guide](./permissions-guide.md).

## Creating Shared Steps

There are four ways to create a shared step group.

### Add Manually

1. On the Shared Steps page, click **Add Manually**.
2. Enter a name for the group.
3. Add each step and its expected result.
4. Save.

### Import from CSV

Click **Import Shared Steps** to import groups from a CSV file. See [Import Shared Steps](./import-shared-steps.md).

### From Steps in a Test Case

While editing a test case, select one or more of its steps and click **Create Shared Steps**. Enter a name; the selected steps become a new shared step group, and the test case references the group in their place.

### From Repeated Steps

**Find Step Duplicates** on the Shared Steps page scans the project's test cases for step sequences that appear in more than one case and offers to convert each match into a shared step group. See [Step Duplicate Detection](./projects/step-duplicate-detection.md).

## Using Shared Steps in Test Cases

When creating or editing a test case:

1. Click **Add Shared Steps** in the steps editor.
2. In the **Select Shared Steps** dialog, choose a group.
3. The group is added to the test case as a single block labelled **Shared Steps: _name_**.

The block shows the group's steps but they are edited on the Shared Steps page, not in the test case. Removing the block from a test case does not delete the shared step group.

During test execution, the steps of a shared step group appear in place, and each one records its own result like any other step.

## Editing Shared Steps

1. Select the group on the Shared Steps page and click **Edit**.
2. Change the name, or add, edit, reorder, and remove steps.
3. Click **Save**.

:::warning Impact of Changes
Editing a shared step group changes every test case that uses it. Check the list of test cases shown for the group before making changes.
:::

## Deleting Shared Steps

Select the group and click **Delete**. The group's steps are removed from every test case that uses it. A deleted group can be restored from [Trash](./trash.md).

## Copying and Moving Test Cases

When test cases that use shared steps are [copied or moved](../copy-move-test-cases.md) to another project, you choose what happens when a shared step group with the same name already exists in the target project: reuse the existing group, or create a new one.

## Best Practices

1. **Single responsibility**: Give each group one clear purpose.
2. **Descriptive names**: Groups are found by name, so use clear, searchable names.
3. **Keep groups small**: A short, focused group is reused more often than a long one.
4. **Review usage before editing**: A change reaches every test case that references the group.
5. **Clean up**: Delete groups that no test case uses.
