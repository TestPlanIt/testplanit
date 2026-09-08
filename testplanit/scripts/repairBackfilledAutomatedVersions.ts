#!/usr/bin/env tsx
import { readFileSync } from "node:fs";

import { createRawDbClient } from "~/lib/rawDbClient";

/**
 * repairBackfilledAutomatedVersions.ts — make the rows written by
 * `backfillAutomatedVersions.ts` differ from their predecessor in `automated`
 * ONLY.
 *
 * That backfill created each snapshot via `createTestCaseVersionInTransaction`,
 * which re-reads the case's CURRENT state. Two consequences, both wrong for a
 * snapshot that is only meant to record an automation flip:
 *
 *   1. It never writes `CaseFieldVersionValues` at all (the import paths create
 *      those separately, after calling it). All 7,241 rows therefore carry zero
 *      custom field values, so the version-history page renders every custom
 *      field as deleted at the flip.
 *   2. Steps/tags/issues came from the case as it looks NOW, not as it looked at
 *      the flip, so unrelated edits made since show up as changes introduced by
 *      the flip.
 *
 * This copies every snapshot column and all field values from the version
 * immediately below, keeping only:
 *   - `automated` = true      (the change being recorded)
 *   - `createdAt`             (the real AuditLog flip timestamp)
 *   - `version`, `repositoryCaseId`, `id`
 *   - `creatorId` / `creatorName` — the account that performed the flip. That
 *     is the author of THIS change, not of the previous version.
 *
 * Idempotent: re-running re-copies the same values.
 *
 * Usage:
 *   tsx scripts/repairBackfilledAutomatedVersions.ts             # dry run
 *   tsx scripts/repairBackfilledAutomatedVersions.ts --apply
 *   UNDO_PATH=/path/to/undo.json tsx scripts/... --apply
 */

const db = createRawDbClient();
const APPLY = process.argv.includes("--apply");
const UNDO_PATH =
  process.env.UNDO_PATH ??
  `${process.env.HOME ?? "."}/backfillAutomatedVersions.undo.json`;

// Every column that describes the snapshot's content. Deliberately excludes
// id / repositoryCaseId / version / createdAt / creatorId / creatorName /
// automated / isDeleted / deletedAt.
const SNAPSHOT_COLUMNS = [
  "staticProjectId",
  "staticProjectName",
  "projectId",
  "repositoryId",
  "folderId",
  "folderName",
  "templateId",
  "templateName",
  "name",
  "stateId",
  "stateName",
  "estimate",
  "forecastManual",
  "forecastAutomated",
  "order",
  "isArchived",
  "steps",
  "tags",
  "issues",
  "links",
  "attachments",
  "parameters",
] as const;

async function main(): Promise<void> {
  console.log(APPLY ? "Mode: APPLY" : "Mode: DRY RUN — no writes.");

  const undo: Array<{ caseId: number; versionId: number }> = JSON.parse(
    readFileSync(UNDO_PATH, "utf8")
  );
  console.log(
    `Undo trail: ${UNDO_PATH} (${undo.length.toLocaleString()} rows)`
  );

  const caseIds = undo.map((u) => u.caseId);
  const versionIds = undo.map((u) => u.versionId);

  // Pair each backfilled version with the version directly beneath it.
  await db.$executeRaw`DROP TABLE IF EXISTS _bf_pairs`;
  await db.$executeRaw`
    CREATE TEMP TABLE _bf_pairs AS
    SELECT t.case_id,
           t.ver_id,
           (SELECT rv.id
              FROM "RepositoryCaseVersions" rv
             WHERE rv."repositoryCaseId" = t.case_id
               AND rv.version < cur.version
             ORDER BY rv.version DESC
             LIMIT 1) AS prev_id
      FROM unnest(${caseIds}::int[], ${versionIds}::int[]) AS t(case_id, ver_id)
      JOIN "RepositoryCaseVersions" cur ON cur.id = t.ver_id
  `;
  await db.$executeRaw`CREATE INDEX ON _bf_pairs(ver_id)`;
  await db.$executeRaw`CREATE INDEX ON _bf_pairs(prev_id)`;
  await db.$executeRaw`ANALYZE _bf_pairs`;

  const [counts] = await db.$queryRaw<
    Array<{ total: bigint; missing_prev: bigint; needs_fields: bigint }>
  >`
    SELECT count(*)                                        AS total,
           count(*) FILTER (WHERE prev_id IS NULL)         AS missing_prev,
           count(*) FILTER (
             WHERE prev_id IS NOT NULL
               AND EXISTS (SELECT 1 FROM "CaseFieldVersionValues" f WHERE f."versionId" = prev_id)
               AND NOT EXISTS (SELECT 1 FROM "CaseFieldVersionValues" f WHERE f."versionId" = ver_id)
           )                                               AS needs_fields
      FROM _bf_pairs
  `;

  console.log("\n=== REPAIR PLAN ===");
  console.log(
    `Backfilled versions:                 ${Number(counts.total).toLocaleString()}`
  );
  console.log(
    `  no predecessor (SKIPPED):          ${Number(counts.missing_prev).toLocaleString()}`
  );
  console.log(
    `  missing field values to restore:   ${Number(counts.needs_fields).toLocaleString()}`
  );

  const sample = await db.$queryRaw<
    Array<{
      ver_id: number;
      prev_id: number;
      prev_fields: bigint;
      cur_fields: bigint;
      prev_tags: number;
      cur_tags: number;
    }>
  >`
    SELECT p.ver_id, p.prev_id,
           (SELECT count(*) FROM "CaseFieldVersionValues" f WHERE f."versionId" = p.prev_id) AS prev_fields,
           (SELECT count(*) FROM "CaseFieldVersionValues" f WHERE f."versionId" = p.ver_id)  AS cur_fields,
           jsonb_array_length(coalesce(a.tags, '[]'::jsonb)) AS prev_tags,
           jsonb_array_length(coalesce(b.tags, '[]'::jsonb)) AS cur_tags
      FROM _bf_pairs p
      JOIN "RepositoryCaseVersions" a ON a.id = p.prev_id
      JOIN "RepositoryCaseVersions" b ON b.id = p.ver_id
     WHERE p.prev_id IS NOT NULL
     LIMIT 5
  `;
  console.log("\nSample (prev → backfilled, before repair):");
  for (const s of sample) {
    console.log(
      `  v${s.prev_id} → v${s.ver_id}   fieldValues ${s.prev_fields}→${s.cur_fields}   tags ${s.prev_tags}→${s.cur_tags}`
    );
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    return;
  }

  // Set-based: one UPDATE for the snapshot columns, then rebuild field values.
  const assignments = SNAPSHOT_COLUMNS.map((c) => `"${c}" = prev."${c}"`).join(
    ", "
  );

  const updated = await db.$executeRawUnsafe(`
    UPDATE "RepositoryCaseVersions" v
       SET ${assignments}
      FROM _bf_pairs p
      JOIN "RepositoryCaseVersions" prev ON prev.id = p.prev_id
     WHERE v.id = p.ver_id
  `);
  console.log(
    `\nSnapshot columns copied from predecessor: ${Number(updated).toLocaleString()} rows`
  );

  const deleted = await db.$executeRaw`
    DELETE FROM "CaseFieldVersionValues" f
     USING _bf_pairs p
     WHERE f."versionId" = p.ver_id
  `;
  const inserted = await db.$executeRaw`
    INSERT INTO "CaseFieldVersionValues" ("versionId", field, value)
    SELECT p.ver_id, f.field, f.value
      FROM _bf_pairs p
      JOIN "CaseFieldVersionValues" f ON f."versionId" = p.prev_id
     WHERE p.prev_id IS NOT NULL
  `;
  console.log(
    `Field values: removed ${Number(deleted).toLocaleString()}, copied ${Number(inserted).toLocaleString()}`
  );

  const [verify] = await db.$queryRaw<Array<{ still_missing: bigint }>>`
    SELECT count(*) AS still_missing
      FROM _bf_pairs p
     WHERE p.prev_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM "CaseFieldVersionValues" f WHERE f."versionId" = p.prev_id)
       AND NOT EXISTS (SELECT 1 FROM "CaseFieldVersionValues" f WHERE f."versionId" = p.ver_id)
  `;
  console.log(
    `Verify — versions still missing field values: ${Number(verify.still_missing)}`
  );
  console.log("\nDone.");
}

void main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
