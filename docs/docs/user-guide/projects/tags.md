---
title: Tags
sidebar_position: 7 # Position after Sessions
---

# Project Tags List

This page lists all the [Global Tags](../tags-list.md) that are currently associated with any Test Cases, Sessions, or Test Runs within the _currently selected project_.

This view provides a project-specific lens on tag usage.

## Accessing the Page

You can typically access this page from the **Project Menu** (the collapsible sidebar specific to the project) by clicking on the "Tags" link.

## Layout

- **Header**: Displays the title "Tags" and the current Project Name and Icon.
- **Content**: Contains a filter input and a data table listing the relevant tags.

## Filtering

- A **Filter** input allows you to quickly search and narrow down the list by tag name.

## Tags Table

The table displays tags that are used by at least one item (Case, Session, or Run) within _this project_.

- **Columns**:
  - **Name**: Displays the tag name. Clicking the tag name navigates to the [Project Tag Details](./tag-details.md) page for that tag within this project.
  - **Test Cases**: Shows the count of Test Cases _in this project_ that use this tag. Clicking the count might show a popover or list of associated cases.
  - **Sessions**: Shows the count of Sessions _in this project_ that use this tag. Clicking the count might show a popover or list of associated sessions.
  - **Test Runs**: Shows the count of Test Runs _in this project_ that use this tag. Clicking the count might show a popover or list of associated runs.
- **Pagination**: Standard pagination controls are available if the list of tags exceeds the page size.

## Auto Tag

The **AI Tag** button in the toolbar opens the Auto Tag wizard, which uses AI to automatically suggest relevant tags for your test cases, test runs, and sessions based on their content.

### Quick Start

1. Click the **AI Tag** button in the toolbar
2. Select which entity types to analyze (test cases, test runs, sessions)
3. Optionally toggle **Untagged Only** to focus on items that have no tags yet
4. Optionally disable **Allow creating new tags** to restrict suggestions to existing tags only
5. Click **Start Analysis** — the AI will analyze your items in batches
6. Review the suggestions: click tags to toggle them on/off, double-click to edit names
7. Click **Apply** to save the selected tags

The AI will match suggestions against your existing project tags when possible.

- If **Allow creating new tags** is enabled (default), Auto Tag can also propose and create new tags.
- If **Allow creating new tags** is disabled, Auto Tag only suggests tags that already exist in your project.

:::tip
Running Auto Tag with **Untagged Only** enabled is a great way to quickly organize items that were added without tags.
:::

For full details on configuration, best practices, and troubleshooting, see the [Auto Tag documentation](../llm-auto-tag.md).

## Tag Details

Clicking on a specific tag name in the list will take you to the [Project Tag Details](./tag-details.md) page, which shows exactly which Test Cases, Sessions, and Test Runs within this project are associated with that tag.
