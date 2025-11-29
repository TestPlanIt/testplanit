---
title: Tags List
sidebar_position: 3 # After Projects List
---

# Tags List Page

This page provides a central view of all tags currently associated with active (non-deleted) Test Cases or Sessions across your projects. You can navigate here by clicking **Tags** in the main header navigation bar.

:::info Included Tags
Only tags linked to at least one active Test Case or Session are displayed here. Tags created in Administration but not yet used, or tags only linked to deleted items, will not appear in this list.
:::

## Features

- **Filtering**: Use the filter input above the table to search for tags by name.
- **Pagination**: If there are many tags, use the pagination controls at the top-right to navigate through pages and adjust the number of tags shown per page.
- **Sorting**: Tags are sorted alphabetically by name by default.

## Tags Table

The main part of the page is a table listing the active tags with the following columns:

- **Name**: The unique name of the Tag. This is displayed as a clickable link. Clicking the tag name will take you to the **Tag Detail Page** (see below) showing all Test Cases and Sessions associated with this specific tag.
- **Test Cases**: Displays the count of active Test Cases currently associated with this Tag.
- **Sessions**: Displays the count of active Test Sessions currently associated with this Tag.
- **Projects**: Displays the count of unique projects where this Tag is used (across both active Test Cases and Sessions).

## Tag Detail Page

Clicking on a tag's name in the **Name** column navigates you to a dedicated page for that tag (`/tags/[tagId]`). This detail page shows:

- The tag name prominently displayed.
- A filter bar to search within the associated items.
- Separate tables listing:
  - All **active Test Cases** linked to this tag, including the Test Case name (linked to its repository page) and the Project it belongs to (linked to the project overview).
  - All **active Sessions** linked to this tag, including the Session name (linked to its session page) and the Project it belongs to (linked to the project overview).
