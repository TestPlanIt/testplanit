---
title: Horizontal Read Scaling (Read Replicas)
sidebar_position: 7
---

# Horizontal Read Scaling with PostgreSQL Read Replicas

TestPlanIt's workload is read-heavy — repository browsing, test-run and case
listings, search, and reporting all issue far more `SELECT`s than writes. On a
single PostgreSQL primary, read CPU becomes the bottleneck well before the app
tier does. This guide explains how to spread that read traffic across one or
more PostgreSQL **read replicas** so a large deployment can serve many more
concurrent users without vertically scaling the primary.

This is an **opt-in, advanced** feature. Smaller deployments do not need it —
leave it unconfigured and TestPlanIt behaves exactly as before (a single
primary).

## Table of Contents

- [When to use this](#when-to-use-this)
- [How it works](#how-it-works)
- [Reference architecture](#reference-architecture)
- [Configuration](#configuration)
- [What routes where](#what-routes-where)
- [Read-your-own-writes](#read-your-own-writes-consistency)
- [Failover behavior](#failover-behavior)
- [Replication lag](#replication-lag)
- [Security](#security)
- [Background workers](#background-workers)
- [Verifying it works](#verifying-it-works)
- [Limitations](#limitations)

## When to use this

Reach for read replicas when:

- You run **many app replicas** and the PostgreSQL **primary** is the
  bottleneck (high read CPU / IO on the primary while the app tier still has
  headroom).
- You are targeting **thousands of concurrent users** on read-heavy screens.
- You already run, or can run, **PostgreSQL streaming replication**.

If you are hitting **connection-count** limits (not read-CPU limits), you likely
want a connection pooler first — see
[External Database Deployment](./external-database-deployment.md) for
PgBouncer / `DIRECT_DATABASE_URL`. Pooling and read replicas are complementary:
keep the pooler and add replicas.

## How it works

TestPlanIt routes queries at the ORM's database-dialect layer:

- **Writes** (`INSERT` / `UPDATE` / `DELETE`) and **transactions** always go to
  the primary (`DATABASE_URL`).
- **Reads** (`SELECT`) from read requests are spread across the configured
  replicas, round-robin.
- **Access-control (policy) evaluation** runs as part of the same query layer,
  so it works transparently across the split — reads evaluate policy on a
  replica, writes on the primary.

Because the split lives below access control and business logic, no feature
behaves differently — replicas simply absorb read load.

## Reference architecture

```text
          ┌─────────────┐
          │  Caddy / LB │
          └──────┬──────┘
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  ┌─────────┐        ┌─────────┐
  │  App 1  │  ...   │  App N  │     each app replica:
  └────┬────┘        └────┬────┘       DATABASE_URL          → primary
       │ writes           │ reads      DATABASE_REPLICA_URLS → replicas
       ▼                  ▼
   ┌────────┐   ┌──────────┐   ┌──────────┐
   │ Primary│──▶│ Replica 1│   │ Replica 2│   ← PostgreSQL streaming
   │   PG   │──▶│    PG    │   │    PG    │     replication (repeatable)
   └────────┘   └──────────┘   └──────────┘
```

Setting up PostgreSQL streaming replication itself is standard Postgres
administration and is outside TestPlanIt's scope — use your platform's managed
replicas (AWS RDS/Aurora read replicas, Google Cloud SQL / AlloyDB, Crunchy,
CloudNativePG, etc.) or self-managed `standby` servers. TestPlanIt only needs a
connection string per replica.

## Configuration

Set these environment variables on every **app** replica (and, if you route
worker reads, on the workers):

| Variable                      | Meaning                                                                                                                                           | Default   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `DATABASE_URL`                | Primary (read/write) endpoint. Receives all writes and transactions.                                                                              | required  |
| `DATABASE_REPLICA_URLS`       | Comma-separated replica connection strings. **Unset ⇒ feature off** (single primary).                                                             | _(unset)_ |
| `DATABASE_PRIMARY_STICKY_MS`  | How long (ms) a browser's reads stay pinned to the primary after a mutation (read-your-own-writes). `0` disables.                                 | `5000`    |
| `DATABASE_REPLICA_MAX_LAG_MS` | Most replication lag (ms) a replica may have and still be read from. Unset or `0` ⇒ lag is not measured. See [Replication lag](#replication-lag). | _(unset)_ |

Example:

```bash
DATABASE_URL="postgresql://user:pass@primary:5432/testplanit?schema=public"
DATABASE_REPLICA_URLS="postgresql://user:pass@replica-1:5432/testplanit?schema=public,postgresql://user:pass@replica-2:5432/testplanit?schema=public"
DATABASE_PRIMARY_STICKY_MS=5000
DATABASE_REPLICA_MAX_LAG_MS=2000
```

Point replicas at **read-only** endpoints. If you run a connection pooler, give
each replica its own read-only (`-ro`) pooler endpoint, exactly as the primary
uses its read/write (`-rw`) one.

## What routes where

| Request or query                                                          | Routed to                                                   |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `SELECT` in a `GET` or `HEAD` API request from a signed-in browser        | **replica** (round-robin)                                   |
| Reporting endpoints, including their raw SQL                              | **replica**                                                 |
| `INSERT` / `UPDATE` / `DELETE`, all transactions                          | **primary**                                                 |
| Any query in a `POST` / `PUT` / `PATCH` / `DELETE` API request            | **primary**                                                 |
| Any query in a request sent with an API token (`Authorization: Bearer …`) | **primary**                                                 |
| Any query in a request that carries the stickiness cookie                 | **primary**                                                 |
| Sign-in, single sign-on, SCIM and OAuth callback endpoints                | **primary**                                                 |
| `GET` endpoints that write, such as the notification and issue streams    | **primary**                                                 |
| `SELECT ... FOR UPDATE` / `FOR SHARE` (row locks)                         | **primary**                                                 |
| Raw SQL (`$queryRaw`) outside the reporting endpoints                     | **primary**                                                 |
| Server actions and server-rendered pages                                  | **primary**                                                 |
| Background workers                                                        | **primary** (see [Background workers](#background-workers)) |

Every API endpoint follows these rules. The read traffic of the UI (repository
browsing, run, case and session listings, search, dashboards) goes through
`GET` API requests and is offloaded automatically.

Requests sent with an API token stay on the primary because a script, a
reporter or the CLI keeps no cookies: the stickiness cookie described below
cannot protect it, and such clients routinely create a record and read it
straight back.

## Read-your-own-writes consistency

Replicas lag the primary slightly (usually milliseconds, occasionally more under
load). TestPlanIt preserves "I just saved it and I can see it" in three layers,
automatically:

1. **In-request:** once a request performs a write, the rest of that request's
   reads are pinned to the primary.
2. **Cross-request:** a request that wrote to the database sets a short-lived,
   `HttpOnly` cookie on its response; while it is present that browser's reads
   are pinned to the primary. The window is `DATABASE_PRIMARY_STICKY_MS`
   (default 5s). This covers the common "submit form → list refetches" flow.
   Every server action sets the cookie as well.
3. **Explicit:** application code can force the primary for any
   freshness-critical read.

Tune `DATABASE_PRIMARY_STICKY_MS` up if your replicas lag more than a few
seconds under peak load; set it to `0` only if you rely solely on the in-request
and explicit layers.

## Failover behavior

- If a replica **cannot be reached** (or drops mid-read), TestPlanIt logs it,
  marks that replica **unhealthy for a short cooldown**, and **falls back to the
  primary** for that read. Reads are retried on the primary transparently.
- After the cooldown the replica is tried again; if healthy it rejoins the
  rotation.
- If **all** replicas are down, every read is served by the primary — the app
  keeps working (just without the read offload).
- Loss of the **primary** is a hard failure, exactly as in a single-primary
  deployment (replicas cannot accept writes).

## Replication lag

By default a replica is read from however far behind the primary it is. Set
`DATABASE_REPLICA_MAX_LAG_MS` to stop reading from a replica that falls too far
behind:

- Each app process measures every replica's lag on a timer: twice per
  threshold, no more often than once a second and no less often than every five
  seconds.
- A replica over the threshold is skipped, and its reads go to the other
  replicas, or to the primary when none qualifies. It rejoins the rotation at
  the first measurement that finds it back under the threshold. Both changes
  are logged.
- A replica that has replayed everything it has received counts as not behind,
  so a quiet primary does not make its replicas look stale.
- If a replica does not report its lag, it stays in the rotation.

The measurement uses PostgreSQL's streaming-replication functions
(`pg_is_in_recovery`, `pg_last_wal_receive_lsn`, `pg_last_wal_replay_lsn`,
`pg_last_xact_replay_timestamp`). A managed service that replicates another way
may not report lag through them.

The threshold also bounds how stale a permission or session check can be on a
`GET` request, since those checks read from the same replicas.

## Security

- Expose replica endpoints **only** to the app/worker pods — never publicly.
- Prefer **separate, least-privilege credentials** for replicas (read-only
  roles) to reduce blast radius.
- Audit-log and all write-side paths run on the primary by design, so the audit
  trail never trails user-visible state.

## Background workers

Background workers (report generation, search reindex, imports, etc.) can also
offload their heavy reads to replicas. Because workers frequently process data
that was just written, worker reads default to the **primary** for safety;
read-heavy, lag-tolerant worker code paths opt into replicas explicitly. If you
run the shared multi-tenant worker, give each tenant its **own** replicas via
that tenant's config (`replicaUrls` in the tenant config file / `TENANT_CONFIGS`,
or `TENANT_<ID>_DATABASE_REPLICA_URLS`) — a tenant's reads are never routed to
another tenant's database.

## Verifying it works

`GET /api/health` reports routing for the app process that answers it, in a
`readReplicas` block that appears only when replicas are configured:

```json
"readReplicas": {
  "replicaReads": 18234,
  "primaryReads": {
    "unframed": 912,
    "notOptedIn": 0,
    "forcedPrimary": 2071,
    "afterWrite": 388,
    "notEligible": 64,
    "noHealthyReplica": 0
  },
  "failovers": 0,
  "writesAfterReplicaRead": 0,
  "replicas": [
    { "index": 0, "status": "ok", "lagMs": 12 },
    { "index": 1, "status": "ok", "lagMs": 9 }
  ]
}
```

| Field                           | Meaning                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `replicaReads`                  | Reads served by a replica.                                                                                           |
| `primaryReads.unframed`         | Reads from code with no routing rule: server actions, server-rendered pages, startup tasks.                          |
| `primaryReads.notOptedIn`       | Reads in a background job, in a `POST` / `PUT` / `PATCH` / `DELETE` request, or in a request sent with an API token. |
| `primaryReads.forcedPrimary`    | Reads pinned by the stickiness cookie or by a primary-only endpoint.                                                 |
| `primaryReads.afterWrite`       | Reads that followed a write in the same request.                                                                     |
| `primaryReads.notEligible`      | Locking `SELECT`s.                                                                                                   |
| `primaryReads.noHealthyReplica` | Reads that wanted a replica when every replica was down or behind.                                                   |
| `failovers`                     | Reads retried on the primary after their replica connection failed.                                                  |
| `writesAfterReplicaRead`        | Writes made by a request that had already read from a replica. Each endpoint is also logged once.                    |
| `replicas[].status`             | `ok`, `down` (in its cooldown after a connection failure) or `lagging` (over the lag threshold).                     |
| `replicas[].lagMs`              | Lag at the last measurement; `null` unless `DATABASE_REPLICA_MAX_LAG_MS` is set.                                     |

The counters start at zero when the process starts and count that process
only, so with several app replicas each one reports its own.

The application log records every change of state as a line beginning
`[readWriteDialect]`: a replica marked down, back in rotation, over the lag
threshold, or caught up.

To check the behavior by hand:

- Browse the repository and open listing screens, then confirm `replicaReads`
  rises.
- Create an object and confirm it appears immediately on the next screen. The
  stickiness cookie keeps that read on the primary, and `forcedPrimary` rises.
- Take a replica offline briefly and confirm the app keeps serving reads and
  that the replica's status returns to `ok` afterwards.

## Limitations

- TestPlanIt routes reads to replicas; it does **not** manage replication,
  promotion, or replica provisioning — that is handled by your Postgres
  platform.
- Writes are not horizontally scaled (they are commit/WAL-bound, addressed by
  faster disks / batching, not by sharding).
- Raw SQL reads stay on the primary outside the reporting endpoints.
- Server actions and server-rendered pages read from the primary.
- Reads sent with an API token stay on the primary.
