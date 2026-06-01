---
title: Iteration Matrix
sidebar_position: 6
---

# Iteration Matrix

A 2D grid view of parameterized test case execution results. Rows are test cases, columns are parameter configurations, and each cell summarizes the status counts and pass rate for that case run with that configuration.

This report is project-only — it has no cross-project variant because matrix cells don't generalize across projects.

## What It Shows

- **Rows** — parameterized test cases in the project
- **Columns** — the configurations under which those cases were executed
- **Cells** — per-cell status counts plus a pass-rate badge

See [Parameterized Test Cases](../parameterized-test-cases.md) for how parameters and configurations are authored.

## Filters

Filters apply post-generation to narrow the visible matrix:

- Folder
- Status
- Priority
- Configuration scope

## Sensitive Parameter Values

When a parameter is marked sensitive, its value visibility is gated by the **Test Run Result Restricted Fields** permission on the user's role. Viewers without that permission — including the unauthenticated audience on a public Share Link — see masked values by default. Sensitive values are best-effort, not secured; see [Parameterized Test Cases](../parameterized-test-cases.md) for the explicit security model.
