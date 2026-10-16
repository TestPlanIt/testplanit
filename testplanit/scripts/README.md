# Scripts

Utility scripts for managing TestPlanIt.

## Queue Management

### Clear All Queues

Clears all background job queues in the system:

```bash
pnpm queues:clear
```

This will:

- Drain all waiting jobs from each queue
- Obliterate all queue data (removes completed, failed, and delayed jobs)
- Show a summary of cleared queues

**Queues cleared:**

- `forecast-updates` - Forecast recalculation jobs
- `notifications` - In-app notification jobs
- `emails` - Email delivery jobs
- `issue-sync` - Issue tracker synchronization jobs
- `testmo-imports` - Testmo import jobs
- `elasticsearch-reindex` - Elasticsearch reindex jobs

**⚠️ Warning:** This is a destructive operation. All pending and historical job data will be permanently deleted.

### Clear Testmo Import Queue

Clear only the Testmo import queue and related database records:

```bash
pnpm testmo-import:clear
```

This will:

- Clear the `testmo-imports` queue
- Delete all `TestmoImportJob` records from the database
- Delete all `TestmoImportDataset` records from the database

## Other Scripts

### Trigger Forecast Recalculation

Manually trigger a forecast recalculation for all test runs:

```bash
pnpm forecast:trigger
```

### Elasticsearch Reindexing

Reindex all entities into Elasticsearch:

```bash
# Regular reindex
pnpm elasticsearch:reindex

# Fresh reindex (delete and recreate indices)
pnpm elasticsearch:reindex:fresh

# Reindex only repository cases
pnpm elasticsearch:reindex:cases
```

### Translations (Crowdin)

Upload `messages/en-US.json` and corrected translations to Crowdin, AI-translate new strings, and download every locale:

```bash
pnpm crowdin:sync

# Show which Crowdin copy this checkout syncs with
pnpm crowdin:target
```

`main` and branches off it sync to the Crowdin project root; `release/vX.Y` and branches off it sync to the Crowdin branch `vX.Y`, which Crowdin creates on the line's first sync. Set `CROWDIN_BRANCH` to override (empty for the root). The individual steps are `crowdin:upload:translations`, `crowdin:upload:sources`, `crowdin:auto-translate` and `crowdin:download`.

## Development

All scripts are written in TypeScript and use `tsx` for execution. They automatically load environment variables from `.env` via the `dotenv` package.
