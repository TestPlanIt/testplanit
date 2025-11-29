---
sidebar_position: 10 # Adjust position as needed
title: Tags
---

# Tags Administration

Tags are labels that can be applied to various items like Test Cases, Test Runs, and Sessions for categorization, filtering, and reporting purposes. Managing tags centrally ensures consistency across your projects.

To access this page, enter the Administration area and select **Tags** from the left-hand navigation menu.

## Viewing Tags

The Tags page displays a table listing all defined tags (excluding those marked as deleted). Key features include:

- **Filtering**: Use the filter input above the table to search for tags by name.
- **Pagination**: If there are many tags, use the pagination controls at the top-right to navigate through pages and adjust the number of tags shown per page.
- **Sorting**: Click on the "Name" column header to sort the tags alphabetically in ascending or descending order.
- **Column Selection**: Use the "View" dropdown to show or hide specific columns.
- **Columns**: The table includes columns for:
  - **Name**: The unique name of the Tag.
  - **Test Cases**: Displays the number of Test Cases associated with this Tag. Clicking the number may show a list or link to the relevant cases (depending on component implementation).
  - **Sessions**: Displays the number of Test Sessions associated with this Tag. Clicking the number may provide more details.
  - **Test Runs**: Displays the number of Test Runs associated with this Tag. Clicking the number may provide more details.
  - **Actions**: Buttons to **Edit** (pencil icon) or **Delete** (trash can icon) the Tag.

## Adding a New Tag

1. Click the **Add Tag** button (with the plus icon) located in the top-right corner of the header section.
2. A modal dialog titled "Add Tag" will appear.
3. Enter a unique **Name** for the new Tag in the input field.
4. Click **Submit**.

    - If the name already exists, an error message "Name already exists" will be displayed below the input field.
    - If any other error occurs, a general error message will appear near the bottom of the modal.

## Editing an Existing Tag

1. Locate the Tag you wish to modify in the table.
2. Click the **Edit** (pencil) icon in the **Actions** column for that row.
3. A modal dialog titled "Edit Tag" will appear, pre-filled with the current tag name.
4. Modify the **Name** as needed.
5. Click **Submit**.
    - Error handling for duplicate names or other issues is similar to adding a tag.

## Deleting a Tag

Deleting a tag performs a _soft delete_, meaning it marks the tag as inactive but doesn't permanently remove it from the database. The tag will no longer be available for selection when tagging items and will be hidden from the main Tags list.

1. Locate the Tag you wish to remove in the table.
2. Click the **Delete** (trash can) icon in the **Actions** column.
3. A confirmation dialog will appear, asking you to confirm the deletion and showing the tag name.
4. It will also display a warning: "This action cannot be undone. The Tag will be marked as deleted."
5. Click **Delete** (the red button) to confirm the soft deletion.
6. Click **Cancel** to close the dialog without deleting.

_(More content needed...)_
