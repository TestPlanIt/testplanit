---
slug: introducing-automation-candidates
title: "Introducing Automation Candidates: Which Manual Test Should You Automate Next?"
description: "TestPlanIt's new Automation Candidates report tells you which manual cases to automate next, with a per-case rationale grounded in real execution data — and still works without an LLM."
authors: [bdermanouelian]
tags: [release, announcement]
---

You have hundreds of manual test cases and finite bandwidth to automate them. Which ones first? Most teams answer by gut feel — or by whichever case failed last regression. But the case that runs in every regression and recovers an hour of tester time each run beats the one that bit you last sprint and won't bite again for six months. You can't see that on a list.

TestPlanIt now ships **[Automation Candidates](/docs/user-guide/projects/reports/automation-candidates)** — an AI-ranked report that tells you which manual cases to automate next, with a one-sentence rationale for every case explaining why it landed where it did. Pick a strategy, click Run.

<!-- truncate -->

## Pick the Strategy, Not the Cases

What "next to automate" means depends on what your team is optimizing for this quarter, so you pick:

- **Most Executed (highest ROI)** — _default._ The most-run cases; every future regression that touches them recovers tester time.
- **Flakiest First** — Cases whose outcomes flip the most. A deterministic oracle replaces a flaky manual judgment and stops eating time on every retry.
- **Longest to Execute** — Highest manual-execution forecast. Automating a 45-minute case recovers far more than a 5-minute one.
- **Oldest First** — Long-lived, settled cases. Safer to automate without rework.
- **Newest First** — Recently authored cases, before new coverage accumulates.
- **Random Sample** — An unbiased control to sanity-check the others.

The strategy isn't just a filter — it's the primary signal the ranker uses. Switching strategies regenerates the report and gives a genuinely different recommendation.

## The AI Reads More Than the Number

With an LLM integration configured, the report sends each eligible case's full context — name, custom field values resolved to human-readable names, step count, execution count, flakiness, manual-execution forecast, and any drilled-down metadata from issues linked in Jira, GitHub, Azure DevOps, GitLab, or Gitea/Forgejo.

The model doesn't just sort by your chosen metric — it reads each case and weighs the metric against business signals. A case tagged critical-area and linked to a high-severity issue ranks differently than one with the same execution count and no such context. Each gets a one-sentence rationale, which is what makes the report hand-to-a-planning-meeting actionable rather than a list you still have to interpret.

## Works Even Without an LLM

Plenty of teams want this report before a project-level LLM is configured. So Automation Candidates ships with a **heuristic fallback**: it ranks deterministically by the selected strategy's metric, scores each case 0–100 against the eligible-set maximum, and labels the snapshot with a **Heuristic** badge so viewers know the reasoning is metric-only. The summary points to _Admin → AI Models_ for the richer LLM reasoning when you're ready.

Heuristic rationales are localized to the generator's preferred language, matching how the LLM path responds in the prompt's language — a French QA lead sees French rationales, a Japanese tester sees Japanese.

## Shared Snapshots, Not Live Views

This report benefits from being a snapshot. When your manager opens it Monday, they should see the ranking the QA lead shared Friday — even if execution data has shifted or five candidates have since been automated.

Every generation produces a snapshot; regenerating appends a new one to the history rather than replacing it. The history dropdown labels each with its strategy — "Automation Candidates ranked by Most Executed (highest ROI) — Jun 1, 2026 5:38 PM" — so you can compare lenses and pick the one that fits the conversation.

## Where to Find It

Open any project, go to **Reports**, and pick **Automation Candidates** from the top of the report type dropdown. Set your strategy, pick how many cases to rank, and click **Run Report**. First-time generation with a thinking-capable model and 100 cases can take a couple of minutes; smaller sets and lighter models are much faster, and the heuristic fallback finishes in seconds. Full reference in the [Automation Candidates guide](/docs/user-guide/projects/reports/automation-candidates).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!
