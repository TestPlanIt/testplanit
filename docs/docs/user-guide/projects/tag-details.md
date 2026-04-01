---
title: Project Tag Details
# No sidebar_position needed as it's not directly in the sidebar
---

# Project Tag Details

This page shows all the Test Cases, Sessions, and Test Runs within the current project that are associated with a specific tag.

You access this page by clicking on a tag name from the [Project Tags List](./tags.md).

## Layout

- **Header**: Displays the specific **Tag** name (using the standard tag badge component) and indicates that the list shows associated items within the current project.
- **Content**: Contains a search filter, a filter bar with status and type controls, and tabbed data tables for associated Test Cases, Sessions, and Test Runs.

## Search

- A **Filter** input allows you to quickly search across the names of all associated items (Cases, Sessions, Runs) displayed on the page.

## Filters

A filter bar below the search input provides controls to narrow the displayed items:

- **Case type**: A dropdown to show **All**, **Manual** only, or **Automated** only test cases.
- **Hide completed Sessions**: A toggle switch to exclude Sessions that have been marked as completed.
- **Hide completed Test Runs**: A toggle switch to exclude Test Runs that have been marked as completed.

Filters can be combined (e.g., show only automated test cases while hiding completed Sessions and Test Runs).

An active filter count badge is displayed next to the "Filters" label when any filters are applied. Click the badge to clear all filters at once.

Filter state is persisted per tag across page visits within the same browser.

When all items in a tab are excluded by the current filters, an empty state message is shown: "No items match the current filters."

## Associated Items Tables

Items are organized into three tabs: **Test Cases**, **Sessions**, and **Test Runs**. Each tab header shows the count of matching items (reflecting any active filters).

- **Test Cases Tab**:
  - **Name**: The test case name, linking to the [Test Case Details](./repository-case-details.mdx) page.
  - **Type**: A badge showing whether the case is **Manual** or **Automated**.
- **Sessions Tab**:
  - **Name**: The session name, linking to the [Session Details](./sessions-details.md) page.
  - **Status**: A badge showing **Completed** or **In Progress**.
- **Test Runs Tab**:
  - **Name**: The test run name, linking to the [Test Run Details](./run-details.md) page.
  - **Status**: A badge showing **Completed** or **In Progress**.

_Each tab only appears if there are relevant items associated with the tag in this project. If no items of any type use the tag in this project, an empty state message is shown._
