---
sidebar_position: 11
title: Copy/Move Test Cases
---

# Copy/Move Test Cases

The Copy/Move feature lets you duplicate or transfer test cases from one project to another. Use it when you want to reuse existing tests in a new project, reorganize your test library across projects, or migrate cases as a project evolves.

## Overview

Two operations are available:

- **Copy** creates a duplicate of the selected cases in the target project. The copied cases start at version 1 with a fresh history. The originals remain unchanged in the source project.
- **Move** transfers the selected cases to the target project. Moved cases retain their full version history. The originals are removed (soft-deleted) from the source project. This operation cannot be automatically undone.

## Getting Started

### Entry Points

There are several ways to open the Copy/Move dialog:

#### Repository Toolbar

1. Select one or more test cases using the checkboxes in the repository list.
2. Click **Copy/Move** in the toolbar.

#### Context Menu

1. Click the three-dot menu on any test case row in the repository.
2. Select **Copy/Move** from the context menu.

#### Bulk Edit Modal

1. Select multiple test cases using checkboxes.
2. Open the bulk edit modal.
3. Click **Copy/Move** in the modal footer.

#### Folder Context Menu

1. Click the three-dot menu on any folder in the folder tree.
2. Select **Copy/Move**.
3. The dialog opens with all test cases from that folder and its subfolders pre-selected.

This copies or moves the **entire folder tree** — including all subfolders (even empty ones) and every test case within them. The folder hierarchy is recreated in the target project, and each test case is placed in its corresponding folder.

### Step-by-Step Workflow

The dialog walks you through three steps.

#### Step 1: Select Target

- Choose the destination project from the project picker. Only projects you have write access to are shown.
- Once a project is selected, choose a destination folder within that project.
- Click **Next** to continue.

#### Step 2: Configure

- Select the operation: **Copy** or **Move**.
- Review any compatibility warnings (see sections below).
- Configure conflict resolution and shared step group handling if prompted.
- Click **Go** to start the operation.

#### Step 3: Progress and Results

- A progress bar shows how many cases have been processed out of the total.
- You can click **Cancel** at any time. Cases already processed before cancellation remain in the target project.
- When the operation completes, a summary shows the count of successfully copied or moved cases, any skipped cases, and any errors.
- A link to the target project is provided for quick navigation.

## Compatibility Checks

Before you confirm, the dialog automatically checks for potential issues between the source and target projects.

### Template Compatibility

If the source project uses templates that are not assigned to the target project, a warning is shown listing the missing templates.

- **Admin and Project Admin users** can check the **Auto-assign missing templates** option. This assigns the required templates to the target project automatically when the operation runs.
- **Other users** see an informational warning. The templates will not be auto-assigned; a project admin must assign them separately before custom field values display correctly in the target project.

### Workflow State Mapping

Workflow states are matched between projects by name. States that exist in the source project but have no name match in the target project are shown in a warning list. Those unmatched states fall back to the target project's default workflow state when cases are transferred.

### Naming Collisions

If cases with the same name already exist in the destination folder, you must choose how to handle them:

- **Skip** — Cases whose names collide with existing cases are not copied or moved.
- **Rename** — Colliding cases are given a unique suffix in the target folder (for example, `Login Test (1)`).

### Shared Step Groups

If the selected cases reference shared step groups, you can choose how those groups are handled in the target project:

- **Reuse existing** — If a shared step group with the same name already exists in the target project, cases are linked to it.
- **Create new copies** — New shared step groups are created in the target project regardless of whether matching groups exist.

## What Data is Carried Over

| Data | Copied | Moved | Notes |
|---|---|---|---|
| Test steps | Yes | Yes | All steps recreated in target |
| Custom field values | Yes | Yes | Field option IDs re-resolved by option name when templates differ; values are dropped if no matching option is found |
| Tags | Yes | Yes | Connected to target case |
| Issue links | Yes | Yes | Linked to target case |
| Attachments | Yes | Yes | Reference the same files; no re-upload required |
| Shared step groups | Yes | Yes | Recreated or reused in target project per your choice |
| Version history | No | Yes | Copies start at version 1; moves preserve full history |
| Comments | No | Yes | Copies start with no comments; moves preserve all comments |
| Folder structure | Yes | Yes | When copying/moving a folder, the full tree is recreated |

### Data Not Included

The following data is **not transferred** during copy or move operations:

| Data | Reason |
|---|---|
| **Test run results** | Test execution history (pass/fail results, run assignments) is tied to test runs in the source project and is not carried over. Copied or moved cases start with no test run history in the target project. |
| **Result field values** | Custom field values recorded during test execution belong to the source project's test runs. |
| **Automated test results** | Imported JUnit, TestNG, xUnit, NUnit, and other automated test results are linked to source project test runs. |
| **Cross-project case links** | Links between test cases in different projects are dropped. The result summary reports the count of dropped links. |
| **Forecast data** | Manual and automated forecast estimates are reset to defaults in the target. |

## Copy vs Move Differences

| Aspect | Copy | Move |
|---|---|---|
| Source case | Unchanged | Removed from source project (soft-deleted) |
| Version history | Starts at version 1 with no prior history | Full version history preserved |
| Comments | Not included | Preserved |
| Reversibility | Delete the copy to undo | Cannot be undone automatically |

## Folder Tree Copy/Move

When you copy or move a folder from the folder context menu, the entire folder tree is transferred:

- **All subfolders** are recreated in the target project under your chosen destination folder, preserving the parent-child hierarchy.
- **Empty subfolders** are included — the full structure is preserved even if some folders contain no test cases.
- **Test cases stay in their folders** — each case is placed in the corresponding recreated folder, not flattened into a single folder.
- **Folder name collisions** are handled by merging: if a folder with the same name already exists at the same level in the target, cases are added to the existing folder rather than creating a duplicate.
- **Move operations** soft-delete both the source test cases and the source folders after all cases are successfully transferred.

## Troubleshooting

### Template Warning Appears

If you see a template mismatch warning and you do not have the auto-assign option, ask a project admin to assign the required template to the target project before proceeding. After the template is assigned, the custom field values will display correctly.

### Cases Show as Skipped

If the results summary shows skipped cases, there are likely cases with the same name already in the destination folder. Re-open the dialog and change the conflict resolution to **Rename** to copy or move those cases with a unique suffix instead.

### Dropped Cross-Project Links

If the summary reports dropped links, the affected cases had links to cases in other projects. Those links are not preserved across projects and must be re-created manually in the target project if needed.

### Background Job Queue Unavailable

If the operation fails with a message indicating that the background job queue is not available, the server's background processing service may be down or unreachable. Contact your administrator to verify that the queue service (Valkey/Redis) is running.
