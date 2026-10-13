---
title: Auto-Save and Draft Recovery
sidebar_position: 4 # Position after Test Case Versions
---

# Auto-Save and Draft Recovery

TestPlanIt saves your work as you write a test case. If your browser closes, your
session expires, or you navigate away before clicking Save, your edits are still
there when you come back.

This applies to both places you author a test case:

- The **Add Case** dialog, when creating a new case
- **Edit mode** on the [Test Case Details](./repository-case-details.mdx) page

## How Saving Works

Your edits are kept in two places. The browser keeps a copy the moment you type,
so a crash costs you nothing. A copy is also saved to the server a few seconds
after you stop typing — and at least every 30 seconds while you keep typing — so
your work survives switching to another browser or machine.

Everything in the editor is captured: the name, steps, expected results, rich
text fields, custom fields, tags, and issues.

:::note Attachments are not included
Files you have selected but not yet uploaded are not part of a draft. Browsers do
not allow a page to re-open a file you picked before a reload. Attach files again
after restoring a draft.
:::

## Save Status

An indicator shows where your work stands:

| Indicator                     | Meaning                                                |
| ----------------------------- | ------------------------------------------------------ |
| _(nothing shown)_             | You have not changed anything yet                      |
| **Unsaved changes**           | You have typed something and the save is a moment away |
| **Saving…**                   | The save is in progress                                |
| **All changes saved 2:41 PM** | Everything is safely stored                            |
| **Unable to save — retrying** | The server could not be reached                        |

**Unable to save — retrying** does not mean your work is lost. The browser still
holds it, and TestPlanIt keeps retrying on its own. When the connection returns,
the indicator goes back to **All changes saved**.

In the Add Case dialog the indicator sits beside the Create button. In edit mode
it sits on the same row as the folder selector.

## Restoring a Draft

When you reopen a case that has unsaved work, TestPlanIt asks what to do:

- **Restore** puts your unsaved edits back into the editor
- **Discard** throws them away and loads the saved version

Restoring only fills in the editor. Nothing reaches the test case itself until
you click Save.

### Recovering After a Crash

If you were editing an existing case, you land on the read-only view rather than
the editor, which shows the last **saved** content — so it can look as though your
work is gone. A banner at the top of the page tells you a draft exists:

> You have unsaved changes to this test case from 20 minutes ago.

Choose **Resume editing** to reopen the editor with your work restored, or
**Discard them** to drop it.

### If Someone Else Saved First

If another person saved the case after your draft was written, the prompt adds a
warning. Restoring replaces their content when you next click Save. Check the
[version history](./repository-case-versions.md) first if you are not sure what
changed.

## When Drafts Are Removed

A draft is deleted when you:

- **Save** the test case — your edits become part of the case
- **Cancel** out of the editor — an explicit decision to abandon the edits
- **Discard** it at the restore prompt or the recovery banner

Closing the Add Case dialog with the **X** or the Escape key keeps the draft, so
an accidental dismissal does not cost you anything.

Drafts you never return to are removed automatically after 30 days.

## Privacy

Drafts are private to whoever wrote them. Nobody else can read your unsaved work,
including administrators, and two people editing the same test case never see
each other's drafts. Only the saved test case is shared.
