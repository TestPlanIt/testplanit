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

Trash groups deleted records by type in a set of collapsible sections — projects, templates, fields, workflows, statuses, milestones, configurations, users, groups, roles, tags, issues, test runs, results, sessions, repository folders and cases, steps, attachments, integrations, prompts, code repositories, and more.

Expand a section to see its deleted records in a table. Each section has a **search** box and column sorting to help you find a specific record.

## Restoring a record

1. Find the record in its section.
2. Click **Restore** and confirm.

Restoring clears the deleted flag and returns the record to normal use. Associated data may be restored alongside it.

## Purging a record

1. Find the record in its section.
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
