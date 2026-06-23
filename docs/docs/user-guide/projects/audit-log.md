---
title: Audit Log
sidebar_position: 11
---

# Project Audit Log

Every project includes an **Audit Logs** entry in the project menu. The audit log contains records of _who changed what in this project, and when._ It is the project-scoped view of the same audit trail described in the system-wide [Audit Logs](../audit-logs.md) reference.

## Who can view it

The project audit log is available to:

- **System administrators** (`ADMIN` access level) — for every project.
- **Project Administrators** (`PROJECTADMIN` access level) — for the projects they are assigned to.

The menu entry appears for any Project Administrator, but it shows entries only for the projects they are assigned to. Standard users don't see the entry; they can still review [their own activity](../audit-logs.md#viewing-your-own-activity) from their profile.

## Opening it

1. Open the project.
2. Choose **Audit Logs** from the project menu.

## What it shows

The view works like the system-wide audit log viewer, but every entry belongs to the current project:

- **Search** across entity name, user (name or email), entity type, and entity ID.
- Filter by **action**, **entity type**, **user**, and **date range**.
- Because every row shares one project, the **Project** column and **Project** filter are omitted.

For the full list of tracked actions, tracked entities, and the meaning of each detail field, see the [Audit Logs](../audit-logs.md) reference.

## Exporting

Click **Export CSV** to download the currently filtered entries for compliance reporting or external analysis. The export is itself recorded as a `DATA_EXPORTED` audit event. See [Exporting Audit Logs](../audit-logs.md#exporting-audit-logs) for the column list.
