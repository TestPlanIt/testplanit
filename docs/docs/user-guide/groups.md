---
sidebar_position: 8
title: Groups
---

# Groups Administration

Groups allow you to organize users, often reflecting teams, departments, or specific access roles. Assigning users to groups simplifies managing permissions and project access, although the specific permission implications depend on how groups are utilized elsewhere in the application (e.g., within project settings or roles).

To access this page, enter the Administration area and select **Groups** from the left-hand navigation menu.

## Viewing Groups

The Groups page displays a table listing all configured groups (excluding those marked as deleted). Key features include:

- **Filtering**: Use the filter input to search for groups by name.
- **Loading More**: The list loads more groups automatically as you scroll if it is long; there are no page controls.
- **Columns**: The table includes columns for:
  - **Name**: The name of the Group. Groups provisioned from your identity provider show a **SCIM** badge.
  - **Users**: A count/list of users assigned to this Group.
  - **Projects**: The projects this Group is associated with.
  - **Mapped Access**: The org-wide access tier automatically granted to members of this Group, or **No mapping** if none is set (see [Mapped access tier](#mapped-access-tier)). Per-project grants are configured in the edit dialog and are not shown in this column.
  - **Actions**: Buttons to **Edit** or **Delete** the Group.

## Adding a New Group

1. Click the **Add Group** button located above the table.
2. A modal dialog will appear.
3. Enter a unique **Name** for the new Group.
4. Click **Submit**.

## Editing an Existing Group

1. Locate the Group you wish to modify in the table.
2. Click the **Edit** icon in the **Actions** column.
3. In the dialog you can modify the **Name**, set the **Mapped Access Tier** (see [Mapped access tier](#mapped-access-tier)), grant **Per-project access** (see [Per-project access](#per-project-access)), and add or remove assigned users.
4. Click **Save**.

:::note
Per-project access rows save as soon as you add, change, or remove one — they do not wait for **Save**, because granting them updates project permissions immediately.
:::

## Mapped access tier

A group can optionally carry a **Mapped Access Tier** — **User**, **Project Admin**, or **Admin** — that is automatically granted to every member. When a user belongs to several mapped groups, the highest tier wins. Leave a group at **No mapping** to opt it out; members of no mapped group then fall back to a configurable default tier (which may be **None**, meaning no access).

This works for both identity-provider-provisioned groups and groups you create by hand. For the full picture — the fallback default, the downgrade-confirmation guard, and how manual per-user overrides interact with mapping — see [Role mapping](./scim.md#role-mapping).

If your identity provider sends a `roles` attribute on the user, you can also map role values to tiers. A role mapping **takes precedence** over the group tier above, which makes it useful as a correction to coarse group mapping — see [Map an IdP role to an access tier](./scim.md#map-an-idp-role-to-an-access-tier).

## Per-project access

The Mapped Access Tier above is org-wide. When a group should reach only certain projects — "the QA leads work on Banking, and nothing else" — use **Per-project access** in the group's edit dialog instead of granting access everywhere.

Pick a project, choose the tier the group should grant there, and click **Add project**. Repeat for each project; change a tier from the same list, or remove one with the trash icon.

Every tier currently grants the same thing: members of the group gain access to that project and carry **their own global role** onto it. The tier is recorded for intent and shows up in the audit log, but it does not currently change what is granted.

:::warning Per-project access does not make anyone a project admin
"Project Admin" in the tier list is a **system access level**, not a per-project role. Project-admin authority on a project comes from being a system Admin, being the project's creator, holding a user-specific permission that assigns a role named `Project Admin`, or holding the system Project Admin access level while assigned to the project directly. A group grant is none of those, so per-project access never confers it — members get the per-area permissions their own role carries, and nothing more.

If you need someone to administer a specific project, assign it to them in **Project Settings > Members** rather than through a group mapping.
:::

:::note Per-project access only grants
It cannot take away access a project's own default already gives, which is why there is no **None** option. To deny access on a project, set that project's default access to **No access** and grant it explicitly to the groups that should have it.
:::

Access flows through the project's normal permission rules alongside anything assigned directly in **Project Settings > Members**, and follows the same precedence — a user-specific permission beats a group one. Removing a mapping withdraws only the grant it created; a permission an admin assigned to the group by hand in project settings is left alone.

Because access follows group membership, a user added to the group picks up its per-project access with no further configuration.

## Deleting a Group

Deleting a group marks it as inactive and removes all user assignments to this group. This is a soft delete; the group record is not permanently removed from the database but will be hidden from standard views.

1. Locate the Group you wish to remove in the table.
2. Click the **Delete** icon in the **Actions** column.
3. A confirmation dialog will appear, warning that this action cannot be undone.
4. Click **Delete** (or Confirm Delete) to confirm.
