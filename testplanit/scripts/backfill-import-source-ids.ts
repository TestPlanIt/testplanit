import { createRawDbClient } from "~/lib/rawDbClient";

/**
 * Backfill importSource + importSourceId on RepositoryCases, TestRuns, and
 * Sessions using the existing TestmoImportStaging data.
 *
 * Matches on (name, createdAt) — the import preserved createdAt verbatim from
 * the Testmo snapshot, so the combination is reliable even when many cases
 * share the same name across different projects.
 *
 * Usage:
 *   npx tsx scripts/backfill-import-source-ids.ts              # dry run
 *   npx tsx scripts/backfill-import-source-ids.ts --apply      # mutate DB
 *   npx tsx scripts/backfill-import-source-ids.ts --job <id>   # specific job
 */

const db = createRawDbClient();
const APPLY = process.argv.includes("--apply");
const IMPORT_SOURCE = "testmo";

const jobArg = process.argv.indexOf("--job");
const JOB_ID_ARG = jobArg !== -1 ? process.argv[jobArg + 1] : null;

async function getJobId(): Promise<string> {
  if (JOB_ID_ARG) return JOB_ID_ARG;
  const rows = await db.testmoImportStaging.findMany({
    distinct: ["jobId"],
    select: { jobId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  if (rows.length === 0) throw new Error("No TestmoImportStaging rows found.");
  return rows[0].jobId;
}

async function backfillEntity(
  jobId: string,
  datasetName: string,
  table: "RepositoryCases" | "TestRuns" | "Sessions"
): Promise<void> {
  // Count staging rows for reporting
  const stagingCount = await db.testmoImportStaging.count({
    where: { jobId, datasetName },
  });
  console.log(`\n[${table}] staging rows: ${stagingCount}`);

  // Count already-tagged rows (importSourceId already set)
  const alreadyTagged = await (db[
    table === "RepositoryCases"
      ? "repositoryCases"
      : table === "TestRuns"
        ? "testRuns"
        : "sessions"
  ] as any).count({
    where: { importSource: IMPORT_SOURCE },
  });
  console.log(`[${table}] already tagged: ${alreadyTagged}`);

  if (APPLY) {
    // Direct SQL UPDATE joining staging data on (name, createdAt).
    // Uses date_trunc('microseconds') so microsecond timestamps match exactly.
    const result = await db.$queryRawUnsafe<Array<{ updated: bigint }>>(
      `
      WITH matched AS (
        UPDATE "${table}" t
        SET
          "importSource"   = $1,
          "importSourceId" = (s."rowData"->>'id')
        FROM "TestmoImportStaging" s
        WHERE s."jobId"        = $2
          AND s."datasetName"  = $3
          AND t."name"         = s."rowData"->>'name'
          AND date_trunc('microseconds', t."createdAt") =
              date_trunc('microseconds',
                (s."rowData"->>'created_at')::timestamptz)
          AND t."importSource" IS NULL
        RETURNING t.id
      )
      SELECT COUNT(*) AS updated FROM matched
      `,
      IMPORT_SOURCE,
      jobId,
      datasetName
    );
    const updated = Number(result[0]?.updated ?? 0);
    console.log(`[${table}] tagged: ${updated}`);

    // Report unmatched staging rows (staging has a case the DB didn't match)
    const unmatched = await db.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `
      SELECT s."rowData"->>'id' AS id, s."rowData"->>'name' AS name
      FROM "TestmoImportStaging" s
      WHERE s."jobId"       = $1
        AND s."datasetName" = $2
        AND NOT EXISTS (
          SELECT 1 FROM "${table}" t
          WHERE t."importSourceId" = (s."rowData"->>'id')
            AND t."importSource"   = $3
        )
      ORDER BY (s."rowData"->>'id')::int
      LIMIT 20
      `,
      jobId,
      datasetName,
      IMPORT_SOURCE
    );
    if (unmatched.length > 0) {
      console.warn(
        `[${table}] WARNING: ${unmatched.length}+ staging rows could not be matched (showing up to 20):`
      );
      unmatched.forEach((r) => console.warn(`  id=${r.id} name="${r.name}"`));
    } else {
      console.log(`[${table}] all staging rows matched successfully`);
    }
  } else {
    // Dry run — count how many would be updated
    const preview = await db.$queryRawUnsafe<Array<{ would_update: bigint }>>(
      `
      SELECT COUNT(*) AS would_update
      FROM "${table}" t
      JOIN "TestmoImportStaging" s
        ON s."jobId"       = $1
       AND s."datasetName" = $2
       AND t."name"        = s."rowData"->>'name'
       AND date_trunc('microseconds', t."createdAt") =
           date_trunc('microseconds',
             (s."rowData"->>'created_at')::timestamptz)
       AND t."importSource" IS NULL
      `,
      jobId,
      datasetName
    );
    const count = Number(preview[0]?.would_update ?? 0);
    console.log(`[${table}] DRY RUN — would tag: ${count} (pass --apply to commit)`);
  }
}

async function main() {
  const jobId = await getJobId();
  console.log(`Using jobId: ${jobId}`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  await backfillEntity(jobId, "repository_cases", "RepositoryCases");
  await backfillEntity(jobId, "runs", "TestRuns");
  await backfillEntity(jobId, "sessions", "Sessions");

  console.log("\nDone.");
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
