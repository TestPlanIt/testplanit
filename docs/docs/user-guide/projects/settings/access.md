---
sidebar_label: 'Access'
title: 'Access (Project Settings)'
description: See who can open a project and the role each person holds there
---

# Access

The project-level **Settings → Access** page lists every user who can open the project and the role that decides what they can do in it. It is read-only: access is granted and changed by an administrator under **Administration → Projects → Edit Project**.

:::note
Only system administrators and project administrators can open this page. System administrators see a link straight to the project's edit dialog; everyone else sees a note that only administrators can change this setting.
:::

## How to access

1. Open the project and expand **Settings** in the project menu.
2. Select **Access**.

## The access list

Each user is listed with these columns:

| Column               | Description                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **User**             | The user's name and email, linking to their profile.                                                                                      |
| **Role**             | The [role](../../permissions-guide.md) that governs the user in this project. Admins and Project Admins show their system access instead. |
| **Effective Access** | Where the access comes from: **User Permissions**, **Group Permissions**, **Project Default**, or **System Access** (see below).          |

Click a column header to sort.

### Where access comes from

A user's role in a project is resolved in this order, and the first match wins:

1. **User permission** — an access setting on the user themselves in the project's edit dialog.
2. **Group permission** — an access setting on a group the user belongs to.
3. **Project default** — the project's default access type: the user's global role, or a specific role chosen for the project.

Users whose access resolves to **No Access** are not listed. System administrators can open every project and are always listed; system project administrators are listed for the projects they are assigned to.

## Changing access

Access is changed in **Administration → Projects → Edit Project**, on the **Users** and **Groups** tabs. System administrators can use the **Edit access** link at the top of this page to open that dialog directly.
