---
title: Reporting & Analytics
sidebar_position: 10
---

# Reporting & Analytics

Each project has its own Reports area at **Project → Reports**, where you can run pre-built reports against the project's repository, test runs, sessions, and issue links, or build custom reports against a focused set of dimensions and metrics.

For analytics aggregated across every project in the system, see [Administration → Reporting & Analytics](../../reporting.md).

## Pre-Built Reports

Pre-built reports have fixed configurations and don't require dimension or metric selection. They appear in the Report Type dropdown on the project's Reports page, which lists every report type alphabetically.

| Report                                                                              | What it shows                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Automation Candidates](./automation-candidates.md)                                 | AI-ranked recommendation of which manual test cases to automate next, with metric-grounded rationales per case.                                                                                                                                                                                                           |
| [Automation Trends](./automation-trends.md)                                         | Repository growth over time pivoted by automation status (automated vs. manual).                                                                                                                                                                                                                                          |
| [Execution Log](./execution-log.md)                                                 | Chronological log of individual test result records, with expandable step-level detail.                                                                                                                                                                                                                                   |
| [Flaky Tests](./flaky-tests.md)                                                     | Test cases whose pass/fail outcomes flip across recent runs, with the flip count and timeline.                                                                                                                                                                                                                            |
| [Issue Test Coverage](./issue-test-coverage.md)                                     | Coverage of external issues (Jira, GitHub, Azure DevOps, GitLab, Gitea/Forgejo) by linked test cases.                                                                                                                                                                                                                     |
| [Iteration Matrix](./iteration-matrix.md)                                           | A 2D grid of parameterized test case results across configurations.                                                                                                                                                                                                                                                       |
| [Requirement Coverage Changes](../requirements-traceability.md#comparing-snapshots) | What changed between a saved [traceability snapshot](../requirements-traceability.md#snapshots) and a later snapshot or the live matrix — one row per requirement whose coverage differs, classified by what changed. Appears only when the project has [requirements enabled](../requirements.md#enabling-requirements). |
| [Requirement Coverage Gaps](../requirements-traceability.md#reports)                | Every requirement with zero linked test cases — and, by default, those whose linked tests have never run — with priority, status, and age, so coverage debt is visible without opening the requirements tree. Appears only when the project has [requirements enabled](../requirements.md#enabling-requirements).         |
| [Requirement Traceability](../requirements-traceability.md#reports)                 | Every requirement paired with its linked test cases and their latest execution result. Appears only when the project has [requirements enabled](../requirements.md#enabling-requirements).                                                                                                                                |
| [Test Case Health](./test-case-health.md)                                           | Per-case health score combining staleness, execution frequency, and pass-rate pattern.                                                                                                                                                                                                                                    |
| [Impact Analysis History](./impact-analysis-history.md)                             | Every Impact analysis with its trigger, selected cases, and the outcome of the run it composed.                                                                                                                                                                                                                           |
| [Code Pin Coverage](./code-pin-coverage.md)                                         | Code Pins by repository and directory, with the changed files no pin covered.                                                                                                                                                                                                                                             |

## Custom Reports

The [Report Builder](./report-builder.md) lets you compose a report by picking a data source (Test Execution, Repository Stats, User Engagement, Project Health, Milestone Readiness, Session Analysis, Issue Tracking), then choosing dimensions, metrics, and a chart type. The builder also supports interactive **drill-down** — click any metric cell to open a drawer showing the underlying records.

## Exporting Results

Tabular reports — every pre-built report except the [Iteration Matrix](./iteration-matrix.md) and [Automation Candidates](./automation-candidates.md) (which have their own dedicated views), plus any custom report — show an **Export CSV** button above the results table.

- It exports the columns you see, with their displayed values (status and priority names, pass-rate percentages, durations, dates), for the **entire** result set — not just the rows currently scrolled into view.
- The [Execution Log](./execution-log.md), which loads incrementally as you scroll, fetches all of its pages first so the file is complete.
- Export is also available on read-only [Share Links](../../share-links.md) and works the same in [cross-project reports](../../cross-project-reports.md) (where it adds a Project column).

This is separate from the drill-down **Export to CSV** in the [Report Builder](./report-builder.md#drill-down), which exports the underlying records behind a single metric cell rather than the report's summary rows.

## Saved Reports

Save any report — pre-built or custom — to come back to it later without creating a Share Link. Saved reports are private: only you can open them. Administrators see their titles listed under **Administration → Manage Shares**.

1. Run the report.
2. Select the **Save** icon in the report toolbar, next to Share.
3. Enter a name and an optional description.
4. Choose **Live** or **Frozen** data:
   - **Live** reopens the report with every setting restored and fetches current data.
   - **Frozen** keeps the results from now. Opening it shows those exact results, when they were frozen, and by whom. See [Live and Frozen Data](../../share-links.md#live-and-frozen-data) for the row limit and what frozen reports support.
5. Select **Save**.

![The Saved Reports menu open at the top right of the Reports page, listing a frozen report marked with a snowflake and a live report, above a live saved report showing its name and description](/img/screenshots/user-guide/projects/reports/saved-reports-menu.png)

To open, rename, or delete a saved report, select **Saved Reports** at the top right of the page, next to the page title. The list shows the reports you saved on this page: project reports on that project's Reports page, and cross-project reports on **Administration → Reports**. A snowflake icon marks frozen reports, which open in a new tab. A live saved report opens on the Reports page with its name and description shown above the results; running a different report there clears them.

## Sharing

Any report — pre-built or custom — can be shared with team members, clients, and stakeholders using a Share Link. A Share Link can be live (re-runs the report when opened) or frozen (always shows the results from when it was created). See [Share Links](../../share-links.md) for live and frozen data, the three share modes (Public, Password-Protected, Authenticated), password rate limiting, view notifications, and view counts.
