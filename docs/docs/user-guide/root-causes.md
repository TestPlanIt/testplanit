---
sidebar_position: 6
---

# Root Causes

Root Causes are the catalogue [Failure Patterns](failure-patterns.md) assigns to grouped automated failures, by AI or by hand. Each root cause has a name, a colour and a description, and the list has an order. The AI reads the descriptions to decide which root cause a failure pattern has, so a clear description is what makes a root cause usable.

## Accessing Root Causes

1. Navigate to the **Administration** area using the main navigation menu.
2. Select **Root Causes** under **Test Management**.

## Default root causes

A new installation starts with four root causes:

| Root cause | Meaning |
| --- | --- |
| **Product bug** | The application under test misbehaves. The same assertion fails consistently across runs. |
| **Test bug** | The test or its page objects are wrong or stale: a selector that no longer exists, hard-coded data, an assertion that can never pass. |
| **Environment** | Infrastructure or configuration rather than code: connection refused, DNS, missing credentials, browser or driver start-up, CI runner problems. |
| **Flaky** | Intermittent. The same cases pass and fail without a code change. |

They can be renamed, recoloured, reordered and deleted like any other root cause.

## Managing root causes

The page lists every root cause with its colour, description and how many failure patterns currently use it. Drag a row by its handle to change the order; pickers and the AI's list follow it. A new root cause lands at the end.

- **Add Root Cause** creates one. Give it a name, pick a colour, and describe the evidence that points to it; the AI uses that description from the next suggestion on.
- **Edit** changes the name, colour or description. Patterns keep the root cause.
- **Delete** removes the root cause. When patterns use it, choose where they go: **No root cause**, or another root cause, which is how two root causes are merged. Moved patterns count as set by you. The AI's earlier suggestion of the deleted root cause is no longer shown. The root cause itself can be restored from the [Trash](trash.md).

Root causes are global: every project shares the same catalogue.
