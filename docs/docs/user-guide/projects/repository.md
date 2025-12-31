---
title: Test Case Repository
sidebar_position: 4 # After Milestones
---

# Test Case Repository

The Test Case Repository is where you organize and manage your project's test cases.

## Structure

* **Folders:** Organize test cases hierarchically using folders.
* **Test Cases:** Individual test specifications containing steps, expected results, and other relevant information.

## Viewing the Repository

Navigate to **Projects -> [Your Project] -> Repository** from the sidebar.

You will see:

* **Folder Tree View:** A hierarchical view of folders on the left.
* **Test Case List:** A list of test cases within the selected folder on the right.

## Adding Folders and Cases

* **Add Folder:** Click the "Add Folder" button (usually near the top of the folder tree).
* **Add Case:** Click the "Add Case" button for manual test case creation (see [Add Test Case](./repository-add-case.md)).
* **Generate Test Cases:** Click the "Generate Test Cases" button (sparkles icon) to use AI-powered generation from issues or requirements (requires [LLM Integration](../llm-integrations.md)).
* **Import Cases:** Click the "Import Cases" button to bulk import test cases from CSV files.

## Editing and Organizing

* **Renaming/Deleting Folders:** Typically done via context menus (right-click) or buttons within the folder tree.
* **Moving Folders/Cases (Drag & Drop):** Folders and test cases can often be reorganized by dragging and dropping them within the tree or list.
* **Editing Cases:** Click on a test case name or an edit icon to navigate to the [Case Details](./repository-case-details.mdx) page.
* **Deleting Cases:** Often done via buttons or context menus in the test case list or on the details page.

:::info Permissions Required

* **Adding/Editing/Moving/Deleting Folders & Cases:** Requires the `Add/Edit` permission for the `TestCaseRepository` application area. Users without this permission will not see "Add Folder" or "Add Case" buttons, cannot rename/delete folders, and drag-and-drop functionality will be disabled.
* **Deleting Cases:** Deleting individual cases also requires the `Delete` permission for the `TestCaseRepository` application area. The specific delete actions might be hidden if the user lacks `Add/Edit` (preventing access to edit menus) or `Delete` permission.
* **Viewing Empty Repository:** If a user without `Add/Edit` permission views an empty repository, they will see a message indicating they don't have permission to add items, rather than the standard prompt to create folders/cases.
:::

## Layout

The page features a resizable two-panel layout:

* **Left Panel (Navigation/View Selection)**:

    * **View Selector**: Allows switching between different ways to organize and filter test cases (e.g., By Folder, By Template, By State, By Tag, By Custom Fields, etc.).
    * **Folder Tree (Default View)**: Displays a hierarchical structure of folders. You can:
        * Expand/Collapse folders using the chevron icons.
        * Select a folder to view its contained test cases in the right panel.
        * Drag and drop folders to reorder them or change their parent (except in Run Mode).
        * Add a new folder using the **Add Folder** button (icon: CirclePlus) at the top.
        * Edit an existing folder's name/docs using the **Edit** button (icon: SquarePen) that appears on hover.
    * **Filter Panel (Other Views)**: When a view other than "By Folder" is selected, this panel typically shows a list of available filters for that view (e.g., list of templates, states, creators). Selecting an item filters the cases shown in the right panel.
    * **Collapse Button**: A chevron button (`<`/`>`) on the handle between panels allows collapsing or expanding this left panel.

* **Right Panel (Test Case List)**:
    * **Breadcrumbs (Folder View Only)**: Shows the path to the currently selected folder.
    * **Add Case Button**: Allows adding a new test case using a detailed modal (`AddCaseModal`).
    * **Generate Test Cases Button**: Opens the AI generation wizard (sparkles icon, requires [LLM Integration](../llm-integrations.md)).
    * **Import Cases Button**: Opens the CSV import wizard for bulk test case creation.
    * **Filter Input**: Search for test cases by name within the current view/filter.
    * **Column Selection**: Choose which columns are visible in the table.
    * **Pagination**: Controls for navigating through pages of test cases.
    * **Test Case Table (`DataTable`)**: Displays the list of test cases based on the current selection/filters. Supports:
        * Sorting by clicking column headers (Name, State, etc.).
        * Reordering cases via drag-and-drop within the table (only when sorted by the default `order` column and not in selection mode).
        * Clicking a test case name navigates to its **Test Case Details** page (to be documented separately).
    * **Quick Add Row (`AddCaseRow`)**: An inline form at the bottom of the table for quickly adding a new test case with just a name and state (uses the project's default template).

## Views & Filtering

The **View Selector** in the left panel provides powerful ways to slice your test case data:

* **By Folder**: The default hierarchical view.
* **By Template**: Groups cases by the template they use.
* **By State**: Groups cases by their current workflow state.
* **By Creator**: Groups cases by the user who created them.
* **By Automation**: Filters cases based on whether they are marked as automated.
* **By Tag**: Filters cases based on assigned tags (Any Tag, No Tags, or a specific tag).
* **By Custom Field**: If custom fields (Dropdown, Multi-Select, Link, Steps, Checkbox types) are defined in templates, views will be available to filter by the values of those fields.

## Test Case Table Columns

The main table displays the following information for each test case:

* **Checkbox**: For selecting multiple cases for bulk actions (like adding to a test run or deleting).
* **Name**: The title of the test case. Clicking the name navigates to the [Test Case Details](./repository-case-details.mdx) page.
* **Template**: The template used by the test case.
* **State**: The current workflow state of the test case.
* **Priority**: The assigned priority level.
* **Estimate**: The manually set estimated time (often shown in a human-readable format like "5m") required to execute the test case.
* **Forecast**: An automatically calculated prediction of execution time based on historical results. See [Test Case Details](./repository-case-details.mdx#forecast-calculation) for more info.
* **Tags**: Associated tags.
* **Last Result**: The most recent test result for this case across all test runs. Displays the status (e.g., Passed, Failed, Blocked) as a colored dot with the status name. Hovering over the status reveals a tooltip showing when the test was last executed and which test run produced the result.
* **Last Updated**: Timestamp of the last modification.
* **Actions** (Ellipsis Menu):
    * **Edit**: Opens the [Test Case Details](./repository-case-details.mdx) page in edit mode.
    * **Delete**: Initiates the soft delete process for the test case, requiring confirmation.

Additional dynamic columns appear based on the fields defined in the templates used by the displayed cases.
