---
sidebar_label: 'Search Engine'
title: 'Search Engine (Elasticsearch)'
description: Monitor Elasticsearch health, tune replica counts, and rebuild search indices
---

# Search Engine

The **Administration → Search Engine** page monitors the Elasticsearch cluster that powers TestPlanIt's search, lets you tune the replica count, and rebuilds (reindexes) search indices when needed.

:::note
Only system administrators can open this page.
:::

## How to access

1. Open the **Admin** area from the top navigation.
2. Select **Search Engine** under **System** in the admin menu.

## Status

The status card shows the live connection and health of the cluster:

- **Connection** — Connected or Disconnected.
- **Cluster health** — a **Healthy**, **Warning**, or **Unhealthy** badge.
- **Nodes** — the number of nodes in the cluster.
- **Indices** — a per-index list of the `testplanit-*` indices with each index's document count, store size, and health.

Use **Refresh** to re-check the status. If Elasticsearch is not configured or not responding, the card shows a disconnected state and the reindex controls are unavailable.

## Configuration

The **Number of Replicas** setting controls index redundancy:

- **0** — for single-node clusters. This is also the fix when health shows **Warning** on a single node (replicas can't be allocated with only one node).
- **1 or more** — for multi-node clusters that need redundancy.

The value is validated to the range **0–10**. Saving persists the setting and applies it live to all existing `testplanit-*` indices.

:::info
The Configuration card is hidden in multi-tenant deployments, where Elasticsearch settings are shared across tenants and managed at the deployment level.
:::

## Reindexing

Reindexing rebuilds search indices — for example after changing index mappings or to recover from missing documents. Choose a scope and click **Start Reindex**:

- **All Entities**, or one of: Repository Cases, Test Runs, Sessions, Shared Steps, Issues, Milestones, Projects.

Progress, a live log, and a completion summary appear while the job runs.

:::warning
Reindexing **deletes and recreates** each target index before repopulating it, so search results may be incomplete while the job runs. A reindex can take several minutes depending on data volume. Run it during a maintenance window when possible.
:::

## Related pages

- [Search Configuration](../search-configuration.md) — deployment-level Elasticsearch setup.
- [Advanced Search](advanced-search.md) — how users search across TestPlanIt.
- [Job Queues](queues.md) — the reindex job runs on a background queue.
