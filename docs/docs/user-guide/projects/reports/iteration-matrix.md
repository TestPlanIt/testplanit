---
title: Iteration Matrix
sidebar_position: 6
---

# Iteration Matrix

A grid of parameterized test case results: case × configuration × parameter row. Each cell shows the worst-of status for that iteration across the filtered runs.

This report is project-only — it has no cross-project variant because matrix cells don't generalize across projects.

## What It Shows

- **Cases** — parameterized test cases in the project
- **Configurations** — the configurations under which those cases were executed
- **Parameter rows** — the dataset rows each case was iterated over
- **Cells** — the worst-of status for that case, configuration, and parameter row

See [Parameterized Test Cases](../parameterized-test-cases.md) for how parameters and configurations are authored.

## Filters

Filters narrow the matrix:

- Status
- Configuration
- Dataset
- The report's date range

## Sensitive Parameter Values

When a parameter is marked sensitive, its value visibility is gated by the **Test Run Result Restricted Fields** permission on the user's role. Viewers without that permission — including the unauthenticated audience on a public Share Link — see masked values by default. Sensitive values are best-effort, not secured; see [Parameterized Test Cases](../parameterized-test-cases.md) for the explicit security model.
