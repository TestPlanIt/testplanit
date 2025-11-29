---
title: Project Tag Details
# No sidebar_position needed as it's not directly in the sidebar
---

# Project Tag Details

This page shows all the Test Cases, Sessions, and Test Runs within the current project that are associated with a specific tag.

You access this page by clicking on a tag name from the [Project Tags List](./tags.md).

## Layout

- **Header**: Displays the specific **Tag** name (using the standard tag badge component) and indicates that the list shows associated items within the current project.
- **Content**: Contains a filter input and separate data tables for associated Test Cases, Sessions, and Test Runs.

## Filtering

- A **Filter** input allows you to quickly search across the names of all associated items (Cases, Sessions, Runs) displayed on the page.

## Associated Items Tables

If any items of a specific type (Test Cases, Sessions, Test Runs) within the current project use this tag, a table for that item type will be displayed.

- **Test Cases Table**:
  - **Header**: "Test Cases"
  - **Columns**: Displays the **Name** of each associated Test Case. The name links to the [Test Case Details](./repository-case-details.mdx) page.
- **Sessions Table**:
  - **Header**: "Sessions"
  - **Columns**: Displays the **Name** of each associated Session. The name links to the [Session Details](./sessions-details.md) page.
- **Test Runs Table**:
  - **Header**: "Test Runs"
  - **Columns**: Displays the **Name** of each associated Test Run. The name links to the [Test Run Details](./run-details.md) page.

_Each table only appears if there are relevant items associated with the tag in this project. If no items of any type use the tag in this project, an empty state message is shown._
