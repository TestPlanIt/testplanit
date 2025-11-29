---
title: Milestone Details
sidebar_position: 2 # Position within Milestones category
---

# Milestone Details Page

This page provides a detailed view and editing capabilities for a specific project milestone. You typically access this page by clicking on a milestone's name from the main [Project Milestones](./milestones.md) list.

## Layout

The page uses a resizable two-panel layout:

- **Left Panel (Main Content)**:
  - **Milestone Name**: Displays the name (editable in Edit Mode).
  - **Documentation**: Shows the rich text documentation associated with this milestone (`docs` field). Editable in Edit Mode via a `TipTapEditor`.
  - **(View Mode Only)** Lists of:
    - **Child Milestones**: Displays any direct children of this milestone, showing their name, status badge, and dates. Clicking a child navigates to its own detail page.
    - **Associated Test Runs**: Lists Test Runs linked to this milestone.
    - **Associated Sessions**: Lists Test Sessions linked to this milestone.
- **Right Panel (Controls & Details)**:
  - Displays/allows editing of core milestone properties using form controls.

## Viewing Details (View Mode)

In the default view mode:

- All fields are read-only.
- A **Back Arrow** button in the header navigates back to the main Milestones list.
- An **Edit** button (icon: SquarePen) is available for users with **ADMIN** or **PROJECTADMIN** access.
- The right panel displays:
  - **Status Badge**: Shows the calculated status (Not Started, In Progress, Completed, Overdue).
  - **Completion Rate**: Displays the percentage of completed test results out of total test cases in test runs associated with this milestone.
  - **Dates**: Displays Start and Due dates.
  - **Description**: Shows the rich text description (`note` field). It's initially collapsed but expandable.
  - **Type**: Shows the selected Milestone Type.
  - **Parent**: Shows the parent milestone, if any.

## Editing Details (Edit Mode)

Clicking the **Edit** button (or accessing via an edit link) activates Edit Mode:

- The **Back Arrow** is replaced with **Save** and **Cancel** buttons.
- A **Delete** button (icon: Trash2) appears.
- Fields in both panels become editable:
  - **Left Panel**: Milestone Name (Textarea), Documentation (`TipTapEditor`).
  - **Right Panel**: Status Toggles (Started/Completed), Dates (`DatePickerField`), Description (`TipTapEditor`), Type (Select), Parent (Select).
- **Saving**: Click **Save** (icon: Save) to persist changes. A success/error toast message appears.
- **Canceling**: Click **Cancel** (icon: CircleSlash2) to discard changes and revert to the last saved state.
- **Deleting**: Click **Delete** to open the confirmation modal (cascades to children). On successful deletion, you are redirected back to the main Milestones list.

:::info Permissions Required

- **Editing:** Requires the `Add/Edit` permission for the `Milestones` application area. Users without this permission cannot enter edit mode or save changes.
- **Deleting:** Requires the `Delete` permission for the `Milestones` application area. Users without this permission will not see the Delete button.
:::
