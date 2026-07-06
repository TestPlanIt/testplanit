---
title: Horizontal Read Scaling (Read Replicas)
sidebar_position: 6
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

| Variable                     | Meaning                                                                                                           | Default   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| `DATABASE_URL`               | Primary (read/write) endpoint. Receives all writes and transactions.                                              | required  |
| `DATABASE_REPLICA_URLS`      | Comma-separated replica connection strings. **Unset ⇒ feature off** (single primary).                             | _(unset)_ |
| `DATABASE_PRIMARY_STICKY_MS` | How long (ms) a browser's reads stay pinned to the primary after a mutation (read-your-own-writes). `0` disables. | `5000`    |

Example:

```bash
DATABASE_URL="postgresql://user:pass@primary:5432/testplanit?schema=public"
DATABASE_REPLICA_URLS="postgresql://user:pass@replica-1:5432/testplanit?schema=public,postgresql://user:pass@replica-2:5432/testplanit?schema=public"
DATABASE_PRIMARY_STICKY_MS=5000
```

Point replicas at **read-only** endpoints. If you run a connection pooler, give
each replica its own read-only (`-ro`) pooler endpoint, exactly as the primary
uses its read/write (`-rw`) one.

## What routes where

| Query                                                               | Routed to                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `SELECT` from a read (`GET`) API request                            | **replica** (round-robin)                                      |
| `INSERT` / `UPDATE` / `DELETE`, all transactions                    | **primary**                                                    |
| Any query in a mutating (`POST`/`PUT`/`PATCH`/`DELETE`) API request | **primary** (kept consistent)                                  |
| `SELECT ... FOR UPDATE` / `FOR SHARE` (row locks)                   | **primary**                                                    |
| Raw SQL (`$queryRaw`) reads                                         | **primary** by default; **replica** when the code path opts in |
| Reporting endpoints (heavy aggregation)                             | **replica** (opted in)                                         |

The dominant UI read traffic — everything served by the generated data-fetching
hooks (repository browsing, run/case/session listings, etc.) — flows through
read (`GET`) API requests and is offloaded automatically. Heavy reporting reads
are opted in explicitly. Additional custom read endpoints can be opted in over
time.

## Read-your-own-writes consistency

Replicas lag the primary slightly (usually milliseconds, occasionally more under
load). TestPlanIt preserves "I just saved it and I can see it" in three layers,
automatically:

1. **In-request:** once a request performs a write, the rest of that request's
   reads are pinned to the primary.
2. **Cross-request:** after a successful mutation the app sets a short-lived,
   `HttpOnly` cookie; while it is present that browser's reads are pinned to the
   primary. The window is `DATABASE_PRIMARY_STICKY_MS` (default 5s). This covers
   the common "submit form → list refetches" flow.
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

- Watch `pg_stat_activity` (or your provider's metrics) on the replicas: browse
  the repository and open listing screens, and you should see `SELECT` activity
  land on the replicas while the primary handles writes.
- Create an object and confirm it appears immediately on the next screen — the
  stickiness cookie keeps that read on the primary.
- Take a replica offline briefly and confirm the app keeps serving reads (from
  the primary) and recovers when the replica returns.

## Limitations

- TestPlanIt routes reads to replicas; it does **not** manage replication,
  promotion, or replica provisioning — that is handled by your Postgres
  platform.
- Writes are not horizontally scaled (they are commit/WAL-bound, addressed by
  faster disks / batching, not by sharding).
- Bare raw-SQL reads stay on the primary unless a code path explicitly offloads
  them.
