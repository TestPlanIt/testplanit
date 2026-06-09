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
5. Click **Test SCIM** in the admin UI. It performs a server-side probe against `/scim/v2/ServiceProviderConfig` using the encrypted-at-rest copy of the token and reports back the HTTP status — proving the token is wired up before you save the IdP configuration.

You can revoke a token at any time from the same page. Revocation is immediate: the next request on that token receives `401 Unauthorized`.

:::warning Important
The full token is only displayed once upon creation. TestPlanIt stores only an encrypted copy and a hashed copy and cannot show the original value again.
:::

## SCIM-managed users and groups

Once a user is provisioned via SCIM, TestPlanIt treats their core identity attributes (name, email, username, external id, active flag) as IdP-owned. The Users admin page renders a **SCIM** badge on those rows, and the Edit / Force password change / Revoke password / Delete actions are disabled — the IdP is the source of truth. The same applies to SCIM-managed Groups: the name, external id, and member list flow from the IdP, and the admin Edit / Delete actions are gated.

If you need to update a SCIM-managed user or group, make the change in the IdP. The next sync (or PATCH) will pull the change into TestPlanIt.

## Endpoint reference

| Method   | Path                             | Description                                                           |
| -------- | -------------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/scim/v2/ServiceProviderConfig` | Static capability document (no bearer required)                       |
| `GET`    | `/scim/v2/Schemas`               | Lists supported schema URIs                                           |
| `GET`    | `/scim/v2/Schemas/{id}`          | Returns one schema with attribute metadata                            |
| `GET`    | `/scim/v2/ResourceTypes`         | Lists `User` and `Group` resource types                               |
| `POST`   | `/scim/v2/Users`                 | Provision a user; `201 Created` on new, `200 OK` on existing-row bind |
| `GET`    | `/scim/v2/Users`                 | List + filter users                                                   |
| `GET`    | `/scim/v2/Users/{id}`            | Read one user                                                         |
| `PUT`    | `/scim/v2/Users/{id}`            | Full replace                                                          |
| `PATCH`  | `/scim/v2/Users/{id}`            | Partial update                                                        |
| `DELETE` | `/scim/v2/Users/{id}`            | Soft-delete (tombstone)                                               |
| `POST`   | `/scim/v2/Groups`                | Provision a group                                                     |
| `GET`    | `/scim/v2/Groups`                | List + filter groups                                                  |
| `GET`    | `/scim/v2/Groups/{id}`           | Read one group                                                        |
| `PUT`    | `/scim/v2/Groups/{id}`           | Full replace                                                          |
| `PATCH`  | `/scim/v2/Groups/{id}`           | Partial update (including member operations)                          |
| `DELETE` | `/scim/v2/Groups/{id}`           | Soft-delete (tombstone)                                               |

Mutation success codes follow RFC 7644: `201 Created` for new resources, `200 OK` for updates and existing-row binds, `204 No Content` for `DELETE`.

## Filter support

`GET /scim/v2/Users?filter=…` and `GET /scim/v2/Groups?filter=…` accept a narrow SCIM filter grammar:

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

The TestPlanIt outbound webhook system lets admins subscribe destinations (Slack, generic HMAC) to ten SCIM event types. Subscriptions are stored on each webhook's `subscribedEvents` array, so the existing grouped-checkbox UI already absorbs the SCIM event names — no UI change is needed to opt in.

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

To avoid flooding webhook destinations during an IdP's first-sync push, TestPlanIt coalesces high-volume events inside a rolling five-minute window. Once a single webhook destination exceeds the threshold for `scim.user.created` or `scim.group.member_added` inside the window, subsequent events fold into one of two summary events:

| Summary event                     | Replaces                                                        |
| --------------------------------- | --------------------------------------------------------------- |
| `scim.user.created.summary`       | The remainder of `scim.user.created` events in the window       |
| `scim.group.member_added.summary` | The remainder of `scim.group.member_added` events in the window |

Summary payloads carry `count`, `firstAt`, `lastAt`, `windowStart`, and a sample of resource ids. Routine incremental syncs (a handful of provisioning calls per minute) stay 1:1 with no coalescing.

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
   - **SCIM Connector base URL:** `https://your-instance.example.com/scim/v2`
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
   - **Tenant URL:** `https://your-instance.example.com/scim/v2`
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
   - **SCIM Base URL:** `https://your-instance.example.com/scim/v2`
   - **SCIM JSON Template:** leave the default
   - **SCIM Bearer Token:** the `tps_*` value from `/admin/scim`
3. Click **Enable** next to **API Connection** and confirm the green status indicator.
4. On the **Provisioning** tab, enable **Create user**, **Delete user**, and **Update user**. Optionally enable **Require admin approval** for delete operations if your tenant policy requires it.
5. On the **Parameters** tab, map OneLogin user attributes to the SCIM schema. The defaults already match the SCIM core attributes; ensure **Email** maps to `userName` (the SCIM unique-identifier field).
6. Assign users via **Users → Applications**. OneLogin pushes them into TestPlanIt on assignment.

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
- **403 Forbidden** — your tenant policy or a network layer is blocking bearer requests to `/scim/v2/*`. Confirm there's no proxy stripping the `Authorization` header.
- **5xx** — usually a database or worker outage. The TestPlanIt error response carries an RFC 7644 envelope with the failing operation.

### Rate limiting (429)

Each SCIM bearer is capped at **50 requests per second**. When an IdP exceeds the cap, TestPlanIt responds with `429 Too Many Requests` plus a `Retry-After` header (seconds). Okta, Entra, and OneLogin all honor `Retry-After` and back off automatically.

### Audit log queries

Every SCIM mutation writes an audit row with `derivedSource = "scim"`. From `/admin/audit-logs`, filter by source = `scim` to see the full SCIM call log, including the originating token id (`metadata.scimTokenId`).

## See also

- [Authentication (SSO)](./sso.md) — SAML, OAuth, Apple, Magic Link provider configuration
- [Security Settings](./security-settings.md) — password policy, lockout, sign-in enforcement
- [Audit Logs](./audit-logs.md) — system-wide audit log with `source = scim` filter
