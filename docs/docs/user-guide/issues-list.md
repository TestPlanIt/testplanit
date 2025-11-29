---
sidebar_label: 'Issues List'
sidebar_position: 4
---

# Issues List

The Issues List page provides a centralized view of all issues across the projects you have access to. It is accessible from the main navigation bar at the top of the application.

## Overview

This page displays a table listing issues, allowing you to quickly see which issues exist and what entities they are linked to across different projects.

## Features

### Filtering and Searching

- **Search Bar:** Located above the table, you can type into the search bar to filter issues by their **Name**. The search is case-insensitive and updates the table dynamically as you type (with a small debounce delay).

### Pagination

- **Page Size:** You can control how many issues are displayed per page using the dropdown menu (options typically include 10, 25, 50, 100, 250, or "All").
- **Navigation:** Use the pagination controls below the table to navigate between pages of issues.
- **Info Display:** Information about the currently displayed range of issues and the total count is shown above the pagination controls.

### Sorting

- The table is initially sorted by **Name** in ascending order.
- Clicking on sortable column headers will toggle the sorting direction (ascending/descending) for that column. _(Note: Based on current implementation, only 'Name' might be actively sortable)._

### Data Table Columns

The table displays the following information for each issue:

- **Name:**
    - Displays the issue's unique name and its external ID (if available).
    - Clicking the issue name navigates to the detailed view of that specific issue (linking TBD).
    - Associated project icons are displayed alongside the name.
- **Test Cases:**
    - Shows a count of how many repository test cases are linked to this issue across all accessible projects.
    - Clicking the count opens a modal displaying the list of linked test cases.
- **Test Runs:**
    - Shows a count of how many test runs (directly or via results) are linked to this issue across all accessible projects.
    - Clicking the count opens a modal displaying the list of linked test runs.
- **Sessions:**
    - Shows a count of how many test sessions (directly or via results) are linked to this issue across all accessible projects.
    - Clicking the count opens a modal displaying the list of linked sessions.
- **Projects:**
    - Shows icons representing the projects associated with the issue through linked test cases, test runs, or sessions.
    - Clicking the project icons opens a modal displaying the list of associated projects.

## Access Control

- **Standard Users:** Will only see issues that are linked to entities (Test Cases, Sessions, Test Runs, Results) within the projects they have been assigned to.
- **Administrators:** Have visibility over all issues across all projects in the system.