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
  - **Right Panel**: Status Toggles (Started/Completed), Dates (`DatePickerField`), Description (`TipTapEditor`), Type (Select), Parent (Select), Auto-Complete, and Notification settings.
- **Saving**: Click **Save** (icon: Save) to persist changes. A success/error toast message appears.
- **Canceling**: Click **Cancel** (icon: CircleSlash2) to discard changes and revert to the last saved state.
- **Deleting**: Click **Delete** to open the confirmation modal (cascades to children). On successful deletion, you are redirected back to the main Milestones list.

:::info Permissions Required

- **Editing:** Requires the `Add/Edit` permission for the `Milestones` application area. Users without this permission cannot enter edit mode or save changes.
- **Deleting:** Requires the `Delete` permission for the `Milestones` application area. Users without this permission will not see the Delete button.
:::

## Automatic Completion

Milestones can be configured to automatically mark themselves as completed when their due date is reached.

### Enabling Auto-Complete

1. Enter **Edit Mode** by clicking the Edit button
2. Set a **Due Date** for the milestone (required for auto-completion)
3. Toggle the **Auto-complete on due date** switch to ON
4. Save your changes

### How It Works

- A background job runs daily at 6:00 AM (server time)
- The job checks for milestones where:
  - Auto-completion is enabled
  - The milestone is not already completed
  - The due date has passed
- Matching milestones are automatically marked as completed
- This is useful for time-boxed milestones like sprints that should close regardless of completion status

### Use Cases

- **Sprints**: Automatically close sprints when the sprint period ends
- **Release Windows**: Mark release milestones as complete when the release date passes
- **Time-boxed Testing**: Close testing phases that must end by a specific date

:::tip
Auto-completion only affects the milestone itself. Child milestones are not automatically completed—each must have its own auto-completion setting if desired.
:::

## Due Date Notifications

When a milestone has a due date approaching (or is overdue), TestPlanIt can automatically notify all users who have participated in the milestone's work.

### Enabling Notifications

1. Enter **Edit Mode** by clicking the Edit button
2. Set a **Due Date** for the milestone
3. Toggle the **Notify days before due date** switch to ON
4. Enter the number of days before the due date to start sending notifications (default: 5 days)
5. Save your changes

### Who Receives Notifications

Notifications are sent to all users who have participated in the milestone, including:

- **Milestone creator** - The user who created the milestone
- **Test run creators** - Users who created test runs associated with the milestone
- **Assigned testers** - Users assigned to test cases within the milestone's test runs
- **Result submitters** - Users who have executed and submitted test results
- **Session creators** - Users who created exploratory testing sessions
- **Session assignees** - Users assigned to exploratory testing sessions

Each user receives only one notification per milestone per day, even if they appear in multiple roles.

### Notification Timing

- Notifications are processed daily at 6:00 AM (server time)
- Users receive notifications when:
  - The milestone is within the configured "notify days before" window
  - The milestone is overdue (past its due date)
- Notifications continue daily for overdue milestones until the milestone is marked as completed

### Notification Content

**Due Soon Notification**:

- Title: "Milestone Due Soon"
- Message: Milestone "{name}" in project "{project}" is due on {date}
- Links directly to the milestone details page

**Overdue Notification**:

- Title: "Milestone Overdue"
- Message: Milestone "{name}" in project "{project}" was due on {date}
- Links directly to the milestone details page

### Notification Delivery

Notifications follow each user's configured notification preferences:

- **In-App Only**: Notification appears in the notification center
- **In-App + Immediate Email**: Notification plus immediate email
- **In-App + Daily Digest**: Notification plus inclusion in daily digest email
- **Use Global Settings**: Follows system-wide defaults

For more details on notification preferences, see [Notifications](../notifications.md).

:::note
Notification settings are disabled when no due date is set. Setting a due date automatically enables notifications with a default of 5 days before the due date.
:::

## Comments

The milestone details page includes a **Comments** section at the bottom, allowing team members to discuss milestone progress, communicate blockers, and coordinate testing activities.

### Adding Comments

1. Scroll to the **Comments** section at the bottom of the page
2. Click in the comment editor field
3. Type your comment using the rich text editor
4. Use `@` to mention team members who should be notified
5. Click **Post Comment** to publish

### Comment Notifications

When you mention a user in a milestone comment:

- They receive an in-app notification with a link to the milestone
- Based on their notification preferences, they may also receive an email
- The notification includes the milestone name and custom icon for easy identification

### Example Comments

- **Progress Updates**: "@project-manager - All test runs are now complete. Ready for sign-off."
- **Risk Communication**: "Milestone at risk due to blocked test environment. @devops please advise."
- **Scope Changes**: "Adding additional test runs per new requirements from stakeholder meeting."
- **Coordination**: "@qa-team - Please prioritize the payment tests before end of sprint."

For more details on the commenting system, see [Comments & Mentions](../comments.md).
