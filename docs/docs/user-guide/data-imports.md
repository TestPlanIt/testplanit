---
sidebar_label: 'Data Imports'
title: 'Data Imports'
description: Bring data from external test management tools into TestPlanIt
---

# Data Imports

The **Administration → Data Imports** page brings data from external test-management tools into TestPlanIt. You upload an export file, review what it contains, map its entities to your TestPlanIt configuration, and run the import as a background job you can monitor.

Today the page supports **Testmo JSON** exports. Imports for TestRail, Zephyr, and other tools are on the roadmap.

:::note
Only system administrators can run imports. Imports require object storage and a running background worker to be configured for your deployment.
:::

## How to access

1. Open the **Admin** area from the top navigation.
2. Select **Data Imports** under **System** in the admin menu.

## The import wizard

The Testmo importer is a four-step wizard:

1. **Upload export** — Select the JSON file you downloaded from Testmo. The file uploads directly to storage and is analyzed in the background.
2. **Review analysis** — TestPlanIt reports what the export contains (datasets, file name and size, analysis time).
3. **Configure mapping** — Map each Testmo entity (states, statuses, roles, templates, template fields, users, milestone types, groups, issue targets, configurations) to an existing TestPlanIt record, or choose to **create a new one**. You must resolve every outstanding mapping before the import can start.
4. **Monitor import** — Start the import and watch live progress: records processed, percent complete, datasets finished, throughput, and estimated time remaining.

### Saving and reusing a mapping

On the **Configure mapping** step you can **Export configuration** to download your mapping as JSON, and **Import configuration** to load a saved mapping into a later run — useful for repeating or staging migrations.

### Reviewing previous imports

Use **Review previous imports** to reload a past job for your account and pick up where it left off.

## Running and monitoring

- Imports run **asynchronously** on a background queue. You can leave the page and return, or refresh to see updated status.
- **Cancellation is cooperative** — requesting a cancel sets a flag the worker checks between batches; it does not instantly stop an in-flight job.
- Failed or canceled jobs can be **retried**, which returns the job to the configuration stage.

:::tip
When you choose **create new** for a Testmo user, the wizard generates a random password for the new account and requires a name, email, and role before the mapping counts as resolved. New users should reset their password (or sign in via SSO) after the import.
:::

## Auditing

Import activity is recorded in the [audit log](audit-logs.md): an `IMPORT_STARTED` event when the job is enqueued, paired with a bulk-create event when the worker finishes writing the imported records.

## Related pages

- [Import from Testmo](../import-testmo.md) — details on preparing a Testmo export.
- [Job Queues](queues.md) — monitor the background import worker.
