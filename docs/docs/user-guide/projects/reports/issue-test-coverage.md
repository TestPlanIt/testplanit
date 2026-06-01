---
title: Issue Test Coverage
sidebar_position: 5
---

# Issue Test Coverage

Shows test coverage for issues tracked in integrated systems (Jira, GitHub, Azure DevOps, GitLab, Gitea/Forgejo). Track testing progress for issues and ensure critical items have adequate test coverage.

## What It Shows

The report joins external issues with the test cases linked to them and reports — per issue–case pair:

- Last execution status
- Last execution time
- Pass / fail counts

Per-issue rollups (linked cases, passed / failed / untested counts, pass rate) are surfaced alongside so the table can be grouped or summarized in the UI.

## View Modes

- **Summary (by Issue)** — one row per issue, with metrics rolled up across all linked test cases
- **Detail (by Test Case)** — one row per linked test case, showing each case's individual coverage and last execution

## Data Source

Issues come from the project's active issue integration; linked test cases come from the **Linked Issues** relation on test cases. No traditional filters are applied — coverage is deterministic per integration snapshot. For active integration management, see [Issue Integrations](../../integrations.md).
