---
title: Test Result Failure Rate Trend
sidebar_position: 11
---

# Test Result Failure Rate Trend

Answers one question: is the failure rate of your test results getting better or worse? The report shows result statuses over time, grouped by day, week, month, quarter or year, with the pass rate and fail rate for each period, and opens with a verdict on the direction of the failure rate. It can count automated results, manual results or both. The [cross-project variant](../../cross-project-reports.md) breaks the same figures down by project. For how many of your test cases are automated, see the [Automated Test Cases Trend](./automation-trends.md) report.

## What It Shows

- **Verdict** — _Failure rate is getting better_, _getting worse_ or _holding steady_, with a sentence giving the trend line's start and end values, the change in percentage points, and the number of complete periods it was fitted to. The verdict needs at least two complete periods with results.
- **Headline figures** for the last complete period — the shown rates, results executed and runs — each compared with the average of the four complete periods before it. Rate changes are in points, volume changes in percent; a rising pass rate or a falling fail rate is colored as good.
- **Fail rate by project and period** (cross-project only) — one row per project with results in the range, sorted by total results, one column per period. Each cell shows the period's fail rate and is shaded by it, reaching full intensity at 35%. Hover a cell for the passed, failed, skipped and other counts, the number of runs and the pass rate. The row ends with the project's trend change and its total results.
- **Results and rates by period** — the shown rates per period as lines on a 0–100% axis, each with its fitted trend as a dashed line, for all selected projects. With result totals shown, the passed, failed, skipped and other counts join as stacked bars on a left-hand count axis and the rates move to the right-hand axis.
- **Results table** — one row per period, newest first, with runs, results, passed, failed, skipped, other, pass rate and fail rate. In the cross-project report each period row is the total across the selected projects and expands to one row per project, named in a **Project** column. **Export CSV** writes every row, expanded.

## How Results Are Counted

- **Which runs.** The **Result types** filter picks automated runs (every run type except manual, counted with their imported results), manual runs (counted with the results recorded on them), or all runs. A manual run that has also received automated results counts under both. Deleted runs, deleted results and results of cases removed from a run are left out.
- **Periods.** A run belongs to the period it was created in. Periods are cut in your timezone preference (or your browser's); weeks start on Monday. The period containing today is in progress, is marked as such, and is left out of the trend and the headline figures. A saved or shared report keeps the timezone it was run in, so every viewer sees the same periods.
- **Statuses** come from each result's status flags, never the status name: a status marked as success is _passed_, one marked as failure is _failed_, and one that is completed without either verdict is _skipped_. Everything else is _other_ (blocked or retest, for example). An automated result with no status at all falls back to its JUnit outcome.
- **Rates.** Pass rate is passed ÷ denominator and fail rate is failed ÷ denominator. By default the denominator is every result except the skipped ones; _other_ results always stay in. A period with an empty denominator shows no rate rather than 0%.
- **Trend.** A straight line is fitted (ordinary least squares) to the fail rate over the complete periods that have results. The change is the line's value at the last of those periods minus its value at the first. A change below −1 point reads as _better_, above +1 as _worse_, otherwise _holding steady_. Each project's trend in the heatmap uses the same method, and so does the dashed pass-rate trend when the pass rate is shown; the verdict always reads the fail rate.

## Settings

- **Date Range** — the periods to show. Without one, the report covers all time: every period from the one holding the earliest counted run to the period in progress (at most the latest 400 periods). A range reaching past today stops at the period in progress.
- **Group By** — daily, weekly (the default), monthly, quarterly or annually.
- **Show pass rate** and **Show fail rate** — which rates the charts draw, each with its own fitted trend, and which appear in the headline figures. Pass rate is off and fail rate on by default, since the report is about the failure rate; turn them around to track the pass rate instead.
- **Show result totals** — off by default; on adds the passed, failed, skipped and other totals as stacked bars on a left-hand count axis beside the rates.
- **Count skipped results in rates** — off by default; on, skipped results join the denominator.
- **Include aborted runs** — on by default; off leaves out runs sitting in the project's abandoned-run state (the state the automated-run sweep moves idle runs to).
- **Latest attempt only** — off by default, so a retried or re-executed test counts once per attempt, as the run's own status rollup does; on, only the latest attempt of each case in a run is counted.

Changing the grouping, a counting setting or a filter re-runs the report; the three chart switches apply at once. Every choice is kept with the report's URL, saved reports and share links.

## Filters

Filters live in the **Filters** menu at the bottom of the report settings.

- **Result types** — Automated, Manual; nothing selected (or both) counts every run.
- **Projects** — cross-project report only; nothing selected means every project. Only projects with a counted run in the range appear in the results.
