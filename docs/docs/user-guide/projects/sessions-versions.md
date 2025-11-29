---
title: Session Versions
sidebar_position: 4 # After Session Details
---

# Session Versions Page

This page allows you to view historical versions of a specific test session, showing exactly how it looked at different points in time. Every time a session is saved after editing, a new version is created.

You access this page using the **Version Selector** dropdown located in the header of the [Session Details](./sessions-details.md) page when a session has more than one version.

## Layout and Navigation

The layout is identical to the Session Details page (resizable two-panel view), but it is **read-only**.

- **Header**:
  - **Session Name**: Displays the session name as it was for the selected version. If the name changed from the previous version, both the old (red, strikethrough/minus icon) and new (green, plus icon) names are shown.
  - **Version Selector**: Dropdown to jump directly to any available version. Each version lists its creation date/time.
  - **Navigation Controls**: Includes Previous/Next arrows to navigate sequentially through versions and a "Back to Latest" link (often on the version number/badge) to return to the main Session Details page.
- **Content Panels**: Display all fields (Description, Mission in the left panel; Metadata in the right panel) exactly as they were saved for the selected version.

## Viewing Differences (Diff View)

When viewing any version _except the very first one (Version 1)_, the page highlights the differences between the currently viewed version and the one immediately preceding it:

- **Simple Text/Number Fields** (e.g., State, Configuration, Milestone, Assigned To, Estimate):
  - If changed, the previous value is shown (often faded or red with a minus icon) above the current value (often green with a plus icon).
  - Icons (like state icons, milestone icons) are displayed next to their respective values.
- **Rich Text Fields** (Description, Mission):
  - The content from both versions is displayed side-by-side or top-and-bottom, with additions highlighted (e.g., green background) and deletions highlighted (e.g., red background with strikethrough).
- **Tags**:
  - Differences are explicitly shown using badges:
    - **Added**: Green background with a plus icon.
    - **Removed**: Red background with a minus icon.
    - **Common**: Standard tag display (no change).
- **Attachments**:
  - Similar to tags, attachments added in the current version are highlighted (e.g., green border/icon), and attachments removed since the previous version might be shown differently (e.g., faded or red border/icon).
- **Completed Status**: If the session was marked as completed in this version, a green "Completed On [Date]" badge is shown.

## Metadata

The right panel also displays metadata specific to the version being viewed:

- **Version Created**: The exact date and time this version was saved, and the user who saved it.
- **Latest Version Updated**: For context, the date, time, and user for the most recent save of the session are also shown, with a link back to the latest version.
