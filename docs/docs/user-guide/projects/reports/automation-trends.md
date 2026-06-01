---
title: Automation Trends
sidebar_position: 2
---

# Automation Trends

Tracks test repository growth over time, pivoted by automation status. Use it to monitor an automation initiative's progress and to spot periods where manual-case authorship is outpacing automation.

## What It Shows

The report groups repository test cases by their creation timestamp into periods (daily, weekly, monthly, quarterly, or annually) and pivots each period by automation status:

- **Automated** count per period
- **Manual** count per period
- **Percent Automated** per period
- Period-over-period change (delta) for each metric

Cases are counted as of their creation date, so the report reflects authorship trend — not the current automation rate.

## Filters

At generation time:

- **Date Range** — limit results to a specific window
- **Period Grouping** — daily / weekly / monthly / quarterly / annually (default: weekly)
- **Custom Field Filters** — up to five dynamic filters on the project's case fields, combined with AND logic

## Dimensions and Metrics

Automation Trends is available both as a pre-built report (fixed configuration) and as a custom report in the [Report Builder](./report-builder.md). When used as a custom report, available dimensions include Automation Status, Priority, and Week Ending (plus Project when used in cross-project mode).
