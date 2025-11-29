---
sidebar_position: 4
title: Workflows
---

# Workflows Administration

Workflows in TestPlanIt define the possible states and their progression for Test Cases, Test Runs, and Test Sessions. This section allows administrators to customize these workflow states for each distinct scope.

- **Workflow State:** Represents a specific status within a process (e.g., "Draft", "Under Review", "Rejected", "Active", "Archived"). Each state has a name, icon, color, and type.
- **Scope:** Workflows are defined separately for different parts of the application:
  - **Test Cases:** Statuses for individual Test Cases.
  - **Test Runs:** Statuses for Test Runs (collections of test cases and results).
  - **Sessions:** Statuses for Exploratory Testing Sessions.
- **Type:** Each state must be categorized into one of three fundamental types, which drives application logic:

  - **Not Started:** Represents initial or pending states.
  - **In Progress:** Represents active or intermediate states.
  - **Done:** Represents final or terminal states (e.g., Passed, Failed, Closed).

  :::important Requirement
  Each scope (Test Cases, Test Runs, Sessions) **must** have at least one workflow state defined for each of these three types (Not Started, In Progress, Done). This ensures the application can always represent items in any phase of the process.
  :::

To access this page, enter the Administration area and select **Workflows** from the left-hand navigation menu. The page displays separate cards and tables for each scope (Cases, Runs, Sessions).

## Viewing Workflow States

Each scope (Test Cases, Test Runs, Sessions) has its own table listing the defined workflow states for that scope. The tables include columns for:

- **State:** The name of the workflow state, displayed with its associated icon and color.
- **Type:** The fundamental type of the state (Not Started, In Progress, Done).
- **Default:** A switch indicating if this is the default state for new items within this scope. (Only one default per scope).
- **Enabled:** A switch indicating if this state is active and available for selection.
- **Projects:** A count or list of specific projects this state is assigned to (if not assigned to all via Default).
- **Actions:** Buttons to edit or delete the workflow state.

The states within each table can be reordered using **drag-and-drop** to define the logical progression or display order.

## Adding a New Workflow State

1. Click the "Add Workflow State" button (located in the header of the main page).
2. A dialog box will appear. First, select the **Scope** (Test Cases, Test Runs, or Sessions) for which you are adding this state.
3. Configure the state details:
    - **Icon & Color:** Select an icon and color representation for the state using the pickers.
    - **Name:** Enter a unique name for the state within its scope (e.g., "Ready for Review").
    - **Type:** Select the fundamental type (Not Started, In Progress, Done) from the dropdown.
    - **Default:** Toggle if this should be the default state for this scope. Setting a new default automatically applies it to all projects and unsets the previous default for this scope.
    - **Enabled:** Toggle whether this state is active. (Default states must be enabled).
    - **Projects:** (Only relevant if _not_ setting as Default) Use the multi-select dropdown to assign this state to specific projects. You can use the "Select All" link for convenience.
4. Click "Submit".

## Editing an Existing Workflow State

1. Locate the state you wish to modify in the relevant scope table.
2. Click the **Edit** button (pencil icon) in the corresponding row.
3. A dialog box will appear. You can modify:
    - **Icon & Color**
    - **Name**
    - **Type:** (Cannot be changed if this is the _only_ state of its type within its scope, e.g., you cannot change the last "Done" state to "In Progress").
    - **Default:** (Cannot be unset directly; set another state as default instead).
    - **Enabled:** (Cannot be disabled if it's the default state).
    - **Project Assignments:** (Only relevant if not the Default state).
    - _(Note: The **Scope** cannot be changed after creation)._
4. Click "Submit".

## Deleting a Workflow State

Deleting a state marks it as inactive.

1. Locate the state you wish to delete in the table.
2. Click the **Delete** button (trash icon).
    - The button will be disabled if the state is the **Default** state for its scope OR if it is the **last remaining state of its Type** (Not Started, In Progress, or Done) within its scope. You must create another state of that type or change another state's type before deleting the last one.
3. A confirmation dialog will appear.
4. If you are certain, click **Delete**.

:::warning Important
You can neither delete nor disable a Workflow State if it is the last of its type in the scope (Test Cases, Test Runs, Sessions)
:::

## Using Workflows (End Users)

Once workflow states are configured by administrators, team members use them to track the lifecycle of test cases, runs, and sessions.

### Changing Workflow States

**For Test Cases:**
1. Open a test case from the repository
2. Locate the **State** field (typically near the top of the case details)
3. Click the current state dropdown
4. Select a new state from the available options
5. The state change is saved automatically

**For Test Runs:**
1. Navigate to a test run
2. Locate the **State** field in the test run header or details panel
3. Click to select a new state from the dropdown
4. The change applies immediately

**For Sessions:**
1. Open an exploratory session
2. Find the **State** field in the session details
3. Select a new state from the available options
4. The state updates automatically

### Workflow State Visibility

- You can only select states that are **Enabled** and assigned to the current project
- States appear with their configured icon and color for easy recognition
- Default states are automatically assigned to new items when created

### Common Workflow Patterns

**Test Case Lifecycle:**
```
Draft → Under Review → Active → (Testing) → Archived
```

**Test Run Lifecycle:**
```
Not Started → In Progress → Completed
```

**Session Lifecycle:**
```
Planned → Active → In Review → Closed
```

### Workflow States in Search and Filtering

- Use workflow states to filter content in the repository, runs list, and sessions list
- Search by state name to find all items in a specific workflow stage
- States are included in advanced search filters for precise queries

### Best Practices for Using Workflows

1. **Keep States Current**: Update workflow states as work progresses
2. **Consistent Usage**: Follow team conventions for when to use each state
3. **State Transitions**: Move through states logically (e.g., Draft → Review → Active)
4. **Terminal States**: Use "Done" type states when work is complete
5. **Communication**: State changes can trigger notifications to team members
