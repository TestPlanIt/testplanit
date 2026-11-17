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

Saving a weight change rescores the project in the background, so the column reflects the new weights within moments rather than after the nightly sweep. Only cases whose score or inputs actually move are rewritten.

## Case criticality field

Optionally pick one of the project's dropdown case fields to feed each case's own criticality — a severity or priority field your templates already carry, whatever it is called. Options count by their **order** as arranged on the admin Fields page: the top option counts 100, the bottom 10, evenly spaced. Names never matter, so renaming or translating options changes nothing. **None** (the default) leaves per-case criticality to the linked requirements alone.

## Issue priorities

Requirements and defects carry a priority from the tracker that owns them, and that priority is free text — `Sev-1`, `P2` and `Blocker` are all equally possible, with no order TestPlanIt can read. So this card lists the priority names actually in use across the project's linked requirements and defects, with how many links carry each, and asks what they are worth. Give the ones that matter a 0-100 weight; an unmapped name counts as neutral (50). Names are matched case-insensitively, and a mapped name that falls out of use stays listed so it can be adjusted or cleared. Saving rescores the affected cases in the background.

This is a different question from the **Case criticality field** above it: that one reads each test case's own value, while this one reads the issues the case is linked to. Both feed the Criticality component, whichever is higher.

## Recalculate all scores

Re-examines every test case in the project now. Use it after linking a batch of requirements or defects, or whenever you want the column current without waiting for the nightly sweep. Only cases whose score, inputs or configuration actually changed are written, so a recalculation with nothing to do finishes quickly. The page shows progress and reports when it finishes. One recalculation runs at a time per project.
