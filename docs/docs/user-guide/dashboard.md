---
title: Dashboard
sidebar_position: 1
---

# Dashboard Overview

The Dashboard is the main landing page you see after logging in to TestPlanIt. It serves as your central hub, providing a quick overview of your work assignments and direct access to the projects you are involved in.

## Dashboard Layout

The Dashboard uses a two-panel resizable layout that you can customize to fit your workflow:

- **Left Panel**: Your Assignments - shows test runs and sessions assigned to you
- **Right Panel**: Your Projects - displays all projects you have access to
- **Resize Handle**: Drag the handle between panels to adjust their widths
- **Collapse Button**: Click the chevron button to collapse/expand the left panel

The panel sizes are automatically saved and will be restored when you return to the dashboard.

## Your Assignments (Left Panel)

The left panel displays all work items currently assigned to you, including test runs and exploratory sessions.

### Work Schedule Visualization

When you have assigned work with time estimates, a Gantt chart visualizes your work schedule:

- **Schedule Information**:
  - Total work effort (displayed in days, hours, minutes, seconds)
  - Schedule span showing start and end dates/times
  - Formatted according to your user preferences

- **Gantt Chart Features**:
  - Visual timeline of your upcoming work
  - Test runs are grouped together with individual test cases displayed
  - Sessions are shown as individual items
  - Color-coded bars with your project's primary color
  - Hover over items to see details
  - Click on items to navigate directly to them
  - Workday scheduling (9 AM - 5 PM weekdays only)

### Your Pending Runs

This section shows test runs that have test cases assigned to you requiring action:

- **Run Information**:
  - Test run name (clickable link to the run)
  - Project name
  - Visual summary of test case statuses

- **Test Case Summary**:
  - Count of test cases by status
  - Visual indicators for untested, passed, failed, and other statuses
  - Only shows runs where you have pending test cases

### Your Active Sessions

This section displays exploratory testing sessions currently assigned to you:

- **Session Information**:
  - Session name (clickable link to the session)
  - Project name
  - Session progress summary

- **Session Summary**:
  - Time spent vs. estimated time
  - Session completion status
  - Only shows sessions that are not yet completed

### No Work Assigned

If you have no pending test runs or active sessions, the dashboard displays a friendly message indicating you have no current assignments.

## Your Projects (Right Panel)

The right panel lists all projects you are assigned to or have access to (based on your user role and project permissions).

### Project Statistics

At the top of the section, you'll see:

- **Project Count**: Total number of projects you have access to (excluding deleted projects)

### Project Cards

Each project is represented by a card with comprehensive information:

- **Visual Indicators**:
  - Project icon with chosen color
  - Completed projects have a muted appearance
  - Active projects have a distinct primary-colored border
  - Hover effect with link icon indicator

- **Project Details**:
  - **Project Name**: Displayed prominently (truncated if too long)
  - **Description**: Short note or description for the project
  - **Assigned Users**: Visual list of team members assigned to the project
  - **Created Date**: When the project was created, formatted per your preferences
  - **Status**: Shows "Active" for ongoing projects or completion date for finished ones

- **Project Statistics** (displayed on the card):
  - **Test Cases**: Total count of test cases in the repository
  - **Active Milestones**: Count of incomplete milestones
  - **Active Test Runs**: Count of ongoing test runs
  - **Active Sessions**: Count of active exploratory sessions
  - **Open Issues**: Count of open issues tracked in the project

### Interacting with Project Cards

- **Click Anywhere**: Clicking on any part of a project card navigates you to that project's overview page
- **Hover Effect**: A link icon appears next to the project name when hovering to indicate the card is clickable
- **Loading States**: Issue counts may show a loading indicator while fetching data

### No Projects Available

If you don't have access to any projects, a special card will be displayed prompting you to:

- Create a new project (if you have permission)
- Contact an administrator for project access

## User Access Levels

The content displayed on the dashboard respects your user access level:

- **ADMIN/PROJECTADMIN/USER**: Full dashboard access with both panels
- **NONE**: Limited access - may only see the projects panel
- **Project-Specific Permissions**: Projects are filtered based on:
  - Direct user assignments
  - Group memberships with project access
  - Projects with global role access

## Responsive Design

The dashboard adapts to different screen sizes:

- **Desktop**: Full two-panel layout with resizable panels
- **Tablet**: Panels stack or resize based on available space
- **Mobile**: Single column layout with scrolling

## Tips for Using the Dashboard

1. **Customize Your View**: Adjust the panel sizes to focus on what's most important to you
2. **Quick Navigation**: Click directly on runs, sessions, or projects to jump to them
3. **Monitor Workload**: Use the Gantt chart to visualize your upcoming work schedule
4. **Track Progress**: Check test case and session summaries to see your progress at a glance
5. **Stay Updated**: The dashboard refreshes data when you return to the page
