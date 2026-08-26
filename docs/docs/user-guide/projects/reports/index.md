---
title: Reporting & Analytics
sidebar_position: 10
---

# Reporting & Analytics

Each project has its own Reports area at **Project → Reports**, where you can run pre-built reports against the project's repository, test runs, sessions, and issue links, or build custom reports against a focused set of dimensions and metrics.

For analytics aggregated across every project in the system, see [Administration → Reporting & Analytics](../../reporting.md).

## Pre-Built Reports

Pre-built reports have fixed configurations and don't require dimension or metric selection. They show up at the top of the Report Type dropdown in the project's Reports page.

| Report | What it shows |
| --- | --- |
| [Automation Candidates](./automation-candidates.md) | AI-ranked recommendation of which manual test cases to automate next, with metric-grounded rationales per case. |
| [Automation Trends](./automation-trends.md) | Repository growth over time pivoted by automation status (automated vs. manual). |
| [Execution Log](./execution-log.md) | Chronological log of individual test result records, with expandable step-level detail. |
| [Flaky Tests](./flaky-tests.md) | Test cases whose pass/fail outcomes flip across recent runs, with the flip count and timeline. |
| [Issue Test Coverage](./issue-test-coverage.md) | Coverage of external issues (Jira, GitHub, Azure DevOps, GitLab, Gitea/Forgejo) by linked test cases. |
| [Iteration Matrix](./iteration-matrix.md) | A 2D grid of parameterized test case results across configurations. |
| [Requirement Coverage Gaps](../requirements-traceability.md#reports) | Every requirement with zero linked test cases, so coverage gaps are visible without opening the requirements tree. Appears only when the project has [requirements enabled](../requirements.md#enabling-requirements). |
| [Requirement Traceability](../requirements-traceability.md#reports) | Every requirement paired with its linked test cases and their latest execution result. Appears only when the project has [requirements enabled](../requirements.md#enabling-requirements). |
| [Test Case Health](./test-case-health.md) | Per-case health score combining staleness, execution frequency, and pass-rate pattern. |

## Custom Reports

The [Report Builder](./report-builder.md) lets you compose a report by picking a data source (Test Execution, Repository Stats, User Engagement, Project Health, Milestone Readiness, Session Analysis, Issue Tracking), then choosing dimensions, metrics, and a chart type. The builder also supports interactive **drill-down** — click any metric cell to open a drawer showing the underlying records.

## Exporting Results

Tabular reports — every pre-built report except the [Iteration Matrix](./iteration-matrix.md) and [Automation Candidates](./automation-candidates.md) (which have their own dedicated views), plus any custom report — show an **Export CSV** button above the results table.

- It exports the columns you see, with their displayed values (status and priority names, pass-rate percentages, durations, dates), for the **entire** result set — not just the rows currently scrolled into view.
- The [Execution Log](./execution-log.md), which loads incrementally as you scroll, fetches all of its pages first so the file is complete.
- Export is also available on read-only [Share Links](../../share-links.md) and works the same in [cross-project reports](../../cross-project-reports.md) (where it adds a Project column).

This is separate from the drill-down **Export to CSV** in the [Report Builder](./report-builder.md#drill-down), which exports the underlying records behind a single metric cell rather than the report's summary rows.

## Sharing

Any report — pre-built or custom — can be shared with team members, clients, and stakeholders using a Share Link. See [Share Links](../../share-links.md) for the three share modes (Public, Password-Protected, Authenticated), password rate limiting, view notifications, and access analytics.
