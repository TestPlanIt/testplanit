---
title: Session Details
sidebar_position: 3 # After Session Item
---

# Session Details Page

This page provides a detailed view of a specific test session, allowing users to view its configuration, mission, description, record results, and manage its status.

It's accessed by clicking on a session's name from the main [Sessions page](./sessions.md).

## Page Layout

The page uses a resizable two-panel layout:

1. **Left Panel**: Contains the session's description and mission, followed by the area for adding and viewing session results (notes, issues, questions).
2. **Right Panel**: Displays metadata (Template, State, Configuration, Milestone, Assigned To, Estimate, Tags, Attachments, Creator) and controls.

## Header

The header area displays key information and actions:

- **Back Button**: Navigates back to the main [Sessions page](./sessions.md) (only visible in View mode).
- **Session Name**: The name of the session. In Edit mode, this becomes an editable text area.
- **Action Buttons**:
  - **View Mode (Active Session)**:
    - **Version Selector**: If the session has multiple versions (i.e., has been edited), a dropdown appears allowing you to view [previous versions](./sessions-versions.md).
    - **Edit** (`SquarePen` icon): Switches the page to Edit mode (if user has permission).
    - **Complete** (`CircleCheckBig` icon): Opens a confirmation dialog to mark the session as finished. You select the final "Done" state and set the completion date. This action creates a new version and is irreversible (if user has permission).
  - **View Mode (Completed Session)**:
    - Displays a "Completed On [Date]" badge.
    - **Delete** (`Trash2` icon): Opens a confirmation dialog to permanently delete the session and all its results/versions. This action is irreversible (Admin only).
  - **Edit Mode**:
    - **Save** (`Save` icon): Saves changes made in Edit mode. This creates a new version of the session.
    - **Cancel** (`CircleSlash2` icon): Discards changes and returns to View mode.
    - **Delete** (`Trash2` icon): Opens a confirmation dialog to permanently delete the session and all its results/versions. This action is irreversible (Admin only).

## Left Panel Content

- **Description**: Displays the session's description using a rich-text viewer. In Edit mode, this becomes an editable TipTap editor.
- **Mission**: Displays the session's mission/charter using a rich-text viewer. In Edit mode, this becomes an editable TipTap editor.
- **Session Results** (View Mode Only):
  - **Summary**: Shows counts of different result types (Notes, Issues, Questions) recorded.
  - **Add Result Form**: A form to quickly add new results (Note, Issue, Question), including a text area and optional attachment upload.
  - **Results List**: A chronological list of all results recorded for this session, showing the type, content preview, creator, and creation time for each.

## Right Panel Content (Metadata & Controls)

Displays the following session properties. In Edit mode, most fields become editable controls (dropdowns, inputs, etc.).

- **Template**: The selected [Session Template](../templates-fields.md).
- **State**: The current [Workflow State](../workflows.md).
- **Configuration**: The linked project [Configuration](../configurations.md).
- **Milestone**: The linked project [Milestone](./milestones.md).
- **Assigned To**: The user assigned to the session.
- **Estimate**: The estimated duration for the session.
- **Tags**: Assigned [Tags](../tags.md).
- **Attachments**: Files attached to the session definition.
- **Created By**: The user who created the session (View mode only).
