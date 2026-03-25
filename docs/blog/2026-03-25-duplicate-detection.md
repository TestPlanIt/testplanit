---
slug: duplicate-detection
title: "Find and Resolve Duplicate Test Cases and Steps"
description: "TestPlanIt v0.18.0 adds two new detection features: find duplicate test cases across your repository, and find repeated step sequences that should be Shared Steps."
authors: [bdermanouelian]
tags: [release, announcement]
---

TestPlanIt v0.18.0 ships **Duplicate Detection** — two complementary features that help you keep your test suite lean as it grows.

<!-- truncate -->

## Why It Matters

Test suites grow fast. Engineers write new cases without realizing a similar one already exists. Imports from external tools bring their own duplicates. Over time you end up maintaining multiple versions of the same test — wasting execution time, creating inconsistent results, and making every update harder than it needs to be.

The same problem happens at the step level. Login flows, setup sequences, and common navigation paths get copied into dozens of cases instead of being extracted into reusable building blocks.

v0.18.0 tackles both.

## Find Duplicate Test Cases

Click **Find Duplicates** in your repository toolbar to scan for test cases that cover the same functionality. The scan runs in the background and surfaces candidate pairs ranked by confidence — High, Medium, or Low.

Click any pair to see a side-by-side comparison of both cases, then resolve it:

- **Merge** into a single case
- **Link as Related** if both are intentional
- **Dismiss** if it's a false positive

Bulk actions let you triage large result sets quickly. If your project has an AI model configured, a semantic pass runs automatically to catch duplicates that use different wording for the same test.

[Learn more about Duplicate Test Case Detection](/docs/user-guide/projects/duplicate-detection)

## Find Duplicate Steps

Navigate to **Shared Steps** and click **Find Duplicates** to scan for step sequences repeated across multiple test cases. The scanner finds runs of 3 or more consecutive steps that appear in two or more cases, even with minor wording differences.

Click any match to preview the steps, edit them if needed, choose which cases to include, and convert to a Shared Step Group in one click. Every affected case is updated atomically — the repeated steps are replaced with a reference to the new group, and a version snapshot is saved for each case.

[Learn more about Step Duplicate Detection](/docs/user-guide/projects/step-duplicate-detection)

## Catch Duplicates Early

You don't have to wait for a full scan. When you save a new test case, TestPlanIt checks for similar cases in the project and shows a soft warning if any are found. Your case is always saved — the warning just gives you a chance to review before the duplicate takes root.

Try it out and [let us know what you think](https://github.com/testplanit/testplanit/discussions).
