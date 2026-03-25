---
sidebar_position: 13
title: Step Duplicate Detection
---

# Step Duplicate Detection

TestPlanIt can scan your test cases for repeated step sequences — consecutive steps that appear in multiple cases — and convert them into reusable [Shared Steps](../shared-steps.md) in one click. This reduces duplication, simplifies maintenance, and keeps your test suite consistent.

## How Detection Works

The scanner compares all test cases in a project pairwise, looking for contiguous runs of steps that appear in more than one case. It uses fuzzy matching (Levenshtein similarity ratio of 85% or higher), so minor wording differences between otherwise identical steps are still detected.

When a matching sequence is found across multiple cases, it is grouped into a single match result. Each result shows:

- **Step count** — the number of consecutive steps in the sequence
- **Matched steps** — a preview of the step text
- **Cases count** — how many test cases contain this sequence

### Minimum Step Threshold

By default, the scanner requires at least **3 consecutive matching steps** to report a match. This avoids noise from single-step overlaps that are usually coincidental.

## Running a Scan

1. Navigate to your project and click **Shared Steps** in the left sidebar.
2. Click **Find Duplicates** in the toolbar to open the Step Duplicates page.
3. Click **Scan** to start a scan. A progress bar shows comparison progress as a percentage.
4. When the scan completes, matching results appear in the table automatically.

Only one step duplicate scan can run per project at a time. You can cancel an in-progress scan using the **X** button next to the progress bar.

:::note
Each new scan replaces the previous scan's pending results. Dismissed and converted matches are preserved across rescans.
:::

## Reviewing Results

The results page lists all matched step sequences sorted by step count. Each row shows the matched steps preview, the number of affected cases, and available actions.

You can:

- **Sort** by step count or case count
- **Filter** by case name
- **Select** multiple rows for bulk dismissal
- **Click** a row to open the conversion dialog

## Converting to Shared Steps

Click any result row to open the conversion dialog. The dialog shows:

1. **Matched Step Sequence** — a preview of the detected steps. You can edit the steps before conversion if needed.
2. **Affected Test Cases** — all test cases containing this sequence, each with a checkbox. Uncheck any cases you want to exclude from conversion.
3. **Shared Step Group Name** — auto-populated from the first step's text. Change it to something descriptive.

Click **Convert to Shared Steps** to create the shared step group. The conversion:

- Creates a new Shared Step Group with the specified name and steps
- Removes the matched steps from each selected test case
- Inserts a shared step reference in their place
- Creates a version snapshot of each modified test case

The conversion runs as a single atomic transaction — either all cases are updated or none are.

After conversion, a toast notification appears with a link to view the new shared step group.

## Dismissing Matches

If a match is a false positive — the steps look similar but serve different purposes — you can dismiss it:

- **Single dismiss**: Click a result row to open the dialog, then click **Dismiss Match**
- **Bulk dismiss**: Select multiple rows using checkboxes, then click **Dismiss**

Dismissed matches are removed from the results list and will not appear again until the next scan.

## Best Practices

- **Run scans periodically** as your test suite grows to catch new duplicates early
- **Review before converting** — not all repeated steps should be shared. Steps that happen to look similar but test different behaviors are better left independent
- **Use descriptive names** for shared step groups so they are easy to find and reuse
- **Convert selectively** — if a sequence appears in 10 cases but only 8 should be converted, uncheck the other 2 in the conversion dialog. Unchecked cases keep their original steps unchanged

## Related

- [Shared Steps](../shared-steps.md) — managing and using shared step groups
- [Duplicate Test Case Detection](./duplicate-detection.md) — finding duplicate test cases (as opposed to duplicate steps)
