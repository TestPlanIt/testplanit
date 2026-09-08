---
sidebar_label: 'Trash'
title: 'Trash'
description: Restore or permanently remove soft-deleted records across TestPlanIt
---

# Trash

Almost everything in TestPlanIt is **soft-deleted** — when a record is deleted it is hidden and flagged, not erased. The **Administration → Trash** page is where administrators browse those soft-deleted records and either **restore** them or **permanently remove** (purge) them.

:::note
Only system administrators can open this page.
:::

## How to access

1. Open the **Admin** area from the top navigation.
2. Select **Trash** under **System** in the admin menu.

## Browsing deleted records

Trash is a **master-detail** view. A filterable rail on the left lists every record type that can hold deleted records — projects, templates, fields, workflows, statuses, milestones, configurations, users, groups, roles, tags, issues, test runs and results, sessions, repository folders and cases, steps, attachments, integrations, prompts, code repositories, and more. Each type carries a **count badge** of how many deleted records it holds, and the filter box at the top of the rail narrows the list by name. The page header shows the total across all types.

Select a type to load its deleted records in the detail pane. That table is **virtualized and loads on scroll** — there are no page buttons; the next batch of rows is fetched automatically as you approach the bottom. The **ID** and **Actions** columns stay pinned while the rest of the table scrolls, so a record's identifier and its Restore and Purge controls remain visible. Click a column header to sort.

## Restoring a record

1. Select the record's type in the sidebar, then find it in the detail table.
2. Click **Restore** and confirm.

Restoring clears the deleted flag and returns the record to normal use. Associated data may be restored alongside it.

## Purging a record

1. Select the record's type in the sidebar, then find it in the detail table.
2. Click **Purge** and confirm.

:::danger
**Purge is a permanent hard delete and cannot be undone.** Unlike normal deletion, a purged record is removed from the database entirely. Purging an attachment also deletes the underlying file from object storage.
:::

If a record can't be purged because other data still references it, TestPlanIt reports a "related data" error rather than leaving things in an inconsistent state — restore or remove the dependent records first.

## Retention

There is **no automatic cleanup**. Soft-deleted records remain in Trash indefinitely until an administrator restores or purges them. Both restore and purge actions are recorded in the [audit log](audit-logs.md).

## Related pages

- [Audit Logs](audit-logs.md) — every restore and purge is logged.
- [Cold-Storage Archive](audit-log-reliability.md) — long-term retention of audit data.
