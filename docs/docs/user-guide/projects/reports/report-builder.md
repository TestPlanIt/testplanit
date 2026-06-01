---
title: Report Builder
sidebar_position: 8
---

# Report Builder

The Report Builder lets you compose a custom report by picking a data source, then choosing dimensions to group by, metrics to measure, and a chart type to render. It sits alongside the pre-built reports on the project's Reports page.

## Data Sources

| Source | What it covers |
| --- | --- |
| **Test Execution** | Test results across runs (status counts, pass rates, elapsed times) |
| **Repository Stats** | Cases in the project's test repository (counts, automation status, custom fields) |
| **User Engagement** | Per-user activity across the project (executions, sessions, results) |
| **Project Health** | Project-level health metrics (pass rates, churn, recent activity) |
| **Session Analysis** | Exploratory testing sessions (durations, findings, executions) |
| **Issue Tracking** | Linked external issues and their associated test cases |

## Workflow

1. Open the project's **Reports** page.
2. Switch to the **Custom Reports** tab.
3. Pick a **Report Type** — this determines the available dimensions and metrics.
4. Choose **Dimensions** to group by (e.g., assigned user, priority, week ending). You can stack multiple dimensions; the dimension order controls the grouping hierarchy.
5. Choose **Metrics** to measure (e.g., Test Results count, Pass Rate, Average Elapsed Time).
6. Apply any **Filters** (date range, tags, custom fields).
7. Pick a **Chart Type** — bar, line, pie, or table.
8. Click **Run Report**.

Results are paginated and the columns are sortable.

## Drill-Down

The Report Builder supports interactive drill-down on every metric cell. Click any metric value in a report table to open a drawer showing the underlying records that contributed to that value.

### How It Works

1. **Click any metric cell** in a report row.
2. The drawer slides in from the right with:
   - Metric name being explored
   - Applied filters summary (dimension values, dates)
   - Total record count
   - For pass rates: status breakdown with colored indicators and the calculated percentage
   - **Export to CSV** button
3. The drawer shows a table with clickable links to view individual records in context.
4. Scroll to load more records (50 at a time).

### What You Can Drill Into

**Test Execution Metrics:**

- Test Results count — view individual test executions with details
- Pass Rate — see pass / fail breakdown with status distribution
- Average Elapsed Time — view test executions with their durations
- Total Elapsed Time — see all executions contributing to the total

**Test Case Metrics:**

- Test Case Count — view repository cases with metadata
- Automated / Manual Counts — see breakdown by automation status
- Average Steps — view test cases with step counts
- Automation Rate — see which cases are automated vs. manual

**Test Run Metrics:**

- Test Run Count — view runs with status and progress
- Milestone Test Cases — see cases included in milestone runs

**Session Metrics:**

- Session Count — view exploratory testing sessions
- Session Duration — see sessions with time spent
- Session Results — view findings and outcomes

**Other Metrics:**

- User activity metrics
- Milestone progress details
- Issue counts and details

### Folder Drill-Down

When a report is grouped by Folder with **Include Descendants** enabled, drilling into a folder cell resolves to all cases in that folder's subtree — not just direct children — so the drawer matches what the rolled-up metric was actually measuring.

## Sharing

A custom report's configuration (data source, dimensions, metrics, filters, chart type) is captured in the URL, so any Share Link you create encodes the exact view your audience will see. See [Share Links](../../share-links.md) for share modes and access control.
