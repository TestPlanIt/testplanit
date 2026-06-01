---
title: Automation Candidates
sidebar_position: 1
---

# Automation Candidates

AI-ranked recommendation of which manual test cases to automate next. Each candidate is scored 0–100 with a short, metric-grounded rationale explaining why it landed where it did. Once generated, every viewer of the report sees the same ranking — snapshots are shared, not per-user — until someone clicks **Regenerate**.

Only manual test cases are eligible. To keep the ranking focused on work that's actually in play, cases are excluded if they are already automated, deleted, or whose workflow state is `Not Started` — only states `In Progress` and `Done` qualify.

## Selection Strategy

Because most projects have more manual cases than fit in a single LLM call, the report sends a top slice chosen by a **Selection Strategy** you pick at generation time:

- **Most Executed (highest ROI)** — _default._ Cases that have been run the most across test runs. Automating these directly recovers the most tester time on every future run.
- **Flakiest First (pass/fail flips)** — Cases whose outcomes flip between pass and fail the most. Prime candidates for a deterministic automation oracle.
- **Longest to Execute (time saved)** — Cases with the highest manual-execution forecast (tester-derived; falls back to the original estimate if no forecast exists yet).
- **Oldest First (proven stability)** — Long-lived manual cases that have settled into mature, stable behaviors safe to automate without rework.
- **Newest First (most recently authored)** — Cases authored most recently; useful for catching new manual coverage before it accumulates.
- **Random Sample** — An unbiased random slice; useful as a control against the other strategies.

The **Cases to Rank** slider (range 5–100) controls how many cases are sent in a single generation. Higher numbers give broader coverage but the LLM takes proportionally longer — thinking-capable models can run several minutes at the top end.

## LLM-Powered Reasoning

When a project has an active LLM integration, the model receives each candidate's metadata — name, custom field values (resolved to their names, not internal IDs), step count, execution count, flakiness, forecast/estimate, and any drilled-down metadata from linked external issues — and ranks them with a per-case rationale that weighs business context alongside the metric.

The prompt is configurable via [Prompt Configurations](../../prompt-configurations.md); the available variables for the Automation Candidates feature are `{{PROJECT_NAME}}`, `{{CASE_COUNT}}`, and `{{CASES_JSON}}`. The LLM integration can be overridden per-project in **Project Settings → AI Models** (see [Per-Feature LLM Overrides](../../llm-integrations.md#per-feature-llm-overrides)).

## Heuristic Fallback

If no LLM integration is configured for the project, the report still works. The ranking is built deterministically from the selected strategy's metric, scored 0–100 relative to the maximum in the input set, and labeled with a **Heuristic** badge so viewers know the reasoning is metric-only.

The heuristic summary and per-case rationales are localized to the generator's preferred language at the time the report is run, mirroring the LLM path's natural language-pinning behavior.

## Snapshots & History

Every generation produces a snapshot that's appended to the history dropdown for the report. Use the dropdown to revisit past rankings or switch between strategies. The dropdown shows each snapshot's report title (with the strategy that produced it) and the time it was generated, formatted to your preferred date/time format.

- Snapshots are soft-deleted from history when a generation fails — the error is surfaced inline at the time, but failed runs don't clutter the dropdown.
- The **Delete** button removes a snapshot from history (soft delete). It requires the **Delete** permission on the **Reporting** application area.
- **Generate Report** and **Regenerate** require the **Add/Edit** permission on the **Reporting** application area.

## Sharing

Automation Candidates supports all three share modes (Public, Password-Protected, Authenticated). The snapshot selected at the time the share link is created is the one external viewers will see, so a regeneration after sharing doesn't silently change what your audience reads. If the captured snapshot is later deleted, the share gracefully degrades to "no snapshot" rather than erroring.

See [Share Links](../../share-links.md) for share configuration.
