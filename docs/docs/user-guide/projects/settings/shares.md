---
sidebar_label: 'Manage Shares'
title: 'Manage Shares (Project Settings)'
description: View and manage the share links scoped to a single project
---

# Manage Shares

The project-level **Settings → Manage Shares** page lists and manages every [share link](../../share-links.md) for this project. It's the project-scoped view of the same management table available to administrators across all projects under **Administration → Manage Shares**.

:::note
Only system administrators and project administrators can open this page. Share links are **created** from the **Reports** area (via the report's Share button), not from this page — here you manage links that already exist.
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Manage Shares**.

## The share list

Each share link is listed with these columns:

| Column | Description |
| --- | --- |
| **Title** | The share's name, linking to the shared view. Falls back to the entity type when untitled. |
| **Mode** | Authenticated, Password Protected, or Public. |
| **Views** | How many times the link has been opened. |
| **Notifications** | An inline On/Off toggle for view notifications. |
| **Created** | When the link was created. |
| **Expires** | The expiration date, or **Never**. Expired dates are highlighted. |
| **Status** | Active, Expired, or Revoked. |

## Actions

The three-dot menu on each row offers:

- **Copy Link** — copy the share URL to the clipboard.
- **Edit** *(active links)* — change the title, description, share mode, password, expiration, and view notifications.
- **Revoke** *(active links)* — immediately disable the link. Anyone who opens it sees an error. This cannot be undone.
- **Delete** — remove the link from the list. If it's active, it's expired immediately.

You can also toggle **view notifications** directly from the Notifications column for active links.

:::info
For the full reference on share modes, creating links, password protection, expiration, and access analytics, see [Share Links](../../share-links.md).
:::

## Related pages

- [Share Links](../../share-links.md) — complete share-link reference.
- [Reporting & Analytics](../reports/index.md) — where share links are created.
