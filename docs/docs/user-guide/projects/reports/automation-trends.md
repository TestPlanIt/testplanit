---
title: Automation Trends
sidebar_position: 2
---

# Automation Trends

Tracks test repository growth over time, pivoted by automation status. Use it to monitor an automation initiative's progress and to spot periods where manual-case authorship is outpacing automation.

## What It Shows

The report divides the timeline into periods (daily, weekly, monthly, quarterly, or annually) and, for each period, reports the automation split of the repository as it stood at the end of that period:

- **Automated** count per period
- **Manual** count per period
- **Percent Automated** per period
- Period-over-period change (delta) for each metric

Counts are cumulative — a case is included in every period from its creation onward — and each case is classified by its automation status **as of that period**, not its status today. Because this is derived from each case's version history, a case created as manual and later switched to automated is counted as manual in the periods before the switch and as automated from the switch onward. The report therefore reflects the true automation rate over time, not just authorship at creation.

## Filters

At generation time:

- **Date Range** — limit the report to a window of periods. Cases created before the window still count toward the periods shown; the range controls which periods appear, not which cases are included.
- **Period Grouping** — daily / weekly / monthly / quarterly / annually (default: weekly)
- **Custom Field Filters** — up to five dynamic filters on the project's case fields, combined with AND logic

## Dimensions and Metrics

Automation Trends is available both as a pre-built report (fixed configuration) and as a custom report in the [Report Builder](./report-builder.md). When used as a custom report, available dimensions include Automation Status, Priority, and Week Ending (plus Project when used in cross-project mode).
