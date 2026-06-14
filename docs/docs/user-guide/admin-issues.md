---
sidebar_label: 'Issues'
title: 'Issues (Administration)'
description: Manage every external issue linked into TestPlanIt from one cross-project administration table
---

# Issues

The **Administration → Issues** page is a global, cross-project table of every issue that has been linked into TestPlanIt from an external tracker — Jira, GitHub, GitLab, Azure DevOps, Gitea, Redmine, MantisBT, or a Simple URL link. Use it to review, re-sync, edit, or delete issue records that appear across your test cases, runs, and sessions.

:::note
Only system administrators can open this page. To view or manage issues for a single project, use the project's own **Issues** page instead.
:::

## How to access

1. Open the **Admin** area from the top navigation.
2. Select **Issues** under **Test Management** in the admin menu.

## Viewing issues

Issues are listed in a sortable, filterable table. Use the **Filter issues...** box to search by name, title, or description (matching is case-insensitive). The **Columns** control lets you show or hide optional columns; your choice is remembered in this browser for this table.

| Column | Description |
| --- | --- |
| **Name** | The issue key/name, with status, priority, the provider icon, the issue-type icon, and a link out to the external issue. Always shown. |
| **Title** | The issue title (plain text). Click to open a popover with the full formatted content. |
| **Description** | The issue description. Click to open a popover with the full formatted content. |
| **Status** | The synced status from the external tracker. |
| **Priority** | The synced priority (defaults to *medium*). |
| **Last Synced** | When the issue was last refreshed from the external system, or `-`. |
| **Test Cases** | Count of repository cases linked to this issue. |
| **Test Runs** | Count of linked test runs. |
| **Sessions** | Count of linked sessions. |
| **Projects** | The projects the issue appears in. |
| **Integration** | The integration the issue was linked through, or `-`. |
| **Actions** | Per-row actions (see below). Always shown. |

The Name, Title, Status, Priority, Integration, and Last Synced columns are sortable. The default sort is by name, ascending.

:::info
Issues are **not** created from this page. They appear in TestPlanIt automatically when you link an external issue to a test case, run, or session, or when an inbound webhook imports one. This administration page manages issues that already exist.
:::

## Actions

Each row exposes up to three actions:

### Sync

Pulls the latest data (status, priority, title, description) for the issue directly from its external tracker. A success toast confirms the update; the **Last Synced** timestamp advances.

The Sync action is hidden when the issue has no linked integration, no external ID, or belongs to a **Simple URL** integration — a plain link has no upstream API to pull from.

### Edit

Opens the **Edit Issue** dialog with these fields:

- **Name**
- **External Key** — for example `JIRA-123` or `#456`
- **Title**
- **Description**

Saving recalculates the external URL from the integration's base URL and the provider's link format (for example Jira `/browse/KEY`, GitHub `/issues/NUMBER`, Azure DevOps `/_workitems/edit/ID`, Redmine `/issues/ID`, MantisBT `/view.php?id=ID`).

### Delete

Opens the **Delete Issue** confirmation. Deleting is a **soft delete** — the issue is hidden from lists but retained in the database (and can be restored from [Trash](trash.md) by an administrator).

## Related pages

- [Issue Integrations](integrations.md) — connect a tracker so issues can be linked.
- [Webhooks](webhooks.md) — receive issue updates from your tracker in near-real time.
- [Audit Logs](audit-logs.md) — every sync, edit, and delete is recorded.
