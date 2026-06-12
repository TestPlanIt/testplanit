---
sidebar_label: 'SCIM Provisioning'
title: SCIM 2.0 Provisioning
description: Provision and de-provision users and groups from your identity provider via SCIM 2.0
---

# SCIM 2.0 Provisioning

TestPlanIt implements [SCIM 2.0](https://www.rfc-editor.org/rfc/rfc7644) so an enterprise identity provider (IdP) can provision, update, and de-provision users and groups directly into TestPlanIt — admins manage the lifecycle from their IdP instead of TestPlanIt's user-management screen.

The SCIM admin page lives at **Admin → Authentication → SCIM Provisioning** (`/admin/scim`).

## Overview

| Capability                                                         | Status        | Notes                                                                                               |
| ------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------- |
| Users — POST / GET / PUT / PATCH / DELETE                          | Supported     | Soft-delete on DELETE; users keep their audit trail                                                 |
| Groups — POST / GET / PUT / PATCH / DELETE                         | Supported     | Soft-delete on DELETE; `members` PATCH supports both spec-form and Entra's deviating shape          |
| Discovery — `/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes` | Supported     | Open without bearer token                                                                           |
| Filter — `eq`, `and`, `pr` on whitelisted attributes               | Supported     | Other operators (`ne`, `co`, `sw`, `ew`, `gt`, etc.) return `501 Not Implemented`                   |
| PATCH operations                                                   | Supported     | `add`, `remove`, `replace` per RFC 7644 §3.5.2                                                      |
| Bulk                                                               | Not supported | Returns `501 Not Implemented`; IdPs fall back to per-resource calls                                 |
| Sort                                                               | Not supported | Results are returned in deterministic insertion order                                               |
| ChangePassword                                                     | Not supported | Local accounts use TestPlanIt's password-reset flow; SCIM-provisioned users sign in through the IdP |

All requests use `Content-Type: application/scim+json` and `Accept: application/scim+json`. Every endpoint emits an RFC 7644 §3.12 error envelope on 4xx/5xx.

## Bearer token setup

SCIM authenticates with a bearer token minted from the TestPlanIt admin UI.

1. Sign in as an admin and navigate to **Admin → Authentication → SCIM Provisioning** (`/admin/scim`).
2. Click **Mint new token**. Pick a descriptive name and the IdP this token is for (Okta / Entra / OneLogin / Other).
3. TestPlanIt shows the raw token **once**. Tokens start with the prefix `tps_` (for example, `tps_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`). Copy it immediately — it is never displayed again.
4. Paste the token into the **Secret Token** / **Bearer Token** field of your IdP's SCIM connector configuration.
5. Click **Test SCIM** in the admin UI. It performs a server-side probe against `/api/scim/v2/ServiceProviderConfig` using the encrypted-at-rest copy of the token and reports back the HTTP status — proving the token is wired up before you save the IdP configuration.

You can revoke a token at any time from the same page. Revocation is immediate: the next request on that token receives `401 Unauthorized`.

:::warning Important
The full token is only displayed once upon creation. TestPlanIt stores only an encrypted copy and a hashed copy and cannot show the original value again.
:::

## SCIM-managed users and groups

Once a user is provisioned via SCIM, TestPlanIt treats their core identity attributes (name, email, username, external id, active flag) as IdP-owned. The Users admin page renders a **SCIM** badge on those rows, and the Edit / Force password change / Revoke password / Delete actions are disabled — the IdP is the source of truth. The same applies to SCIM-managed Groups: the name, external id, and member list flow from the IdP, and the admin Edit / Delete actions are gated.

If you need to update a SCIM-managed user or group, make the change in the IdP. The next sync (or PATCH) will pull the change into TestPlanIt.

### Surfacing IdP attributes on the user profile

The [User Profile page](./user-profile.md#directory-profile) renders a **Directory Profile** section for SCIM-provisioned users that surfaces what the IdP sent on the last sync, in addition to the locked name + email at the top of the page:

- **First name** / **Last name** — `name.givenName` / `name.familyName`
- **Directory username** (`userName`) and **IdP user ID** (`externalId`)
- **Title** and **User type** from the SCIM core schema
- **Employee number**, **Department**, **Division**, **Organization**, **Cost center**, and **Manager** display name from the [Enterprise User extension](https://datatracker.ietf.org/doc/html/rfc7643#section-4.3) (URN `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`)

These fields are display-only — to change them, update the user in your IdP and let the next push (or scheduled re-sync) reconcile. Rows for unset attributes are hidden, so the section is only as full as your IdP's attribute mapping. If your IdP isn't sending the enterprise extension at all, the section renders an explanatory placeholder instead of an empty grid.

## Endpoint reference

| Method   | Path                                 | Description                                                           |
| -------- | ------------------------------------ | --------------------------------------------------------------------- |
| `GET`    | `/api/scim/v2/ServiceProviderConfig` | Static capability document (no bearer required)                       |
| `GET`    | `/api/scim/v2/Schemas`               | Lists supported schema URIs                                           |
| `GET`    | `/api/scim/v2/Schemas/{id}`          | Returns one schema with attribute metadata                            |
| `GET`    | `/api/scim/v2/ResourceTypes`         | Lists `User` and `Group` resource types                               |
| `POST`   | `/api/scim/v2/Users`                 | Provision a user; `201 Created` on new, `200 OK` on existing-row bind |
| `GET`    | `/api/scim/v2/Users`                 | List + filter users                                                   |
| `GET`    | `/api/scim/v2/Users/{id}`            | Read one user                                                         |
| `PUT`    | `/api/scim/v2/Users/{id}`            | Full replace                                                          |
| `PATCH`  | `/api/scim/v2/Users/{id}`            | Partial update                                                        |
| `DELETE` | `/api/scim/v2/Users/{id}`            | Soft-delete (tombstone)                                               |
| `POST`   | `/api/scim/v2/Groups`                | Provision a group                                                     |
| `GET`    | `/api/scim/v2/Groups`                | List + filter groups                                                  |
| `GET`    | `/api/scim/v2/Groups/{id}`           | Read one group                                                        |
| `PUT`    | `/api/scim/v2/Groups/{id}`           | Full replace                                                          |
| `PATCH`  | `/api/scim/v2/Groups/{id}`           | Partial update (including member operations)                          |
| `DELETE` | `/api/scim/v2/Groups/{id}`           | Soft-delete (tombstone)                                               |

Mutation success codes follow RFC 7644: `201 Created` for new resources, `200 OK` for updates and existing-row binds, `204 No Content` for `DELETE`.

## Filter support

`GET /api/scim/v2/Users?filter=…` and `GET /api/scim/v2/Groups?filter=…` accept a narrow SCIM filter grammar:

- **Operators:** `eq`, `and`, `pr`
- **Users — supported attributes:** `userName`, `externalId`, `emails.value`, `active`, `name.givenName`, `name.familyName`
- **Groups — supported attributes:** `displayName`, `externalId`

Examples:

```text
userName eq "alice@example.com"
externalId eq "00ub0oNGTSWTBKOLGLNR"
active eq true and emails.value eq "alice@example.com"
emails pr
displayName eq "Engineering"
```

Filters that reference an unsupported attribute or operator return `400 Bad Request` with `scimType: "invalidFilter"`.

## Webhook events

SCIM mutations emit outbound webhook events the same way as project events, but they aren't tied to any one project — they're system-level. Configure subscriptions from **Admin → Tools & Integrations → System Webhooks** (`/admin/webhooks`), which is the system-scoped sibling of the project-level webhook settings page. The form's adapter (Slack, generic HMAC) + event-subscription UI is identical to the project version; the difference is only that the destinations created here listen for system events instead of project events.

| Event name                  | Fires when                                                          |
| --------------------------- | ------------------------------------------------------------------- |
| `scim.user.created`         | A user is provisioned via SCIM (new row, JIT bind, or resurrection) |
| `scim.user.updated`         | A SCIM-provisioned user's attributes change (PUT or PATCH)          |
| `scim.user.activated`       | A user is reactivated (`active` flipped to true)                    |
| `scim.user.deactivated`     | A user is deactivated (`active` flipped to false)                   |
| `scim.user.deleted`         | A user is tombstoned via `DELETE /Users/{id}`                       |
| `scim.group.created`        | A group is provisioned via SCIM                                     |
| `scim.group.updated`        | A SCIM-provisioned group's attributes change                        |
| `scim.group.member_added`   | One or more members are added via PATCH                             |
| `scim.group.member_removed` | One or more members are removed via PATCH                           |
| `scim.group.deleted`        | A group is tombstoned via `DELETE /Groups/{id}`                     |

### Coalescing on bulk sync

When an IdP runs its first-sync push and creates hundreds or thousands of TestPlanIt users in quick succession, every one of those events would normally fire its own outbound webhook delivery. That's the right behavior for routine activity, but it's a flood your Slack channel or downstream system doesn't actually want. TestPlanIt absorbs the flood by folding the tail of each burst into a single **summary event** per webhook destination.

The rule, per (subscribed config, 5-minute rolling window):

1. The first **10** events of either `scim.user.created` or `scim.group.member_added` deliver normally — one outbound POST each — so receivers see the start of the burst at full fidelity.
2. The **11th** event in the same window stops delivering individually and instead emits a single corresponding `.summary` event for that window.
3. Every subsequent event in the same window — whether the 12th or the 12,000th — is folded silently into that same already-emitted summary. Receivers see exactly **one** summary message, not one per excess event.
4. Windows are tracked per webhook destination, so two destinations subscribed to the same event type each get their own threshold and their own summary.
5. When the 5-minute window rolls over, the counter resets and the next burst gets a fresh full-fidelity prefix.

| Summary event                     | Replaces                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| `scim.user.created.summary`       | The remainder of `scim.user.created` events in the window       |
| `scim.group.member_added.summary` | The remainder of `scim.group.member_added` events in the window |

The summary payload carries the window's roll-up so a receiver can size the burst without having received every individual event:

- `count` — total events folded under this summary (always ≥ 11)
- `firstAt` / `lastAt` — bounds of the window's activity
- `windowStart` — the bucketed 5-minute window timestamp (deterministic)
- `sampleIds` — a small sample of resource ids to aid debugging

Concurrency safety: the threshold check is serialized per destination with a Postgres advisory lock, so a real-world first-sync push of N parallel SCIM POSTs still folds correctly — every receiver sees the same 10-events-then-summary pattern regardless of how many of those POSTs raced.

Routine incremental syncs — a handful of provisioning calls per minute — never cross the threshold and stay 1:1 with no coalescing. Other SCIM event types (`scim.user.updated`, `scim.user.deactivated`, `scim.group.deleted`, etc.) are never coalesced because they don't show up in first-sync floods; only the two flood-prone event types have a summary counterpart.

### Payload shapes

Each event sends a JSON payload alongside TestPlanIt's standard webhook envelope. The per-event keys are:

- `scim.user.created` — `id`, `scimExternalId`, `userName`, `email`, `active`, `name`, `createdAt`
- `scim.user.updated` — `id`, `scimExternalId`, `userName`, `email`, `after`, `diff`
- `scim.user.activated` / `scim.user.deactivated` — `id`, `scimExternalId`, `userName`
- `scim.user.deleted` — `id`, `scimExternalId`
- `scim.group.created` — `id`, `projectId`, `externalId`, `displayName`, `members`, `createdAt`
- `scim.group.updated` — `id`, `projectId`, `externalId`, `displayName`, `after`, `diff`
- `scim.group.member_added` / `scim.group.member_removed` — `id`, `projectId`, `externalId`, `displayName`, `members`
- `scim.group.deleted` — `id`, `projectId`, `externalId`

A subscribing destination only receives the events listed in its `subscribedEvents` array — leave a checkbox unchecked to opt out.

## Okta setup

1. In the Okta Admin Console, navigate to **Applications → Browse App Catalog** and create a new SAML 2.0 + SCIM 2.0 application (or use Okta's "SCIM 2.0 Test App (Header Auth)" template for verification).
2. Under **Provisioning → Integration**, set:
   - **SCIM Connector base URL:** `https://your-instance.example.com/api/scim/v2`
   - **Unique identifier field for users:** `userName`
   - **Supported provisioning actions:** Push New Users, Push Profile Updates, Push Groups, Import New Users and Profile Updates
   - **Authentication Mode:** HTTP Header
   - **HTTP Header — Authorization:** `Bearer tps_<your token>`
3. Click **Test API Credentials**. Okta hits `/ServiceProviderConfig` and reports success.
4. On the **Provisioning → To App** tab, enable **Create Users**, **Update User Attributes**, and **Deactivate Users**.
5. Under **Attribute mappings**, the defaults work out of the box for the RFC 7643 core schema. The minimum set TestPlanIt expects:
   - `userName` ← Okta `email`
   - `givenName` ← Okta `firstName`
   - `familyName` ← Okta `lastName`
   - `emails[primary eq true].value` ← Okta `email`
   - `active` ← Okta lifecycle status
6. Assign users and groups to the application. Okta pushes them into TestPlanIt on assignment.

## Microsoft Entra (Azure AD) setup

1. In the Microsoft Entra admin center, go to **Enterprise applications → New application → Create your own application** and pick **Integrate any other application you don't find in the gallery (Non-gallery)**.
2. Open the new application's **Provisioning** blade and set **Provisioning Mode** to **Automatic**.
3. Set:
   - **Tenant URL:** `https://your-instance.example.com/api/scim/v2`
   - **Secret Token:** the `tps_*` value from `/admin/scim`
4. Click **Test Connection**. Entra calls `/Users?filter=…` and `/Groups?filter=…` against your tenant URL with the bearer.
5. Under **Settings → Provisioning Status**, switch the toggle to **On** once the test passes.
6. Enable the **`aadOptscim062020`** feature flag (Provisioning → Edit attribute mappings → Show advanced options → "Send the SCIM-spec-compliant request body to remove group members"). This is **recommended**: it makes Entra send the RFC 7644-conformant PATCH shape for membership removal. TestPlanIt's PATCH handler accepts both Entra's older non-spec shape and the spec-compliant shape, but enabling the flag keeps audit trails and conflict logs cleaner.
7. The default attribute mappings cover the SCIM core schema. Confirm:
   - `userName` ← `userPrincipalName`
   - `name.givenName` ← `givenName`
   - `name.familyName` ← `surname`
   - `emails[primary eq true].value` ← `mail`
   - `active` ← `IsSoftDeleted` (inverted)

## OneLogin setup

1. In the OneLogin admin console, go to **Applications → Add App** and search for **SCIM Provisioner with SAML (SCIM v2 Core)**. Add it to your account.
2. On the **Configuration** tab:
   - **SCIM Base URL:** `https://your-instance.example.com/api/scim/v2`
   - **SCIM JSON Template:** leave the default
   - **SCIM Bearer Token:** the `tps_*` value from `/admin/scim`
3. Click **Enable** next to **API Connection** and confirm the green status indicator.
4. On the **Provisioning** tab, enable **Create user**, **Delete user**, and **Update user**. Optionally enable **Require admin approval** for delete operations if your tenant policy requires it.
5. On the **Parameters** tab, map OneLogin user attributes to the SCIM schema. The defaults already match the SCIM core attributes; ensure **Email** maps to `userName` (the SCIM unique-identifier field).
6. Assign users via **Users → Applications**. OneLogin pushes them into TestPlanIt on assignment.

## Role mapping

TestPlanIt can automatically assign a user's global access tier — **None**, **User**, **Project Admin**, or **Admin** — based on the groups they belong to. This frees you from managing access per-user by hand: promote a user to a group in your IdP and they gain the right tier on the next sync.

Role mapping works with groups from any source. SCIM-provisioned groups (pushed from Okta, Entra, or OneLogin) and manually-created groups in TestPlanIt can both carry a **Mapped Access** tier.

### How access is resolved

Each group can optionally carry a **Mapped Access** tier. When a user belongs to multiple mapped groups, their effective access is the **highest** tier across all those groups (highest-wins). For example, if Alice is a member of "Engineering" (mapped to **User**) and "Security Reviewers" (mapped to **Admin**), Alice's effective access is **Admin**.

A user whose access is driven by group mapping is called a **governed** user. If a governed user is not currently a member of any mapped group, they fall back to the **fallback default** — a global setting you configure on `/admin/scim`. The fallback default is **None** out of the box, meaning governed users outside every mapped group have no access to TestPlanIt until they're added to a mapped group.

**Ungoverned users** (those who have never been added to a mapped group and were not provisioned via SCIM) are never auto-changed by mapping — their access stays as set by an admin.

### Configure a mapping

#### Set a group's Mapped Access

1. Navigate to **Admin → Users & Groups → Groups** (`/admin/groups`).
2. Find the group you want to map (SCIM-provisioned groups show a **SCIM** badge; manually-created groups can be mapped too).
3. Open the group's edit dialog and set **Mapped Access Tier** to the tier you want members to receive: **No mapping** (clear the mapping), **User**, **Project Admin**, or **Admin**. The **?** help icon next to the field explains each option.
4. Click **Save**.

Selecting **No mapping** removes the mapping from that group — it no longer drives any user's access. A group cannot be mapped to the **None** access tier; to grant no access, leave the group unmapped and let the fallback default apply.

#### Set the fallback default

1. Navigate to **Admin → Authentication → SCIM Provisioning** (`/admin/scim`).
2. Under the **Role Mapping** section, change the **Fallback Default** selector. Options are **None** (the system default), **User**, **Project Admin**, and **Admin**. Here **None** is the no-access tier itself — distinct from a group's **No mapping**, which means the group carries no tier at all.
3. Click **Save**. The new default takes effect for every governed user with no mapped-group membership on the next recompute.

### Downgrade confirmation

TestPlanIt will never silently lower a user's access. Before applying a mapping change or fallback-default change that would reduce one or more existing users' current tier, a confirmation dialog lists the affected users and their current → new tier. You must click **Apply anyway** to proceed.

Changes that only upgrade access — or that have no net effect on any existing user — are applied immediately without the confirmation step.

### Manual override

If you open a governed user in **Admin → Users & Groups → Users** (`/admin/users`), the edit dialog shows a **Group Mapped** badge next to the **Access** field and a warning banner titled **Managed by Group Mapping**:

> This user's access tier is governed by a SCIM group mapping and may be reverted on the next sync.

You can still change and save their access. Doing so switches the user to **manual** management — the mapping engine will no longer auto-update them. If the user is later added to a new mapped group, governance resumes automatically.

### Audit trail

Every mapping configuration change — setting a group's Mapped Access tier or changing the fallback default — is recorded in the audit log with the acting admin. Each resulting per-user access change is also logged individually.

To review mapping changes, go to **Admin → Activity → Audit Logs** (`/admin/audit-logs`) and filter by source **scim** or search for the group or user name.

### Okta: map a group to an access tier

This example uses the SCIM connector you already set up in [Okta setup](#okta-setup).

1. **Push the group from Okta.** In the Okta Admin Console, open your TestPlanIt application. On the **Push Groups** tab, add the group you want to map (for example, "Platform Admins"). Okta creates the group in TestPlanIt via `POST /api/scim/v2/Groups` and pushes its members on the first sync.

2. **Assign access in TestPlanIt.** Go to **Admin → Users & Groups → Groups** (`/admin/groups`). The "Platform Admins" group appears with a **SCIM** badge. Open its edit dialog, set **Mapped Access Tier** to **Admin**, and click **Save**.

3. **Verify.** Navigate to **Admin → Users & Groups → Users** (`/admin/users`). Any user who is a member of the Okta "Platform Admins" group — and whose effective tier (highest-wins across all their mapped groups) is now Admin — appears with **Admin** in the Access column.

4. **Add a member.** Assign a new user to the "Platform Admins" group in Okta. On the next Okta push, TestPlanIt receives a `PATCH /api/scim/v2/Groups/{id}` member-add operation, recomputes the user's effective access, and sets it to **Admin**.

5. **Remove a member.** Unassign the user from the group in Okta. TestPlanIt receives the member-remove PATCH, recomputes, and downgrades the user to their next-highest mapped tier — or to the fallback default if they are no longer a member of any mapped group.

### Entra: map a group to an access tier

This example uses the provisioning connector you already set up in [Microsoft Entra (Azure AD) setup](#microsoft-entra-azure-ad-setup).

1. **Assign the group in Entra.** In the Microsoft Entra admin center, open your TestPlanIt enterprise application and go to **Provisioning → Edit attribute mappings**. Under **Mappings**, ensure **Synchronize Azure Active Directory Groups to customappsso** is enabled. Then go to **Users and groups → Add user/group** and assign the group you want to map — for example, "Release Managers". On the next provisioning cycle, Entra pushes the group and its members to TestPlanIt via `POST /api/scim/v2/Groups`.

2. **Assign access in TestPlanIt.** Go to **Admin → Users & Groups → Groups** (`/admin/groups`). The "Release Managers" group appears with a **SCIM** badge. Open its edit dialog, set **Mapped Access Tier** to **Project Admin**, and click **Save**.

3. **Verify.** Navigate to **Admin → Users & Groups → Users** (`/admin/users`). Members of "Release Managers" now show **Project Admin** (or a higher tier if another mapped group raises it).

4. **Add a member.** Add a user to the "Release Managers" group in Entra. The provisioning service sends a `PATCH /api/scim/v2/Groups/{id}` member-add; TestPlanIt recomputes and assigns **Project Admin** (or higher).

5. **Remove a member.** Remove the user from the group in Entra. If you have the `aadOptscim062020` flag enabled (recommended in the [Entra setup steps](#microsoft-entra-azure-ad-setup)), Entra sends the RFC 7644-conformant member-remove PATCH. TestPlanIt recomputes and sets the user's access to their remaining mapped tier or to the fallback default.

## Troubleshooting

### External-ID conflict log

When TestPlanIt resolves a SCIM mutation against pre-existing data (a JIT bind, a resurrection of a tombstoned row, a member PATCH that references unknown users, or an admin rename that the IdP later overwrites), the service writes a structured audit row. The **Conflict log** section of `/admin/scim` shows the most recent conflict rows with their type, entity, timestamp, and a **View payload** modal containing the incoming SCIM JSON plus the action TestPlanIt took.

Row types you'll see:

- **scimLinked** — A SCIM `POST` matched an existing user by `userName` or `email` and bound the SCIM external id onto the existing row instead of creating a duplicate.
- **scimResurrected** — A SCIM `POST` matched a tombstoned (soft-deleted) row by `externalId` and brought it back instead of creating a duplicate.
- **scimSkippedMemberIds** — A `PATCH /Groups/{id}` referenced one or more unknown user ids; the known members were applied and the unknown ids were recorded here. The **Re-emit** action on this row replays the `member_added` / `member_removed` webhook event with the fully-resolved member list once the missing users have been provisioned.
- **scimDisplayNameOverwrote** — A SCIM update overwrote an admin's manual rename of a group. The IdP is the source of truth for identity attributes; rename in the IdP if the change should persist.

The conflict log surfaces only the last ~90 days (the same retention window as the rest of the audit log).

### "Test SCIM" probe failure modes

- **401 Unauthorized** — token is revoked, expired, or not a `tps_*` value. Re-mint or check the IdP configuration.
- **403 Forbidden** — your tenant policy or a network layer is blocking bearer requests to `/api/scim/v2/*`. Confirm there's no proxy stripping the `Authorization` header.
- **5xx** — usually a database or worker outage. The TestPlanIt error response carries an RFC 7644 envelope with the failing operation.

### Rate limiting (429)

Each SCIM bearer is capped at **50 requests per second**. When an IdP exceeds the cap, TestPlanIt responds with `429 Too Many Requests` plus a `Retry-After` header (seconds). Okta, Entra, and OneLogin all honor `Retry-After` and back off automatically.

### Audit log queries

Every SCIM mutation writes an audit row with `derivedSource = "scim"`. From `/admin/audit-logs`, filter by source = `scim` to see the full SCIM call log, including the originating token id (`metadata.scimTokenId`).

## See also

- [User Profile](./user-profile.md#directory-profile) — read-only Directory Profile section that surfaces the IdP attributes (title, department, manager, etc.) per user
- [Authentication (SSO)](./sso.md) — SAML, OAuth, Apple, Magic Link provider configuration
- [Security Settings](./security-settings.md) — password policy, lockout, sign-in enforcement
- [Audit Logs](./audit-logs.md) — system-wide audit log with `source = scim` filter
