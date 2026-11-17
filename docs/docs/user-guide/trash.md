---
sidebar_label: 'Trash'
title: 'Trash'
description: Restore or permanently remove soft-deleted records across TestPlanIt
---

# Trash

Almost everything in TestPlanIt is **soft-deleted** — when a record is deleted it is hidden and flagged, not erased. There are two places to get deleted records back:

- **Your Trash**, in the **Trash** section of your own profile, lists the items *you* deleted and lets you restore them yourself for a limited time.
- **Administration → Trash** is where administrators browse every soft-deleted record and either **restore** it or **permanently remove** (purge) it.

## Your Trash

Open your profile (user menu → **Profile**) and expand the **Trash** section. It lists the items you deleted that are still inside the **self-service restore window** (30 days by default — see [Restore window](#self-service-restore-window)). Each row shows the item's type, its name, the folder, run or other container it belonged to, the project, when it was deleted and how long it can still be restored. Items are always shown by name; you never need to know an id.

Only these kinds of items appear: test cases, folders, shared step groups, test runs, sessions, milestones, issues, datasets and attachments. Administrative records (users, roles, templates, fields, workflows and so on) are restored from Administration → Trash only.

An item is listed only while all of the following hold:

- you deleted it yourself;
- it was deleted inside the restore window;
- it belongs to a project you can still access, and you still have add/edit permission for that kind of item there;
- whatever contains it is live. A case inside a deleted folder is not listed on its own — restore the folder and the case comes back with it.

Use the search box and the type and project filters to narrow the list. Click **Restore** on a row, or tick several rows and use **Restore selected**, then confirm. Restoring brings back everything that was deleted together with the item: a folder returns with its sub-folders and their cases, a case with its steps and attachments, a run with its run cases and results (each run case's status is recomputed from the results that come back), a session with its results, a dataset with its rows.

If the restore cannot go ahead you are told why: the item's folder or parent is still deleted, an item with the same name now exists in that place, the window has passed, or you no longer have permission in that project.

When an item's window runs out it simply stops appearing in your Trash. **Nothing is purged** — an administrator can still restore it from Administration → Trash.

Administrators see the Trash section on other users' profiles too, showing that user's restorable items.

### Self-service restore window

Administrators set the window at the top of **Administration → Trash** (**Self-service restore window**). The default is **30 days**; set it to **0** to turn self-service restore off, in which case the profile Trash explains that an administrator must restore deleted items. The window never limits Administration → Trash.

## Administration → Trash

:::note
Only system administrators can open this page.
:::

### How to access

1. Open the **Admin** area from the top navigation.
2. Select **Trash** under **System** in the admin menu.

### Browsing deleted records

Trash is a **master-detail** view. A filterable rail on the left lists every record type that can be soft-deleted — projects, templates, fields, workflows, statuses, milestones, configurations, users, groups, roles, tags, issues, test runs, run cases, iterations and results, sessions, repository folders and cases, steps, attachments, comments, review requests, notifications, share links, datasets and parameters, execution targets, import mappings, integrations, prompts, report and traceability snapshots, code repositories, impact analyses and duplicate-scan results. Every table that supports soft deletion appears here, so nothing deleted is unreachable. Each type carries a **count badge** of how many deleted records it holds, and the filter box at the top of the rail narrows the list by name. The page header shows the total across all types.

Select a type to load its deleted records in the detail pane. That table is **virtualized and loads on scroll** — there are no page buttons; the next batch of rows is fetched automatically as you approach the bottom. The **ID** and **Actions** columns stay pinned while the rest of the table scrolls, so a record's identifier and its Restore and Purge controls remain visible. Click a column header to sort.

### Restoring a record

1. Select the record's type in the sidebar, then find it in the detail table.
2. Click **Restore** and confirm.

Restoring clears the deleted flag and returns the record to normal use. Unlike a user's own Trash, this restores the single record only — children that were deleted along with it (a case's steps, a run's results) stay in the Trash under their own type until they are restored too.

### Purging a record

1. Select the record's type in the sidebar, then find it in the detail table.
2. Click **Purge** and confirm.

:::danger
**Purge is a permanent hard delete and cannot be undone.** Unlike normal deletion, a purged record is removed from the database entirely. Purging an attachment also deletes the underlying file from object storage.
:::

If a record can't be purged because other data still references it, TestPlanIt reports a "related data" error rather than leaving things in an inconsistent state — restore or remove the dependent records first.

### Retention

There is **no automatic cleanup**. Soft-deleted records remain in Trash indefinitely until an administrator restores or purges them. Both restore and purge actions are recorded in the [audit log](audit-logs.md).

## Related pages

- [Audit Logs](audit-logs.md) — every restore and purge is logged.
- [Cold-Storage Archive](audit-log-reliability.md) — long-term retention of audit data.
