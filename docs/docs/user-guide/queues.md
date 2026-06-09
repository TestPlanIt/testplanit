---
sidebar_label: 'Job Queues'
title: 'Job Queues'
description: Monitor and manage TestPlanIt's background job queues
---

# Job Queues

The **Administration → Job Queues** page monitors and manages the background processing queues that power TestPlanIt's asynchronous work — notifications, emails, issue sync, imports, reindexing, audit logging, AI jobs, and more. You can view queue counts, pause or resume processing, clean out old jobs, and drill into individual jobs to retry, promote, or remove them.

:::note
Only system administrators can open this page.
:::

## How to access

1. Open the **Admin** area from the top navigation.
2. Select **Job Queues** under **System** in the admin menu.

## Queue overview

The overview table refreshes automatically and lists every queue with these columns:

| Column | Description |
| --- | --- |
| **Queue** | The queue's display name. |
| **Status** | Active, Idle, Paused, or Error. |
| **Concurrency** | How many jobs the worker processes in parallel. |
| **Waiting** | Jobs queued and waiting to run. |
| **Active** | Jobs currently running. |
| **Completed** | Successfully finished jobs. |
| **Failed** | Jobs that errored. |
| **Delayed** | Jobs scheduled to run later. |
| **Actions** | Pause/resume and clean (see below). |

Queues monitored include forecast updates, notifications, emails, issue sync, Testmo imports, Elasticsearch reindex, audit logs, budget alerts, AI auto-tag, repository cache, copy & move, duplicate scan, smart selection, and step-sequence scan.

:::info
**Concurrency is read-only here.** To change how many jobs a worker processes in parallel, set the relevant `*_CONCURRENCY` environment variable and restart the workers.
:::

## Queue actions

Each queue row offers:

- **Pause** — stop processing new jobs; jobs already running finish.
- **Resume** — resume processing waiting jobs.
- **Clean** — remove completed **and** failed jobs from the queue. This cannot be undone.

## Managing individual jobs

Click a queue row to open the **Queue Jobs** panel, filterable by state (Waiting, Active, Completed, Failed, Delayed). Each job lists its ID, name, state, attempts, creation time, and duration. Per-job actions:

- **View details** — inspect job data, return value, options, timestamps, and (for failures) the failure reason and stack trace.
- **Retry** — re-run a **failed** job.
- **Promote** — move a **delayed** job to the front of the queue to run now.
- **Remove** — delete a job. Removing an active or locked job prompts a **Force Remove** confirmation.

:::tip
Scheduled (repeatable) jobs are prefixed `repeat:`. Removing one first removes its schedule so it won't recur, then removes the current instance. If the instance is locked by a crashed worker, the schedule is still cleared — restart the worker to release the locked instance.
:::

## Related pages

- [Background Processes](../background-processes.md) — how workers and the scheduler run.
- [Multi-Tenant Workers](../multi-tenant-workers.md) — queue behavior in multi-tenant deployments.
