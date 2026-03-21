---
slug: copy-move-test-cases
title: "Copy and Move Test Cases Between Projects"
description: "TestPlanIt v0.17.0 adds the ability to copy or move test cases — and entire folder trees — directly between projects, with no export/import cycle required."
authors: [bdermanouelian]
tags: [release, announcement]
---

TestPlanIt v0.17.0 ships **Copy/Move** — select test cases or an entire folder, pick a target project, and transfer them directly. No export file, no import wizard, no field mapping. The cases arrive in the target project with their steps, custom fields, tags, issue links, and attachments intact.

<!-- truncate -->

## How It Works

1. Select cases (checkboxes, context menu, or bulk edit) — or click the three-dot menu on a folder to move the whole tree.
2. Choose a target project and destination folder.
3. Pick **Copy** (duplicate) or **Move** (transfer).
4. Review any template or workflow compatibility warnings, then confirm.

The operation runs in the background. A notification lets you know when it finishes.

## Folder Trees

When you copy or move a folder, the entire hierarchy comes with it — subfolders, nested subfolders, and every test case inside them. Empty folders are preserved. The structure is recreated under your chosen destination folder in the target project.

## Smart Compatibility Handling

Projects don't always share the same templates or workflow states. The preflight check catches mismatches before anything is written:

- **Templates** — Admins and Project Admins can auto-assign missing templates to the target project in one click.
- **Workflow states** — States are matched by name. Unmatched states fall back to the target project's default.
- **Naming collisions** — Choose to skip or rename cases that already exist in the destination.

## What Transfers

Steps, custom field values, tags, issue links, attachments, and shared step groups all come along. Moved cases keep their full version history and comments. Copied cases start fresh at version 1.

Test run results, automated test results, and forecast data stay with the source project — they're tied to specific test runs and don't transfer.

For the full details, see the [Copy/Move documentation](/docs/copy-move-test-cases).
