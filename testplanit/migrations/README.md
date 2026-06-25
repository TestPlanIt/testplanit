# Database migrations

As of the ZenStack v3 upgrade the app applies schema changes with
**`zenstack migrate deploy`** (versioned, non-destructive) instead of
`zenstack db push --accept-data-loss`. The `docker-entrypoint.sh` and the
docker-compose db-init services run `migrate deploy` on startup.

## Migrations

| Migration                                     | What it does                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `20260625193632_init`                         | Baseline — the full schema as of the last `db push` release (v2-equivalent, including the implicit `_RepositoryCasesToTags` / `_IssueToRepositoryCases` m2m join tables).                                                                                                      |
| `20260625193819_explicit_case_tag_issue_join` | Converts the implicit case↔tag / case↔issue m2m to the explicit `RepositoryCaseTag` / `RepositoryCaseIssue` join models. **Data-preserving**: creates the new tables, copies the links out of the implicit tables, then drops them (create → copy → drop, in one transaction). |

## Fresh database (new install)

Nothing special — `migrate deploy` (or the container entrypoint) applies every
migration in order and the database ends at the current schema.

## Existing database (created before migrations — IMPORTANT)

Any database built by the old `db push` flow (current production, staging, and
local DBs) has **no migration history**, so `migrate deploy` would try to run
`…_init` and fail because the tables already exist. Before the first v3 deploy,
baseline it **once** (on a DIRECT / non-pooled connection; take a backup first):

```bash
cd testplanit
# 1. Mark the baseline as already-applied — it matches the schema the DB already
#    has, so it is recorded WITHOUT being run.
npx zenstack migrate resolve --applied 20260625193632_init --schema schema.zmodel

# 2. Apply the pending migration: creates the explicit join tables, copies the
#    existing case↔tag / case↔issue links into them, then drops the implicit
#    tables. No data is lost.
npx zenstack migrate deploy --schema schema.zmodel
```

After this the database is on the migration history and every later deploy is
just `migrate deploy`.

> If a v3 container is started against an existing DB **without** step 1, the
> entrypoint's `migrate deploy` fails on `…_init` and the container won't start.
> That's safe — nothing is dropped — but you must baseline (step 1) and redeploy.

## Authoring a new migration

```bash
# edit schema.zmodel, then:
pnpm generate            # regenerate the ZenStack client (codegen only)
pnpm db:migrate          # create + apply a migration to your dev DB (prompts for a name)
```

Commit the generated `migrations/<timestamp>_<name>/` directory. `pnpm db:push`
still exists for throwaway local prototyping, but anything you change that way
must be captured as a migration before it ships, or production (which only runs
`migrate deploy`) won't get it. `pnpm db:status` shows pending migrations.
