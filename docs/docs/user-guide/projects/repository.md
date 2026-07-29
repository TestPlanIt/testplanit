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
* **Editing Cases:** Click a test case name to open its [Case Details](./repository-case-details.mdx) in a docked panel beside the list, or use the row's **Edit** action to open the full details page in edit mode.
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
    * **Filter Panel (Other Views)**: When a view other than "By Folder" is selected, this panel shows the available filters for that view (e.g., list of templates, states, creators), each with a count of matching cases. Selecting an item filters the cases shown in the right panel. See [Selecting filter values](#selecting-filter-values) for how short and long lists differ.
    * **Collapse Button**: A chevron button (`<`/`>`) on the handle between panels allows collapsing or expanding this left panel.

* **Right Panel (Test Case List)**:
    * **Breadcrumbs (Folder View Only)**: Shows the path to the currently selected folder. Next to the breadcrumb, a **Show all descendants** toggle (folder-down icon) lets you view test cases from the selected folder and all of its nested subfolders in a single list. When enabled, each test case row displays a folder badge showing which subfolder it belongs to, with a tooltip showing the full folder path. All existing sorting, filtering, search, and bulk actions work on the aggregated list.
    * **Add Case Button**: Allows adding a new test case using a detailed modal (`AddCaseModal`).
    * **Generate Test Cases Button**: Opens the AI generation wizard (sparkles icon, requires [LLM Integration](../llm-integrations.md)).
    * **Import Cases Button**: Opens the CSV import wizard for bulk test case creation.
    * **Filter Input**: Search for test cases by name within the current view/filter.
    * **Column Selection**: Choose which columns are visible in the table using the **Columns** control. Your selection is remembered automatically — it is saved in your browser and scoped to this project's repository, so the columns you pick are still there the next time you open it.
    * **Pagination**: Controls for navigating through pages of test cases.
    * **Test Case Table (`DataTable`)**: Displays the list of test cases based on the current selection/filters. Supports:
        * **Sorting via the column header menu**: Each column header opens a menu with **Sort ascending**, **Sort descending**, **Manual sort** (clears the sort), and **Hide column**. The active sort column shows a faint tint plus a directional accent bar — along the top edge when sorted ascending, the bottom edge when descending. The sort column and direction are remembered per project.
        * **Reordering and resizing columns**: Drag a header by its grip to reorder columns, or drag a header's right edge to resize it. The pinned checkbox, Name, and Actions columns stay in place. Column order and width are remembered per project alongside your visibility choices.
        * Reordering cases via drag-and-drop within the table (only when sorted by the default `order` column and not in selection mode).
        * Clicking a test case name opens its details in a docked [Test Case Details](./repository-case-details.mdx) panel beside the list (see [Test Case Details Panel](#test-case-details-panel) below).
    * **Quick Add Row (`AddCaseRow`)**: An inline form at the bottom of the table for quickly adding a new test case with just a name and state (uses the project's default template).

## Views & Filtering

The **View Selector** in the left panel provides powerful ways to slice your test case data:

* **By Folder**: The default hierarchical view.
* **By Template**: Groups cases by the template they use.
* **By State**: Groups cases by their current workflow state.
* **By Creator**: Groups cases by the user who created them.
* **By Automation**: Filters cases based on whether they are marked as automated.
* **By Parameterization**: Filters cases by whether they have parameters declared (Parameterized / Not Parameterized). Each option shows a live count of matching cases. See [Parameterized Test Cases](./parameterized-test-cases.md) for what makes a case parameterized.
* **By Attachments**: Filters cases by whether they carry attached files (Has Attachments / No Attachments), each with a live count. Only files currently attached count — a case whose attachments were all removed appears under **No Attachments**.
* **By Tag**: Filters cases based on assigned tags (Any Tag, No Tags, or a specific tag).
* **By Issue**: Filters cases based on linked issues (Any Issue, No Issues, or a specific issue). This view only appears when there are test cases with issues attached.
* **By Custom Field**: If custom fields are defined in templates, a view appears per field. Supported field types are Dropdown, Multi-Select, Link, Steps, Checkbox, Integer, Number, Date, Text Long, and Text String.

When you open the repository as part of a **test run** (Run Mode), two additional views appear in place of (and alongside) the base views:

* **By Assigned To**: Filters the run's cases by their assignee (Unassigned, or a specific team member).
* **By Status**: Filters by the result status within this run (Untested, or any of the configured result statuses such as Passed, Failed, Blocked).

### Selecting filter values

Every view is multi-select: you can filter by several templates, tags, issues, or field values at once, and the table shows the cases matching any of them.

* **Short lists (10 or fewer values)** appear as rows with a live count next to each one. Click a row to filter by that value on its own, or Cmd-click (Ctrl-click on Windows/Linux) to add and remove values from the current selection.
* **Long lists (more than 10 values)** appear as a searchable picker instead, so views like By Issue or By Tag stay usable when a project has thousands of values. Type to narrow the list, page through the results, and click values to toggle them. Each selected value becomes a chip on the picker, and the **x** on a chip removes it. Counts are shown next to each value in the dropdown.

Summary options stay directly above the picker in every view — **All Templates**, **Any Tag** / **No Tags**, **Any Issue** / **No Issues**, **Untested**, **Unassigned**, and **None** — so the broad filters remain one click away. These combine with picked values: selecting **No Tags** and then a specific tag shows the cases that have no tags plus the cases carrying that tag.

## Test Case Table Columns

The main table displays the following information for each test case:

* **Checkbox**: For selecting multiple cases for bulk actions (like adding to a test run or deleting).
* **Name**: The title of the test case. Each row shows a type icon — robot for automated cases, checklist for manual cases — followed by a stacked-squares badge when the case is [parameterized](./parameterized-test-cases.md). Clicking the name opens the [Test Case Details](./repository-case-details.mdx) panel beside the list.
* **Template**: The template used by the test case.
* **State**: The current workflow state of the test case.
* **Priority**: The assigned priority level.
* **Estimate**: The manually set estimated time (often shown in a human-readable format like "5m") required to execute the test case.
* **Forecast**: An automatically calculated prediction of execution time based on historical results. See [Test Case Details](./repository-case-details.mdx#forecast-calculation) for more info.
* **Tags**: Associated tags.
* **Latest Results**: The case's last five results across all test runs, newest first, drawn as small colored squares (the most recent at full strength, older ones progressively faded). Each square links to the run that produced it, and the history covers both manual run results and automated JUnit results. Hovering over a square shows the status and when it was executed. The column is sortable: clicking the header groups cases by the status of their most recent result, and cases that have never been executed always sort last, in either direction.
* **Last Updated**: Timestamp of the last modification.
* **Actions** (Ellipsis Menu):
    * **Edit**: Opens the [Test Case Details](./repository-case-details.mdx) page in edit mode.
    * **Delete**: Initiates the soft delete process for the test case, requiring confirmation.

Additional dynamic columns appear based on the fields defined in the templates used by the displayed cases.

### Remembered column choices

Your column layout — which columns are visible, the order they appear in, and each column's width — is saved per project and restored each time you return. The sort column and direction you last applied are remembered the same way. Because the available columns change with the templates in view, choices are matched by column: a column you hid or showed is restored whenever that column is present, and any saved choice for a column that is not in the current view — for example a removed template field, or a field that belongs to a template you are not currently looking at — is simply ignored. Switching between templates therefore keeps each template's columns the way you left them. If you open the repository from a shared link whose URL specifies columns, those columns take precedence for that visit.

## Test Case Details Panel

Clicking a test case name opens its [Test Case Details](./repository-case-details.mdx) in a docked panel to the right of the case list, without leaving the repository. The selected case's row stays highlighted in the list — the highlight fills across the pinned columns — and stepping between cases moves the highlight without scrolling the list.

* **Resizable split**: Drag the divider between the list and the panel to set how much space each takes. Your split is remembered.
* **Full-width toggle**: The expand control in the panel header hides the folder tree and case list so the details fill the whole content area; collapse it to return to the split view. On narrow viewports the panel automatically takes over the full width.
* **Prev/next navigation**: The header shows the selected case's position as "N of total" and steps through the entire filtered result set — across page boundaries, not just the visible page. With **Show all descendants** enabled, it spans every case in the selected folder and its subfolders. When focus is not in a field or editor, the left/right arrow keys step to the previous/next case.
* **Open full page and close**: The header also links to the standalone full-page view (opens in a new tab) and provides a close control. The browser Back button closes the panel as well.

## Drag and Drop

While you drag a test case, the valid drop destinations are outlined with a dashed border and labeled so the outcome is clear before you release:

* The reorder zone within the case list shows **Drop to reorder**.
* The folder tree shows **Drop on a folder — hold ⇧ to move, ⌥ to copy** (on Windows and Linux, **Drop on a folder — hold Shift to move, Ctrl to copy**). Once you hold a modifier, the label switches to **Drop on a folder to move** or **Drop on a folder to copy** to confirm the chosen action.

### Reordering Test Cases

When the table is sorted by the default **Order** column and selection mode is off, you can drag any test case row to a new position within the same folder. A blue indicator line shows where the case will land. Releasing the row commits the new order.

### Moving Test Cases to a Folder

Drag one or more test cases from the table and drop them onto a folder in the folder tree. When you release, a small popover appears with three options:

* **Cancel** — discards the drop and leaves all cases in place.
* **Move** — transfers the cases to the target folder. Version history and comments are preserved.
* **Copy** — creates duplicates of the cases in the target folder. Copies start at version 1 with no prior history.

#### Bypassing the Popover with Modifier Keys

Hold a modifier key while dragging to skip the popover entirely — the operation fires immediately on drop:

| Platform | Copy | Move |
| --- | --- | --- |
| Mac | Hold **⌥ Option** | Hold **⇧ Shift** |
| Windows / Linux | Hold **Ctrl** | Hold **Shift** |

The drag preview badge updates in real time to reflect the active modifier — a copy icon when copying, a move icon when moving, and an up/down arrow icon when hovering over a reorder zone (where copy and move have no effect).
