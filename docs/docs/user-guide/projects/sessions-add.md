---
title: Add Session
sidebar_position: 1 # First item under Sessions
---

# Add Session

This explains the process for adding a new test session using the **Add Session** dialog.

New sessions are typically added by clicking the 'Add Session' (`+`) button on the main [Sessions page](./sessions.md), either in the header or within a specific milestone group.

## Dialog Layout

The dialog uses a two-column layout:

- **Left Column**: Contains the primary descriptive fields for the session (Name, Description, Configuration, Milestone, Mission).
- **Right Column**: Contains workflow and metadata fields (Template, State, Assigned To, Estimate, Tags, Attachments).

## Fields

**Left Column:**

- **Name** (Required): A unique name for the session.
- **Description**: A rich-text editor for adding details or context about the session's purpose or observations.
- **Configuration**: Dropdown to select a relevant project [Configuration](../configurations.md) (or "None").
- **Milestone**: Dropdown to link the session to a project [Milestone](./milestones.md) (or "None"). If opened from a milestone group, this defaults to that milestone. Only active (non-completed) milestones are shown in the dropdown.
- **Mission**: A rich-text editor to define the goals, charter, or specific areas to explore during the session.

**Right Column:**

- **Template** (Required): Dropdown to select the [Session Template](../templates-fields.md) that defines the structure for recording results during the session.
- **State** (Required): Dropdown to set the initial [Workflow State](../workflows.md) for the session (e.g., "To Do", "In Progress"). Defaults to the workflow's default starting state.
- **Assigned To**: Dropdown to assign the session to a specific user in the project (or "None").
- **Estimate**: Optional field to estimate the time required for the session (e.g., "1h 30m", "2d").
- **Tags**: Allows selecting and assigning existing [Tags](../tags.md).
- **Attachments**: Area to upload files relevant to the session definition (e.g., setup guides, relevant specifications).

## Actions

- **Cancel**: Closes the dialog without creating the session.
- **Submit**: Validates the fields, creates the new session, and creates its initial version (Version 1).
