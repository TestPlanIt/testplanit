---
title: Milestones
sidebar_position: 3 # After Documentation
---

# Milestones List

The Milestones page displays a list of all milestones associated with the current project.

## Accessing Milestones

Navigate to **Projects -> [Your Project] -> Milestones** from the sidebar.

## Viewing Milestones

The page shows a table with the following columns:

* **Name:** The name of the milestone (clickable link to the Milestone Details page).
* **Status:** The current status of the milestone (e.g., Open, In Progress, Completed).
* **Due Date:** The target completion date for the milestone.
* **Actions:** (Usually contains an edit button or link).

## Adding a New Milestone

Click the **Add Milestone** button located in the top-right corner of the page.

:::info Permissions Required
Adding milestones requires the `Add/Edit` permission for the `Milestones` application area for the specific project. Users without this permission will not see the "Add Milestone" button.
:::

## Searching and Filtering

* **Search:** Use the search bar to find milestones by name.
* **Filtering:** Apply filters (e.g., by status) if available.

## Sorting

Click on column headers to sort the list by that column.

## Navigation

Clicking on a milestone name will navigate you to the [Milestone Details](./milestone-details.md) page for that specific milestone.

## Hierarchical Milestones

TestPlanIt supports hierarchical milestone structures, allowing you to organize milestones in parent-child relationships for better project planning and tracking.

### Overview

Hierarchical milestones enable you to:

- **Break down large milestones** into smaller, manageable sub-milestones
- **Track progress hierarchically** with child milestone completion affecting parent progress
- **Organize by phases** such as Sprint → Epic → Story
- **Visualize dependencies** between different levels of work
- **Roll up metrics** from child milestones to parents

### Milestone Structure

**Parent-Child Relationships:**
- A milestone can have **one parent** milestone
- A milestone can have **multiple child** milestones
- **Root milestones** have no parent (top-level)
- **Leaf milestones** have no children (bottom-level)

**Hierarchy Tracking:**
- **Root**: The top-most ancestor in a milestone tree
- **Parent**: The immediate parent of a milestone
- **Children**: Direct descendants of a milestone
- **Descendants**: All milestones below in the hierarchy tree

### Creating Hierarchical Milestones

#### Creating a Root Milestone

1. Navigate to **Projects** → **[Your Project]** → **Milestones**
2. Click **Add Milestone**
3. Fill in milestone details:
   - **Name**: e.g., "Q1 2024 Release"
   - **Type**: Select appropriate milestone type
   - **Due Date**: Set target completion date
   - **Parent Milestone**: Leave blank (or select "None")
4. Save the milestone

#### Creating a Child Milestone

1. From the Milestones page, click **Add Milestone**
2. Fill in milestone details:
   - **Name**: e.g., "Feature Development Phase"
   - **Type**: Select appropriate type
   - **Due Date**: Should typically be before or equal to parent's due date
   - **Parent Milestone**: Select the parent from the dropdown
3. Save the milestone

**Alternative Method:**
- Open a parent milestone's details page
- Look for **Add Child Milestone** button
- Fill in child milestone details
- Parent is automatically set

### Viewing Hierarchical Milestones

**List View:**
- Milestones can be displayed with indentation showing hierarchy levels
- Expand/collapse controls for parent milestones
- Visual indicators (icons) showing parent/child status

**Tree View:**
- Visual tree representation of milestone hierarchy
- Shows entire milestone structure at a glance
- Click to expand/collapse branches
- Navigate directly to any milestone in the tree

**Milestone Details Page:**
- **Parent Section**: Shows the parent milestone (if any) with link
- **Children Section**: Lists all direct child milestones
- **Breadcrumb**: Shows path from root to current milestone

### Hierarchy Best Practices

#### Organizational Patterns

**Release Planning:**
```
Release 2.0 (Root)
├── Planning Phase
├── Development Phase
│   ├── Backend Features
│   ├── Frontend Features
│   └── Integration
├── Testing Phase
│   ├── Unit Testing
│   ├── Integration Testing
│   └── UAT
└── Deployment Phase
```

**Agile Sprint Structure:**
```
Quarter 1 2024 (Root)
├── Sprint 1
│   ├── Epic: User Authentication
│   │   ├── Story: Login Page
│   │   ├── Story: Password Reset
│   │   └── Story: SSO Integration
│   └── Epic: Dashboard
│       ├── Story: Widgets
│       └── Story: Charts
├── Sprint 2
└── Sprint 3
```

**Feature-Based Organization:**
```
Product Launch (Root)
├── Core Features
│   ├── Feature A
│   ├── Feature B
│   └── Feature C
├── Marketing Activities
│   ├── Campaign Planning
│   └── Content Creation
└── Operations Setup
    ├── Infrastructure
    └── Support Training
```

#### Hierarchy Guidelines

**Depth Recommendations:**
- **Optimal depth**: 2-4 levels
- **Maximum depth**: Avoid more than 5 levels for clarity
- **Balance**: Keep sibling counts manageable (5-10 per level)

**Naming Conventions:**
- Use clear, descriptive names at each level
- Include level indicators if helpful (e.g., "Phase 1:", "Sprint 3:")
- Be consistent with naming patterns across levels

**Date Management:**
- Child due dates should be ≤ parent due dates
- Leave buffer time between child completion and parent due date
- Consider dependencies when setting child milestone dates

### Progress Tracking

**Completion Behavior:**
- Marking a parent as complete doesn't auto-complete children
- System can calculate parent progress based on child completion
- Completion percentages can roll up hierarchically

**Status Indicators:**
- **All children complete**: Parent can be marked complete
- **Some children incomplete**: Parent shows in-progress status
- **Overdue children**: Parent may show at-risk status

**Metrics Roll-up:**
- Test case counts aggregate from children to parents
- Test run assignments can be filtered by milestone hierarchy
- Reports can group by hierarchy levels

### Managing Hierarchy

#### Moving Milestones

**Changing Parent:**
1. Open milestone details
2. Edit milestone
3. Select new parent from dropdown (or "None" for root)
4. Save changes

**Restrictions:**
- Cannot set a child milestone as parent of its own ancestor (prevents circular reference)
- Cannot set self as parent
- Moving a milestone moves all its descendants

#### Deleting Hierarchical Milestones

**Deleting a Leaf Milestone:**
- Simply deletes the milestone
- No effect on siblings or parents

**Deleting a Parent Milestone:**
- **Cascade delete**: All child milestones are also deleted
- Confirmation required before deletion
- Consider orphaning children by moving them first

**Best Practice:**
Before deleting a parent, review child milestones and either:
- Move children to a different parent
- Delete children individually if no longer needed
- Keep a backup if data is important

### Common Use Cases

#### Product Roadmap Planning

Use hierarchical milestones to represent:
- **Root**: Annual goals or product versions
- **Level 1**: Quarterly objectives
- **Level 2**: Monthly deliverables
- **Level 3**: Weekly sprints or tasks

#### Project Phase Management

Structure complex projects:
- **Root**: Overall project
- **Level 1**: Major phases (Initiation, Planning, Execution, Closure)
- **Level 2**: Phase deliverables
- **Level 3**: Specific tasks or work packages

#### Agile Development

Organize agile workflows:
- **Root**: Program Increment (PI)
- **Level 1**: Sprints
- **Level 2**: Epics
- **Level 3**: User Stories

### Filtering and Reporting

**Filter by Hierarchy:**
- Show only root milestones
- Filter by specific parent
- Show milestones at specific depth
- Filter by entire hierarchy branch

**Reports:**
- Hierarchy-aware progress reports
- Burndown charts by hierarchy level
- Completion forecasting with child milestone data
- Resource allocation across hierarchy

### Tips and Tricks

1. **Start Simple**: Begin with 2-3 levels and expand as needed
2. **Use Types**: Assign different milestone types to different hierarchy levels
3. **Color Coding**: Use colors or icons to distinguish hierarchy levels
4. **Templates**: Create milestone hierarchy templates for recurring projects
5. **Review Regularly**: Periodically review hierarchy structure for optimization
6. **Document Structure**: Maintain documentation of your hierarchy conventions
7. **Avoid Over-nesting**: Too many levels can be counterproductive
8. **Balance Width and Depth**: Prefer broader trees over very deep ones

### Troubleshooting

**Issue: Cannot set parent milestone**
- Check if creating circular reference (milestone can't be ancestor of itself)
- Verify permissions to edit both milestones
- Ensure parent milestone is in the same project

**Issue: Deleted milestone still appears**
- Soft-deleted milestones may still show in some views
- Check deletion filters/settings
- Verify cascade delete completed for all children

**Issue: Progress not updating**
- Refresh the page to see latest completion data
- Verify child milestones are properly linked
- Check if completion percentages need manual recalculation

### API Reference

**Get Milestone with Hierarchy:**
```http
GET /api/model/Milestones/findFirst?q={
  "where": {"id": 123},
  "include": {
    "parent": true,
    "children": true,
    "root": true
  }
}
```

**Create Child Milestone:**
```http
POST /api/model/Milestones/create
Content-Type: application/json

{
  "data": {
    "name": "Child Milestone",
    "project": {"connect": {"id": 1}},
    "parent": {"connect": {"id": 123}},
    "milestoneType": {"connect": {"id": 5}},
    "dueDate": "2024-12-31"
  }
}
```

**Get All Descendants:**
```http
GET /api/model/Milestones/findMany?q={
  "where": {"rootId": 123},
  "orderBy": {"createdAt": "asc"}
}
```
