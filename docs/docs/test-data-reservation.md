---
sidebar_position: 17
title: Test-Data Reservation
---

# Test-Data Reservation (Dataset Row Leases)

When several test runs execute in parallel — a CI fan-out, a load test, a nightly matrix — they often draw from the same pool of shared fixtures: a set of test accounts, sandbox records, or seeded rows that only one run may use at a time. If two jobs grab the same row, they collide on the real resource that row describes.

The **dataset row lease** API turns any [dataset](./user-guide/projects/parameterized-test-cases.md) into a reservation pool. A job **acquires** the next free row, uses the values to provision its real fixture, and **releases** it when done. Every lease carries a **TTL**, so a crashed job never pins a row forever.

The model mirrors the resource-locking primitives you already know from CI (Jenkins _Lockable Resources_, GitLab `resource_group`, GitHub Actions `concurrency`) and from distributed-lease systems (Vault, Consul, etcd, DynamoDB):

- A **DataSet** is the pool.
- A **DataSetRow** is one lockable resource.
- Acquiring returns an opaque **lease token** — a _fencing token_ the holder must present to renew or release. This lets several parallel jobs that share **one API token** each own and release only their _own_ rows.

:::note This is an explicit, opt-in API
Reservation is something your orchestrator calls directly — it is **not** wired into in-app parameterized-run playback. A parameterized test run captures its own immutable snapshot of the dataset when the run is created, so two runs never contend on the live rows. The lease API exists for the layer runs _don't_ model: the external fixture a row describes.
:::

## Authentication

All three endpoints accept either a browser session or a **Bearer [API token](./api-tokens.md)** — the token is the intended path for CI. The token's user must be a **member of the dataset's project** (i.e. able to read the dataset); otherwise the endpoint returns `404`. A read-only (`mode:read`) token is rejected with `403` because these are write operations.

```bash
export TPI_TOKEN="tpi_xxxxxxxxxxxxxxxxxxxx"
export TPI="https://testplanit.example.com"
```

## Endpoints

### Acquire the next free row

```text
POST /api/datasets/{dataSetId}/rows/acquire
```

Atomically claims the lowest-`rowIndex` row in the pool that is **free** — never leased, or whose lease has expired. Concurrent acquirers each receive a distinct row.

| Body field   | Type    | Default | Notes                                  |
| ------------ | ------- | ------- | -------------------------------------- |
| `ttlSeconds` | integer | `300`   | Lease lifetime. Clamped to `1`–`3600`. |

```bash
curl -s -X POST "$TPI/api/datasets/42/rows/acquire" \
  -H "Authorization: Bearer $TPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlSeconds": 600}'
```

A successful claim returns the row **including its values** (only the holder that authenticated for it sees the values — the webhook broadcast never does) plus the lease token and deadline:

```json
{
  "acquired": true,
  "row": {
    "id": 913,
    "rowIndex": 0,
    "label": "account-pool-0",
    "valuesJson": { "username": "svc-qa-0", "password": "•••" }
  },
  "leaseToken": "lease_5f1c…",
  "leaseExpiresAt": "2026-07-15T12:10:00.000Z"
}
```

When every row is currently leased, the pool is **exhausted** — the response is `200` so a poller can simply back off and retry:

```json
{ "acquired": false, "row": null }
```

### Release a row

```text
POST /api/datasets/{dataSetId}/rows/{rowId}/release
```

Hands the row back to the pool. You must present the `leaseToken` you received from `acquire` (or be an **admin**, who can force-release any row).

```bash
curl -s -X POST "$TPI/api/datasets/42/rows/913/release" \
  -H "Authorization: Bearer $TPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"leaseToken": "lease_5f1c…"}'
```

| Outcome                       | Status | Body                                            |
| ----------------------------- | ------ | ----------------------------------------------- |
| Released                      | `200`  | `{ "released": true, "rowId": 913 }`            |
| Already free (idempotent)     | `200`  | `{ "released": false, "reason": "not_leased" }` |
| Wrong token (not admin)       | `409`  | `{ "error": "lease_conflict" }`                 |
| Row not found in this dataset | `404`  | `{ "error": "Row not found" }`                  |

### Extend a lease

```text
POST /api/datasets/{dataSetId}/rows/{rowId}/extend
```

Pushes the deadline out for a job that needs longer. Same fencing rule as release.

```bash
curl -s -X POST "$TPI/api/datasets/42/rows/913/extend" \
  -H "Authorization: Bearer $TPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"leaseToken": "lease_5f1c…", "ttlSeconds": 600}'
```

| Outcome                  | Status | Body                                          |
| ------------------------ | ------ | --------------------------------------------- |
| Extended                 | `200`  | `{ "extended": true, "leaseExpiresAt": "…" }` |
| Lease already expired    | `409`  | `{ "error": "lease_expired" }`                |
| Wrong token (not admin)  | `409`  | `{ "error": "lease_conflict" }`               |
| Row not currently leased | `409`  | `{ "error": "not_leased" }`                   |

An **expired** lease cannot be extended — you must acquire a fresh one. This is the fencing guarantee: a paused job that wakes up after its TTL lapsed can't silently reclaim a row another job may already hold.

## How expiry works

Expiry is **lazy**: a row whose `leaseExpiresAt` is in the past is treated as free by `acquire`, so reservations keep working even if the background sweep is delayed. A dedicated **sweep worker** runs about once a minute purely to keep the table tidy and to emit the `dataset.row.released` (`reason: expired`) webhook for leases that lapsed without an explicit release. See [Background Processes](./background-processes.md) for the worker inventory.

## Webhook events

Two [outbound webhook](./user-guide/webhooks.md) events let an external system observe the pool in real time:

| Event                  | Fires when                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `dataset.row.acquired` | A row is checked out.                                                                            |
| `dataset.row.released` | A row is handed back — `reason: released` (explicit) or `reason: expired` (reaped by the sweep). |

Payloads carry **identifiers only** — `dataSetId`, `rowId`, `rowIndex`, `label`, `projectId`, `leasedById`, `leaseExpiresAt`, and (for releases) `reason`. A row's `valuesJson` is **never** broadcast, since it may hold credentials.

## A CI reservation loop

A typical job acquires a row, runs against the fixture its values describe, and releases the row in a `trap` so a failure still returns it:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1) Acquire — poll while the pool is exhausted.
while :; do
  resp=$(curl -s -X POST "$TPI/api/datasets/42/rows/acquire" \
    -H "Authorization: Bearer $TPI_TOKEN" -H "Content-Type: application/json" \
    -d '{"ttlSeconds": 900}')
  [ "$(jq -r '.acquired' <<<"$resp")" = "true" ] && break
  sleep 5
done

row_id=$(jq -r '.row.id' <<<"$resp")
token=$(jq -r '.leaseToken' <<<"$resp")

# 2) Always release, even on failure.
release() {
  curl -s -X POST "$TPI/api/datasets/42/rows/$row_id/release" \
    -H "Authorization: Bearer $TPI_TOKEN" -H "Content-Type: application/json" \
    -d "{\"leaseToken\": \"$token\"}" >/dev/null
}
trap release EXIT

# 3) Use the reserved fixture.
username=$(jq -r '.row.valuesJson.username' <<<"$resp")
run-my-tests --account "$username"
```

For jobs that may outlive their TTL, call `extend` periodically (e.g. from a heartbeat) with the same `leaseToken`.

## Notes and limits

- **Fencing token, not user identity.** Ownership is proved by the `leaseToken`, so multiple parallel jobs authenticating with the _same_ API token can each hold and release distinct rows without stepping on one another.
- **Admins can force-release.** A user with the `ADMIN` access level can release or extend any row without the token — useful for clearing a stuck lease.
- **Deleted datasets** and rows outside the target dataset return `404`.
- **TTL bounds.** Requested `ttlSeconds` is clamped to `1`–`3600`; the default is `300`.
