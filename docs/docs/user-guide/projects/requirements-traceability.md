---
sidebar_label: 'Coverage & Traceability'
title: 'Requirement Coverage & Traceability'
description: How requirement coverage is calculated, when links are flagged suspect, and how to run and export the traceability reports
---

# Requirement Coverage & Traceability

Once test cases are [linked to requirements](./requirements.md#linking-test-cases), every requirement rolls up the state of the cases covering it. This page explains what the coverage states mean, when a link is flagged **Suspect**, how references work, and where to run and export the traceability reports.

## Coverage

A requirement's covering cases are the test cases linked to it directly plus the cases linked to any requirement beneath it — coverage always rolls up through the subtree, so a parent is covered by its children's cases. Cases from other projects count too: the requirements list reports them separately as a **+N** count alongside the project's own, while the **Covering Test Cases** panel lists every one of them as a row naming the project it belongs to.

Each covering case contributes its single most recent execution result, across all test runs. From those results the requirement gets one coverage state:

| State | Meaning |
| --- | --- |
| **Uncovered** | No test cases are linked to this requirement or any of its descendants. |
| **Failed** | At least one covering case's latest result is a failure — one failure anywhere holds the whole requirement back. |
| **Passed** | Every covering case's latest result passed. |
| **Not run** | Everything else — covering cases that haven't been executed, are in progress, or a mix that never failed but hasn't fully passed. |

### Coverage in the list

The requirements list's **Coverage** column renders each requirement's rollup as per-status counts, with a dashed **Uncovered** badge for requirements with no covering cases. The **All coverage** filter above the list narrows the tree to **Uncovered** requirements, requirements that have untested cases, or requirements whose covering cases carry a specific result status.

### Covering Test Cases

Two surfaces drill into the covering-case set:

* The list's **Covering Test Cases** column — click a count to see the cases behind it.
* The **Covering Test Cases** panel in the requirement's detail panel — every case counted toward the requirement's coverage, with each case's **Latest Result**, **Executed At** time, and project. Clicking a latest result opens the test run it was recorded in, with that case selected.

In both, a case linked to a descendant rather than to the requirement itself carries an **Inherited** badge: *"Linked to a descendant of this requirement, not directly to it."* The drill-down is read-only — to add or remove links, use the **Linked Test Cases** panel.

## Suspect Flags

When a requirement's content changes after a linked case was last executed, that link is flagged suspect: the case may no longer test what the requirement now says. A dashed **Suspect** badge appears on the link — next to the case in the requirement's **Linked Test Cases** panel, and next to the requirement in the case's **Linked Requirements** panel — with a tooltip explaining the direction you're looking at it from (for example, *"This requirement was updated after this case's last run."*).

What arms the flag:

* A change to the requirement's **title**, **description**, or **Documentation** — whether edited in TestPlanIt or arriving through a sync from the tracker.
* Status, priority, attachment, and hierarchy changes do **not** arm it.

What clears it:

* **Re-executing the case.** A new result at or after the content change clears the flag automatically — no bookkeeping needed.
* **Dismissing it.** Click the **Suspect** badge and confirm **Dismiss flag** to record that you reviewed the change and the case is still valid: *"Dismiss this suspect flag? A newer edit to the requirement will re-flag it."* Dismissal is per link, and a newer content edit re-arms it.

## References

The **References** card at the bottom of the requirement's detail panel records the tickets that shaped a requirement — a change request, a customer report, a design discussion. Click **Add Reference** to search and attach issues: internal TestPlanIt issues or issues fetched from the connected tracker. Each reference shows its status; external references link out to the tracker, internal ones to the issue in TestPlanIt. The **Remove** action detaches a reference after confirmation.

References are annotations for traceability only — they don't affect coverage, and they work the same on synced requirements. You can also attach references while [creating a requirement](./requirements.md#creating-requirements).

## Reports

Three pre-built reports on the project's [Reports](./reports/index.md) page cover requirements. They appear in the Report Type dropdown only when the project has [requirements enabled](./requirements.md#enabling-requirements):

* **Requirement Coverage Gaps** — *"List every requirement with zero linked test cases, so gaps are visible without opening the tree."* One row per requirement with the context to triage it: its parent path, **Priority**, **Status**, and **Uncovered Since** (the requirement's creation date in the tracker where it is known, otherwise when it reached TestPlanIt). By default the report also includes a second tier — requirements that have linked cases but no execution ever — and shows **Coverage** and **Linked Cases** columns to keep the two tiers distinguishable; turn off **Include requirements whose tests have never run** to see only the zero-linked gaps.
* **Requirement Traceability** — *"Every requirement paired with its linked test cases and their latest execution result."* One row per requirement–case pair, with the requirement (and its issue-type icon), its **Parent Path** (the ancestors above it — blank for a top-level requirement), its rolled-up **Coverage** state, the case, its latest result, when it executed, and the case's project. An uncovered requirement still appears — once, with an **Uncovered** badge in place of a case — and a linked case that has never executed shows **Not run**, so gaps and untested links stay distinguishable.
* **Requirement Coverage Changes** — *"Compare a saved traceability snapshot against a later snapshot or the live matrix to see which requirements' coverage changed."* See [Comparing snapshots](#comparing-snapshots) below.

The traceability report's visualization panel summarizes the same rows per requirement: a donut of the four coverage states with the requirement total in the center, compact counts beside it, and a **Coverage by top-level requirement** breakdown — one bar per hierarchy (the ten largest; the rest are totalled in an **Other** line) whose length reflects the hierarchy's size and whose segments show its coverage mix. Each bar's label links to that requirement's details.

The gaps report has its own visualization: totals for the two tiers plus an **On Closed Requirements** count (debt on requirements whose status reads as closed/done/resolved — usually a cleanup list rather than a testing backlog), a **Debt by top-level requirement** breakdown with the same linked bars, and **Debt aging** — how long each item has been uncovered, bucketed as under 30 days, 30–90, 90–180, 180–365, and over a year.

### Generating test cases for a gap

Each gap row ends with a **Generate Test Cases** button (the sparkles icon) that opens the [AI test-case generation wizard](../llm-test-generation.md) pre-seeded with that requirement — the wizard skips its issue-picker step and generates against the requirement's title and body (a synced requirement's tracker description, or a native requirement's rich-text note), plus, for synced requirements, the tracker context the wizard already gathers: the comment thread and directly linked issues. Imported cases land in a folder named after the requirement and are **linked back to it**, so accepting the wizard's results is what closes the gap — the report re-runs automatically after the import, and the row leaves the list (or moves to the never-run tier).

The button appears for viewers who can add/edit the project's Test Case Repository, and only when the project has an active [LLM integration](../llm-integrations.md). It is never offered on a report opened through a [share link](./reports/index.md#sharing).

### Filtering traceability by coverage state

The **Coverage** control above the traceability results keeps only the rows of requirements in the selected states — filter to **Failed** for an instant "what's failing" view, or **Uncovered** to see gaps in matrix form. The filter is applied when the report runs, so the row count, the visualization, the CSV export, and any share link all describe the same filtered set.

### Scoping a report to part of the tree

Both reports cover the whole project by default. The **Scope to requirements** picker above the results limits a report to just the requirements you select and everything beneath them — pick a top-level requirement to report on one hierarchy (*"report on Enrolments only"*), or several to combine subtrees. With a scope selected, each row's path starts at the selected requirement rather than at the top of the project's tree. Leave the picker empty to report on every requirement.

The scope travels with the report's [share link](./reports/index.md#sharing), so a stakeholder's shared copy shows the same slice of the tree.

Like the other tabular reports, all three offer an **Export CSV** button above the results — see [Exporting Results](./reports/index.md#exporting-results).

:::note Shared copies and cross-project coverage
A report opened through a share link is confined to the shared project. A covering case that lives in **another** project doesn't appear in the shared copy, and a requirement covered *only* by such cases shows as a gap there even though the signed-in view shows it covered. A shared **snapshot** is the exception: it shows the record exactly as it was captured.
:::

## Snapshots

The traceability matrix is live — it changes with every execution, link, and sync. A **snapshot** is a saved, point-in-time copy of it: every requirement in scope, its covering test cases, and their latest results at the moment of capture, stamped with who captured it and when. Snapshots never change afterwards, which makes them the evidence to keep for a release sign-off, an audit, or a compliance review — *"this is what coverage looked like when we shipped 2.4."*

### Saving a snapshot

Two places save one:

* On the **Requirement Traceability** or **Requirement Coverage Gaps** report, open the **Snapshot** menu and choose **Save snapshot**.
* On the Requirements page header, open the **Snapshots** menu (the camera button) and choose **Save snapshot**.

Give the snapshot a name (*"Release 2.4 sign-off"*) and, optionally, a note about what it is evidence for. From a report, the snapshot captures whatever is currently in the **Scope to requirements** picker — leave it empty to capture the whole project. Saving requires add/edit rights on the project's **Reporting** area.

### Viewing a snapshot

The **Snapshot** menu on the Requirement Traceability and Requirement Coverage Gaps reports switches between the **Live matrix** and any saved snapshot; each entry shows when it was captured and, where there is room, its requirement and uncovered counts. With a snapshot selected, the whole report — the rows, the visualization panel, the coverage-state filter, the CSV export, and any [share link](./reports/index.md#sharing) you create — describes that snapshot rather than the live data, and the lines under the menu show who captured it, when, and its counts. Scoping still works: the picker narrows the snapshot to the selected subtrees using the hierarchy as it was at capture time.

From the Requirements page, the **Snapshots** menu lists the same snapshots — click one to open it in the Requirement Traceability report. To delete a snapshot, use the trash icon on its row in any of the snapshot menus (this requires delete rights on the project's **Reporting** area). Deleting a snapshot never affects any requirement or test case.

### Comparing snapshots

The **Requirement Coverage Changes** report answers *"what changed?"* Pick a **Baseline snapshot** and what to **Compare to** — the live matrix (the default) or a later snapshot — from their menus, then run the report. The baseline menu also offers **Save snapshot**, so you can capture the current state as a baseline without leaving the report. One row appears per requirement whose coverage differs between the two sides, classified by what changed:

| Change | Meaning |
| --- | --- |
| **Added** | The requirement exists on the comparison side only. |
| **Removed** | The requirement exists in the baseline only — deleted, declassified, or moved out of scope. |
| **Coverage changed** | Its classified coverage state moved (for example, **Uncovered** → **Not run**, or **Passed** → **Failed**). |
| **Links changed** | The same state, but the set of covering cases changed. |
| **Results changed** | The same cases, but at least one latest result or execution time moved. |

Each row shows the coverage state and linked-case count on both sides, plus how many cases were added, removed, or re-executed. Turn on **Include unchanged requirements** to list every requirement, including those that didn't change. The visualization panel summarizes the transitions — **Newly covered**, **Newly uncovered**, **Now failing**, and **No longer failing** — and the number of requirements in each change category. Sort by the **Change** column to bring the most consequential changes to the top.

