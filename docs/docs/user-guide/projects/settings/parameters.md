---
sidebar_label: 'Test Case Parameters'
title: 'Test Case Parameters (Project Settings)'
description: Project-scoped settings for parameterized test cases — CI iteration property mapping and shared datasets
---

# Test Case Parameters

The project-level **Settings → Test Case Parameters** page is the settings hub for [parameterized test cases](../parameterized-test-cases.md). It groups two project-scoped surfaces: the **CI iteration property mapping** and the project's **shared datasets**.

:::note
Only system administrators and project administrators can open this page. For the complete feature — authoring parameters, datasets, iteration execution, reporting, and CI imports — see [Parameterized Test Cases](../parameterized-test-cases.md).
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Test Case Parameters**.

## Iteration Property Mapping

A tag-input list of the property, attribute, or trait names the CI import path looks up on each test result to find its iteration index. With an empty list, TestPlanIt recognizes `iteration` (case-insensitive). Add custom names — for example `iterationIndex` or `dataRow` — if your CI emits a different vocabulary; lookup is case-insensitive across the whole list.

See [Parameterized Test Cases → CI Imports](../parameterized-test-cases.md#ci-imports) for the per-format details.

## Shared Datasets

The CRUD list of shared datasets in this project. Columns: **Name**, **Columns**, **Rows**, **Version**, **Last edited**, **Owner**, **In use by** (count of cases assigned to the dataset, clickable to drill in), and **Actions** (**Open editor** / **Delete**). Deleting a dataset that still has case assignments is blocked by a confirmation that surfaces the assignment count.

**Open editor** launches the full-page shared dataset editor, where you author columns and rows, paste or import CSV, and manage versions. See [Parameterized Test Cases → The Standalone Shared Dataset Editor](../parameterized-test-cases.md#the-standalone-shared-dataset-editor).

## Full reference

This page mirrors the in-app settings surface. For the authoritative, end-to-end description of everything configured here, see [Parameterized Test Cases → Project Settings → Test Case Parameters](../parameterized-test-cases.md#project-settings--test-case-parameters).

## Related pages

- [Parameterized Test Cases](../parameterized-test-cases.md) — the complete feature guide.
- [Roles](../../roles.md) — the **Read Sensitive** permission that governs masked parameter values.
