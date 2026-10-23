---
sidebar_label: 'Risk Scoring'
title: 'Risk Scoring Settings'
description: Turn per-case risk scores on or off for a project, tune the component weights, and rescore every case on demand
---

# Risk Scoring Settings

The project-level **Settings → Risk Scoring** page controls [Risk Scores](../../risk-scores.md) for the project.

## Maintain risk scores

On by default. Cases are rescored a few seconds after their run receives results, and every project gets a full sweep nightly. Turning it off keeps existing scores but stops updating them, and removes the Risk Score filter from the repository.

## Component weights

How much each signal counts, relative to the others: failure history, flakiness, staleness, criticality and linked defects. The score normalizes by the total, so the weights do not need to add up to 100 — doubling one weight doubles that component's share. Setting a weight to zero removes the component. **Reset to defaults** returns the project to the system defaults (30 / 15 / 15 / 25 / 15) and keeps it following them if they change in a future release.

Saving a weight change rescores the whole project in the background, so the column reflects the new weights within moments rather than after the nightly sweep.

## Criticality field

Optionally pick one of the project's dropdown case fields to feed each case's own criticality — a severity or priority field your templates already carry, whatever it is called. Options count by their **order** as arranged on the admin Fields page: the top option counts 100, the bottom 10, evenly spaced. Names never matter, so renaming or translating options changes nothing. **None** (the default) leaves per-case criticality to the linked requirements alone.

## Priority weights

Issue priorities are free text and TestPlanIt ships no vocabulary of its own, so this card lists the priority names actually in use across the project's linked requirements and defects, with how many links carry each. Give the ones that matter a 0-100 weight; an unmapped name counts as neutral (50). Names are matched case-insensitively, and a mapped name that falls out of use stays listed so it can be adjusted or cleared. Saving rescores the project in the background.

## Recalculate all scores

Rescores every test case in the project now. Use it after linking a batch of requirements or defects, or whenever you want the column current without waiting for the nightly sweep. The page shows progress and reports when it finishes. One recalculation runs at a time per project.
