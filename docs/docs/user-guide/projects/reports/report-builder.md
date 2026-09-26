---
title: Report Builder
sidebar_position: 8
---

# Report Builder

The Report Builder lets you compose a custom report by picking a data source, then choosing dimensions to group by and metrics to measure. The chart type follows from the dimensions you choose. It sits alongside the pre-built reports on the project's Reports page.

## Data Sources

| Source                  | What it covers                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Test Execution**      | Test results across runs (status counts, pass rates, elapsed times), plus Impact Analysis counts, selected cases, and selection precision, grouped by trigger or code repository when the project uses [Impact Analysis](../../impact.md)                                                        |
| **Repository Stats**    | Cases in the project's test repository (counts, automation status, custom fields)                                                                                                                                                                                                                |
| **User Engagement**     | Per-user activity across the project (executions, sessions, results)                                                                                                                                                                                                                             |
| **Project Health**      | Project-level health metrics (pass rates, churn, recent activity)                                                                                                                                                                                                                                |
| **Milestone Readiness** | Release readiness per milestone — % of in-scope issues fully passing, plus per-state counts (passed, failed, in progress, not run, uncovered, total). Supports a date-range filter on each milestone's effective date, and a Date dimension that plots readiness chronologically as a line chart |
| **Session Analysis**    | Exploratory testing sessions (durations, findings, executions)                                                                                                                                                                                                                                   |
| **Issue Tracking**      | Linked external issues and their associated test cases                                                                                                                                                                                                                                           |

## Workflow

1. Open the project's **Reports** page.
2. Switch to the **Report Builder** tab.
3. Pick a **Report Type** — this determines the available dimensions and metrics.
4. Choose **Dimensions** to group by (e.g., assigned user, priority, week ending). You can stack multiple dimensions; the dimension order controls the grouping hierarchy.
5. Choose **Metrics** to measure (e.g., Test Results count, Pass Rate, Average Elapsed Time).
6. Apply any **Filters** (date range, tags, custom fields).
7. Click **Run Report**.

Results render as a single, continuously-scrolling list (no page controls) and the columns are sortable. Use **Export CSV** above the table to download the full result set — see [Exporting Results](./index.md#exporting-results).

With more than one dimension, rows group by the first dimension and each group row totals its children: counts and elapsed times are summed, and rates are averaged. An averaged metric such as Avg. Elapsed Time is summed too — the group row is one run of everything beneath it, the same figure as the chart's total line — and carries a **Σ** marker whose tooltip gives the number of rows totalled.

When the **Date** dimension (or **Milestone**, which plots chronologically by each milestone's date) is combined with another dimension — for example Date and Test Case with Avg. Elapsed Time — the chart draws one line per value of the other dimension. Turn on **Show total line** to add a dashed line that sums the plotted series at each point on the time axis; with Avg. Elapsed Time by Test Case, that is the time one run of all the selected cases would take. The option is not offered for percentage metrics such as Pass Rate, since rates do not add up.

The builder keeps its configuration in the page URL, so other parts of the app can link into a pre-configured report. For example, the **Elapsed time report** action on a case's [Test Result History](../repository-case-details.mdx#test-result-history) opens a Test Execution report with **Date** and **Test Case** dimensions, the **Avg. Elapsed Time** metric, and the Test Case filter set to that case.

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
4. Scroll to load more records (500 at a time).

### What You Can Drill Into

**Test Execution Metrics:**

- Test Results count — view individual test executions with details
- Pass Rate — see pass / fail breakdown with status distribution
- Average Elapsed Time — view test executions with their durations
- Total Elapsed Time — see all executions contributing to the total
- Impact Analysis Count — view the analyses in the group, with their trigger and the run each composed
- Affected Cases Selected — the same analyses, whose pinned and affected counts make up the total
- Selection Precision — the analyses whose composed runs were executed

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

### Impact Dimensions

With [Impact Analysis](../../impact.md) enabled, the Test Execution source offers two more dimensions. **Trigger** groups by how the analysis that composed a test run was started: **Manual**, or **Pull request** / **Push** when a [repository webhook](../../webhooks.md#repository-webhooks) started it. **Code Repository** groups by the connected repository whose analysis composed the run. In both dimensions, runs no analysis composed fall into **None**. Three Impact metrics accompany them: **Impact Analysis Count**, **Affected Cases Selected** (pinned plus affected cases, summed), and **Selection Precision (%)** — of the selected cases that were executed, the share that failed. Precision stays empty until something selected has run.

### Folder Drill-Down

When a report is grouped by Folder with **Include Descendants** enabled, drilling into a folder cell resolves to all cases in that folder's subtree — not just direct children — so the drawer matches what the rolled-up metric was actually measuring.

## Saving and Sharing

**Save** stores the report — data source, dimensions, metrics, filters, and date range — in your private [Saved Reports](./index.md#saved-reports). **Share** creates a [Share Link](../../share-links.md) with the same configuration. Either can be live, re-running the report on every open, or frozen, keeping the results from the moment you saved or shared. See [Live and Frozen Data](../../share-links.md#live-and-frozen-data).
