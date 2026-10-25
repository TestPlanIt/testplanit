---
sidebar_label: 'Risk Scores'
title: 'Risk Scores'
description: Every test case scored 0-100 from its failure history, flakiness, staleness, requirement criticality and linked defects, with a breakdown of why — so the riskiest tests are one sort or filter away
---

# Risk Scores

Every test case carries a **risk score** from 0 to 100 that answers one question: how much does this test deserve a run right now? The score blends five signals TestPlanIt already tracks:

- **Failure history** — how often the case failed in its recent automated results, with the newest results counting most.
- **Flakiness** — how often those results flipped between pass and fail.
- **Staleness** — how long since the case was last executed, manually or automatically. A case that has never run ages from its creation date, and the signal maxes out at 90 days.
- **Criticality** — the priority of the requirements the case covers, read through the project's own [priority mapping](projects/settings/risk.md#issue-priorities), and the case's value in the project's chosen [criticality field](projects/settings/risk.md#case-criticality-field), whichever is higher. A requirement whose content changed after the case last ran adds a further boost until the case is re-executed.
- **Linked defects** — open issues linked to the case, weighted by their priority.

Scores refresh in the background: a few seconds after results arrive for a run, and in a nightly sweep that picks up slower-moving signals such as requirement edits. Scoring is deterministic and never calls an AI model.

## Where it appears

- The **repository** has a **Risk Score** column, off by default — add it from the column picker. Click the score to see **why**: each component's contribution under the project's weights, plus the facts behind them — recent failures and flips, last execution, linked requirements and defects with their top priorities, and whether the case is quarantined. Sorting by the column puts the riskiest cases first; cases without a score yet sort last.
- The repository **filter bar** gets a **Risk Score** filter when risk scoring is on: above, below, between, equal, or scored / not scored yet. Like any other filter it works in saved views and in webhook-created test run case filters.
- **Prioritize by risk**, one of the **Ways to pick test cases** in step 2 of [Add Test Run](projects/add-test-run-modal.md), lists candidates highest risk first. Set a minimum score, select what you want — or every match at once — and the cases merge with the current selection. Cases already in the run are left out.
- [Impact Analysis](impact.md) shows a **Risk Score** column beside its own Impact Score in step 4, so a change's blast radius and a case's standing risk can be weighed together.

## Re-ranking for one run

The risk score answers "what deserves a run", from a case's own history. It knows nothing about the run you are composing. When an AI model is configured for the **Risk: Re-rank for a Run** feature, **Prioritize by risk** offers **Re-rank for this run**: the model reads the run's name and description alongside the candidates and their signals, then re-orders them for that run and says why each one sits where it does.

- It re-ranks the candidates currently loaded, up to the top 100 by risk score. Anything below keeps its risk order.
- The ranking is advisory and temporary. It changes the order you are choosing from — never a stored score, which stays deterministic — and it is gone when you close the dialog, change the minimum score, or choose **Show risk order**.
- Without a model configured for the feature, the dialog says so and the risk order stands. Nothing about risk scoring requires AI.

## Weights

How much each component counts is configurable per project in [Risk Scoring settings](projects/settings/risk.md). The defaults are failure history 30, criticality 25, flakiness 15, staleness 15 and linked defects 15. Weights are relative — the score normalizes by their total — and a weight of zero removes a component entirely.

## Good to know

- **No priority vocabulary is built in.** Issue priorities are free text, so what `Sev-1` or `P2` means is yours to define in [Risk Scoring settings](projects/settings/risk.md#issue-priorities). Until a name is mapped it counts neutrally — linked requirements and defects still raise the score by their presence, just without priority nuance.
- Tracker-synced requirements score the tracker's priority; detached or native ones score the local priority. The mapping is case-insensitive.
- Only changes are written: an unchanged case costs nothing nightly, and recomputes never appear in the audit log.
