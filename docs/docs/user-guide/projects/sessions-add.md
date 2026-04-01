---
title: Add Session
sidebar_position: 1 # First item under Sessions
---

# Add Session

This explains the process for adding a new test session using the **Add Session** dialog.

New sessions are typically added by clicking the 'Add Session' (`+`) button on the main [Sessions page](./sessions.md), either in the header or within a specific milestone group. The same dialog is also used when [duplicating a session](#session-duplication).

## Dialog Layout

The dialog uses a two-column layout:

- **Left Column**: Contains the primary descriptive fields for the session (Name, Description, Mission, Configurations, Attachments).
- **Right Column**: Contains workflow and metadata fields (Template, State, Milestone, Assigned To, Estimate, Tags, Issues).

## Fields

**Left Column:**

- **Name** (Required): A unique name for the session.
- **Description**: A rich-text editor for adding details or context about the session's purpose or observations.
- **Mission**: A rich-text editor to define the goals, charter, or specific areas to explore during the session.
- **Configurations**: A multi-select combobox to select one or more project [Configurations](../configurations.md). See [Multi-Configuration Support](#multi-configuration-support) below.
- **Attachments**: Area to upload files relevant to the session definition (e.g., setup guides, relevant specifications).

**Right Column:**

- **Template** (Required): Dropdown to select the [Session Template](../templates-fields.md) that defines the structure for recording results during the session.
- **State** (Required): Dropdown to set the initial [Workflow State](../workflows.md) for the session (e.g., "To Do", "In Progress"). Defaults to the workflow's default starting state.
- **Milestone**: Dropdown to link the session to a project [Milestone](./milestones.md) (or "None"). If opened from a milestone group, this defaults to that milestone. Only active (non-completed) milestones are shown in the dropdown.
- **Assigned To**: Dropdown to assign the session to a specific user in the project (or "None").
- **Estimate**: Optional field to estimate the time required for the session (e.g., "1h 30m", "2d").
- **Tags**: Allows selecting and assigning existing [Tags](../tags.md).
- **Issues**: Link external issues from configured integrations (Jira, GitHub, Azure DevOps).

## Actions

- **Cancel**: Closes the dialog without creating the session.
- **Submit**: Validates the fields, creates the new session(s), and creates initial version records (Version 1).

## Multi-Configuration Support

When creating a session, you can select **multiple configurations** (e.g., Chrome, Firefox, Safari) from the Configurations combobox. When multiple configurations are selected:

- **One session is created per configuration**, all sharing the same name, template, state, milestone, tags, issues, and other metadata.
- Sessions created together are linked via a shared `configurationGroupId`, making it easy to identify related sessions across configurations.
- The count of selected configurations is shown next to the field label (e.g., "Configurations (3)").
- A **Clear All** link appears to quickly deselect all configurations.

If no configurations are selected, a single session is created without a configuration.

## Session Duplication

Sessions can be duplicated from the session context menu (three-dot menu on the [Session Item](./sessions-item.md)). When duplicating:

- The Add Session dialog opens pre-populated with the original session's metadata: name (with " - Duplicate" suffix), template, configuration, milestone, state, assigned user, description, mission, tags, issues, and custom field values.
- The user can modify any field before submitting.
- **Session results are NOT copied** — the duplicated session starts fresh with no results.
- Multiple configurations can be selected during duplication, creating one session per configuration.
