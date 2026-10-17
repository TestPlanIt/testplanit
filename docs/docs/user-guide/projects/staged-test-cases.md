---
title: Staged Test Cases
sidebar_position: 2 # After Add Test Case
---

# Staged Test Cases

A staged test case is one you have written in the
[Add Case](./repository-add-case.md) dialog but not created yet. Staging lets
you write several cases over one or more sittings, review them, and add them to
the repository together when they are ready.

Staged cases are private. Only the author can see, open, rename, or delete
one, and there is no administrator override. A staged case is not a test case:
it has no ID or version, and nothing in it appears in the repository, search,
reports, dashboards, test runs, exports, the API, the audit log, webhooks, or
notifications until it is created.

## Staging a test case

In the Add Case dialog, click **Stage Case** instead of **Create**. The case
is staged under its name and the dialog closes. If the case has no name yet,
you are asked for one, and it becomes the test case's name. A case can be
staged with other required fields still empty; they only block creation.
Reopening a staged case and staging it again updates the same entry.

:::note Attachments are not included
Files you have selected but not yet uploaded are not part of a staged case.
Attach them after the case is created.
:::

The automatic [recovery of unsaved changes](./case-draft-autosave.md) that
protects you from an interrupted session is separate from staging and keeps its
own 30-day retention. Staged cases are kept until you create or delete them.

## My Staged Cases

**My Staged Cases** in the repository actions lists your staged cases for the
project, with a count badge. Each entry shows its name, target folder, and when
it was last updated.

- **Open** a staged case (click it) to review or change it in the Add Case
  dialog. **Create** there creates that one case and removes it from the list.
- **Rename** (which renames the test case) or **Delete** a staged case from its menu.
- A staged case that cannot be created as it stands shows a problem count;
  hover it to see why. This happens when its folder was deleted, its template
  is no longer assigned to the project, its state no longer exists, or a
  required field is empty. Open it to fix it.

## Creating several at once

Tick the staged cases you want and click **Create selected**, or click
**Create all** to create every one that has no problems. The cases are created
in list order, each in its own target folder, exactly as the Add Case dialog
would create them: the same template, field values, tags, linked issues,
steps, and first version, and the same [review gate](../review-approvals.md)
rules for the chosen state. Entries with problems are left out.

Each created entry is removed from the list. One that could not be created
stays in the list with the reason, so you can open it, fix it, and try again.
