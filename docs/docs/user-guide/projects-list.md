---
title: Projects List
sidebar_position: 2 # After Dashboard
---

# Projects List Page

This page provides a central view of all active and completed projects you have access to. You can navigate here by clicking **Projects** in the main header navigation bar.

:::info Access
Users with the `NONE` access level will be redirected away from this page.
:::

The page is divided into two main areas:

1. **Collapsible Sidebar (Left)**: This menu contains project-specific navigation links (like Overview, Test Cases, etc.) that become active once you select a project. You can collapse or expand this sidebar using the chevron (`<` or `>`) button located on its right edge. Your preference (collapsed or expanded) is automatically saved in your browser.
2. **Project Cards (Right)**: The main area displays a grid of **Project Cards**, one for each project that is not marked as deleted.

## Project Cards

- **Ordering**: Projects are listed with active projects appearing before completed projects. Within these groups, they are sorted alphabetically by name.
- **Content**: Each card shows the project's icon, name, note, assigned users, creation date, and status (Active or Completed date).
- **Navigation**: Clicking on any Project Card will navigate you to that project's overview page (e.g., `/projects/overview/[projectId]`).

For more details on the information shown within each card, see the [Dashboard](./dashboard.md#your-projects-right-panel) documentation.
