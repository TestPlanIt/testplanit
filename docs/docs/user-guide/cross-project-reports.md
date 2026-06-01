---
title: Cross-Project Reports
sidebar_position: 1
---

# Cross-Project Reports

Cross-project reports aggregate data across every project in the system into a single Report Builder view. They live under **Administration → Reports** and require global admin access.

## Project Scope

By default, a cross-project report runs across every project the admin has access to. You can narrow the scope by selecting specific projects in the **Projects** filter at the top of the builder, or group results by project by including the **Project** dimension.

## Available Reports

### Pre-Built Reports

The following pre-built reports have cross-project variants. The underlying semantics, filters, and column shapes are the same as the per-project versions — the cross-project variant just aggregates across multiple projects. Click through for the full behavior reference.

- [Automation Trends](./projects/reports/automation-trends.md) — repository growth pivoted by automation status, summed across projects.
- [Execution Log](./projects/reports/execution-log.md) — flat chronological log of every test result across the selected projects.
- [Flaky Tests](./projects/reports/flaky-tests.md) — flaky cases identified across the selected projects.
- [Issue Test Coverage](./projects/reports/issue-test-coverage.md) — coverage rolled up across each project's issue integrations.
- [Test Case Health](./projects/reports/test-case-health.md) — health scores aggregated across the portfolio.

### Custom Reports

The [Report Builder](./projects/reports/report-builder.md) is available in cross-project mode for the following data sources:

- Test Execution
- Repository Stats
- User Engagement
- Issue Tracking

Drill-down works the same way as in per-project mode (it just shows records from any of the selected projects).

## Not Available Cross-Project

Two pre-built reports are project-only and do not appear in **Administration → Reports**:

- **[Automation Candidates](./projects/reports/automation-candidates.md)** — snapshot-style LLM rankings don't generalize across projects.
- **[Iteration Matrix](./projects/reports/iteration-matrix.md)** — parameterized case matrices are per-project by construction.

These reports remain available inside each individual project at **Project → Reports**.

## Sharing

Cross-project report Share Links capture the project-scope state in the URL, so external viewers see the same aggregation you saw when you created the link. See [Share Links](./share-links.md).
