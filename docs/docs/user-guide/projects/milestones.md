---
title: Milestones
sidebar_position: 3 # After Documentation
---

# Milestones List

The Milestones page displays a list of all milestones associated with the current project.

## Accessing Milestones

Navigate to **Projects -> [Your Project] -> Milestones** from the sidebar.

## Viewing Milestones

The page shows milestones as cards, grouped under two tabs:

* **Active:** Milestones that haven't been marked complete.
* **Completed:** Milestones that have been marked complete.

A **kind filter** dropdown above the tabs narrows both tabs to a single milestone kind. It lists **All milestones**, then an entry for each kind actually present: **Synced releases** and **Synced sprints** for milestones synced from Jira (its Fix Versions and Sprints), plus one entry per local milestone type in use — each labeled with the type's name and shown with its own type icon, rather than grouped into a single "Local" bucket. The dropdown appears only when the project has more than one kind to choose between.

Within each tab, child milestones are nested and indented beneath their parent. Each card shows the milestone's name, type icon, status badge, start/due dates, a [summary bar](./milestone-details.md#summary) of its test run and session results, and a forecast estimate.

A milestone synced from an external tracker (currently Jira) shows a [source badge](./milestone-details.md#source-badge) next to its name — for example **Jira · Sprint · active · Website**.

When a milestone has related issues, its summary bar carries the same paired count chips documented on the [Milestone Details](./milestone-details.md#summary) page — a **Target** icon for issues in scope and a **Bug** icon for issues found in testing. On this page, clicking a chip opens a popover listing its issues instead of navigating to the details page.

## Adding a New Milestone

Click the **Add Milestone** button located in the top-right corner of the page.

:::info Permissions Required
Adding milestones requires the `Add/Edit` permission for the `Milestones` application area for the specific project. Users without this permission will not see the "Add Milestone" button.
:::

## Import from Jira

When a milestone-capable integration (currently Jira) has milestone sync enabled for at least one of the project's linked external projects, an **Import from Jira** button appears next to **Add Milestone**.

The dialog previews the tracker's Fix Versions and Sprints across **all** of the project's Jira mappings, with:

* **Show closed:** A toggle (off by default) that includes closed or released artifacts in the preview.
* **Search and per-Jira-project filter chips:** Narrow the preview when the project has more than one Jira mapping.
* **Multi-select:** Pick any number of artifacts to import in one pass.
* **Already Linked badge:** Marks artifacts already tracked as a milestone in this project. A milestone that was previously unlinked or converted to local shows as importable again; importing it re-attaches the existing milestone — its test runs and links stay intact — instead of creating a duplicate.

Milestones are tracked **per project**: several TestPlanIt projects can import the same Jira version or sprint, and each project gets its own independent milestone — synced, unlinked, or deleted without affecting any other project's copy of the same artifact.

Import runs in the background: the dialog closes as soon as the import is queued, an **Importing…** indicator shows progress on the list page, and a toast confirms once the import completes.

:::info Permissions Required
Importing from Jira requires **project admin** status — the project creator, a user with the **Project Admin** role on the project, or a user with `PROJECTADMIN`/`ADMIN` system access. See the [Permissions Guide](../permissions-guide.md).
:::

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
- Confirmation required before deletion — the dialog states how many child and descendant milestones will be deleted along with the parent
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
