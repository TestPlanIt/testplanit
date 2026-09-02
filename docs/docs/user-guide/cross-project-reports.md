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
- [Requirement Coverage Gaps](./projects/requirements-traceability.md#reports) — coverage debt across every project that has [requirements enabled](./projects/requirements.md#enabling-requirements).
- [Requirement Traceability](./projects/requirements-traceability.md#reports) — the traceability matrix across every project that has requirements enabled.
- [Test Case Health](./projects/reports/test-case-health.md) — health scores aggregated across the portfolio.

The two requirement reports add a **Requirement Project** column naming the project each requirement belongs to. On the traceability report that sits alongside the existing **Project** column, which names the *covering case's* project — a requirement in one project can be covered by a case in another, so the two answer different questions. Requirement [snapshots](./projects/requirements-traceability.md#snapshots) are captured from a single project and stay project-scoped, so there is no cross-project variant of the Requirement Coverage Changes report.

### Custom Reports

The [Report Builder](./projects/reports/report-builder.md) is available in cross-project mode for the following data sources:

- Test Execution
- Repository Stats
- User Engagement
- Issue Tracking
- [LLM Usage](./llm-usage-report.md) — AI token usage, cost, and reliability. Cross-project only; it has no per-project counterpart.

Drill-down works the same way as in per-project mode (it just shows records from any of the selected projects). The exception is LLM Usage, which does not support drill-down.

## Exporting Results

The **Export CSV** button above the results table downloads the full result set, with a **Project** column added so rows stay attributable across the portfolio. See [Exporting Results](./projects/reports/index.md#exporting-results) for details.

## Not Available Cross-Project

Two pre-built reports are project-only and do not appear in **Administration → Reports**:

- **[Automation Candidates](./projects/reports/automation-candidates.md)** — snapshot-style LLM rankings don't generalize across projects.
- **[Iteration Matrix](./projects/reports/iteration-matrix.md)** — parameterized case matrices are per-project by construction.

These reports remain available inside each individual project at **Project → Reports**.

## Sharing

Cross-project report Share Links capture the project-scope state in the URL, so external viewers see the same aggregation you saw when you created the link. See [Share Links](./share-links.md).
