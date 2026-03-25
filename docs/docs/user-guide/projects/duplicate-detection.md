---
sidebar_position: 12
title: Duplicate Test Case Detection
---

# Duplicate Test Case Detection

TestPlanIt can automatically find test cases in your repository that appear to test the same thing. Spotting duplicates early prevents your test suite from growing with redundant cases, and keeps execution time and maintenance effort under control.

## How Detection Works

### Two-Tier Detection

Detection runs in two stages:

**Fuzzy tier (always active)**

The fuzzy tier compares test cases using three signals:

- **Name similarity** — Jaro-Winkler similarity on the case names (handles transpositions and short names well)
- **Step similarity** — Elasticsearch `more_like_this` search across case steps to find structurally similar test flows
- **Tag overlap** — Jaccard similarity between the tag sets of both cases

Scores from all three signals are combined into a single confidence score and mapped to a **High**, **Medium**, or **Low** confidence level. Pairs with a score below the minimum threshold are not surfaced.

**Semantic tier (optional, requires LLM integration)**

When a project has an LLM integration configured, the scan worker runs a second pass on pairs that pass the fuzzy gate. The language model reads both test cases holistically and determines whether they are semantically equivalent — even when step wording or structure differs. Semantic analysis can upgrade or downgrade the confidence assigned by the fuzzy tier.

When no LLM integration is configured, the scan returns fuzzy-only results and skips the semantic pass entirely.

### Confidence Levels

| Level | Meaning |
|---|---|
| **High** | Cases are very likely duplicates. Review and resolve promptly. |
| **Medium** | Cases share significant overlap. Review to confirm whether they are intentional duplicates. |
| **Low** | Cases share some similarity. Use your judgment — they may be testing related but distinct behavior. |

## Running a Scan

1. Open a project and navigate to **Repository**.
2. Click **Find Duplicates** in the repository toolbar.
3. The scan is queued as a background job. A progress indicator appears while the job runs.
4. When the scan completes, the **Find Duplicates** button updates to show the number of candidate pairs found.
5. Click the button (or navigate to the Duplicates page) to review results.

Scans are scoped to the current project. Only one scan can run per project at a time — submitting a new scan while one is already running has no effect.

## Reviewing Results

The Duplicates page lists all candidate pairs sorted by confidence (High first). Each row shows:

- Both case names and their folder locations
- The confidence level
- The last test result status for each case (if available)

Click any row to open the **comparison dialog**, which shows a side-by-side view of both test cases including steps, tags, custom fields, folder, and last test result. Use this view to decide how to resolve the pair.

## Resolving Duplicates

The comparison dialog offers three resolution options.

### Merge

Merge combines the two cases into one. You select which case is the **primary** — the other is soft-deleted. The primary case inherits:

- All version history from both cases
- All tags, issue links, and attachments from the other case (if not already present)

The primary case keeps its own steps and custom fields unchanged. The merge runs as a single atomic transaction — either everything succeeds or nothing changes.

:::note
You must explicitly select the primary case before the **Merge** button becomes active. This prevents accidental data loss.
:::

### Link as Related

If two cases are intentional duplicates — for example, the same test written for different environments or configurations — you can link them as related instead of merging. Linked cases remain independent and gain a **Related** badge showing the connection. The pair is removed from future scan results.

### Dismiss

Dismiss removes the pair from the results list and prevents it from appearing in future scans. Use this when the similarity is coincidental and the cases are testing genuinely different behavior.

## Creation-Time Warnings

When you save a new test case, TestPlanIt checks whether any existing cases in the project have a similar name. If similar cases are found, a soft warning toast appears in the bottom-right corner of the screen.

The warning is **advisory only** — your new case is always saved regardless of the result. You can click **View** in the toast to open the existing case and compare manually.

## Import Warnings

When importing test cases from a CSV file or importing automated test results, TestPlanIt checks each case name against existing cases in the project. Cases that match an existing case are flagged with a warning in the import preview table.

Import warnings are **advisory only** — they never block the import. You can review the flagged rows and decide whether to proceed.

## Configuring LLM Semantic Analysis

Semantic analysis requires an LLM integration to be configured in **Project Settings → AI Models**. When configured, the duplicate scan worker automatically runs a semantic pass on pairs that pass the fuzzy gate.

See [AI Models](../llm-integrations.md) for instructions on setting up an LLM integration.

## Limitations

- Detection is scoped to within a single project. Cross-project duplicate detection is not supported.
- Creation-time and import warnings check name similarity only — they do not run a full fuzzy + semantic scan.
- Bulk **Dismiss** and **Link as Related** are supported via the checkbox selection on the results page. Bulk merge is not supported — each merge must be resolved individually.
- Warnings appear after a case is saved or on import preview, not on every keystroke while typing a case name.
