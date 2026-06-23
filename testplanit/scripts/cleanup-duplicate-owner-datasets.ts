import { createRawDbClient } from "~/lib/rawDbClient";
/**
 * Cleanup script: soft-delete duplicate owner-bound DataSets.
 *
 * The "at most one owner-bound DataSet per case" invariant (DSET-01) is
 * documented but not enforced at the schema level. A race on the attach
 * endpoint, a seed script, or an old code path can leave two non-deleted
 * datasets bound to the same case. This script picks one to keep per case
 * and soft-deletes the others.
 *
 * Keeper rule per (ownerCaseId) group:
 *   1. Most rows (largest non-deleted DataSetRow count).
 *   2. Tie-break on `createdAt DESC` — keep the most recently created.
 *
 * Soft-delete only (`isDeleted = true`). Reversible. No DB rows are removed.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-duplicate-owner-datasets.ts          # dry run
 *   pnpm tsx scripts/cleanup-duplicate-owner-datasets.ts --apply  # mutate
 */



// Bare PrismaClient (not the lib/prisma.ts singleton) — that singleton
// pulls in Elasticsearch sync, audit, and webhook emitter side-effects
// at import time, which hangs a one-off CLI script.
const prisma = createRawDbClient();

const APPLY = process.argv.includes("--apply");

interface DatasetRow {
  id: number;
  name: string;
  ownerCaseId: number | null;
  projectId: number;
  createdAt: Date;
  rowCount: number;
}

async function main() {
  console.log(
    APPLY
      ? "Mode: APPLY — will soft-delete duplicate owner-bound datasets"
      : "Mode: DRY RUN — no writes. Re-run with --apply to mutate."
  );

  const datasets = await prisma.dataSet.findMany({
    where: {
      isDeleted: false,
      isShared: false,
      ownerCaseId: { not: null },
    },
    select: {
      id: true,
      name: true,
      ownerCaseId: true,
      projectId: true,
      createdAt: true,
      _count: { select: { rows: { where: { isDeleted: false } } } },
    },
  });

  const enriched: DatasetRow[] = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    ownerCaseId: d.ownerCaseId,
    projectId: d.projectId,
    createdAt: d.createdAt,
    rowCount: d._count.rows,
  }));

  // Group by ownerCaseId.
  const byCase = new Map<number, DatasetRow[]>();
  for (const d of enriched) {
    if (d.ownerCaseId == null) continue;
    const list = byCase.get(d.ownerCaseId) ?? [];
    list.push(d);
    byCase.set(d.ownerCaseId, list);
  }

  const dupGroups = [...byCase.entries()].filter(([, ds]) => ds.length > 1);

  if (dupGroups.length === 0) {
    console.log("No duplicate owner-bound datasets found.");
    return;
  }

  console.log(`Found ${dupGroups.length} case(s) with duplicate datasets:\n`);

  const toDelete: DatasetRow[] = [];

  for (const [caseId, ds] of dupGroups) {
    // Sort: rowCount DESC, then createdAt DESC. First wins = keeper.
    const sorted = [...ds].sort((a, b) => {
      if (b.rowCount !== a.rowCount) return b.rowCount - a.rowCount;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    const keeper = sorted[0];
    const losers = sorted.slice(1);

    console.log(`  Case ${caseId} (project ${keeper.projectId}):`);
    console.log(
      `    KEEP   id=${keeper.id}  rows=${keeper.rowCount}  created=${keeper.createdAt.toISOString()}  name="${keeper.name}"`
    );
    for (const loser of losers) {
      console.log(
        `    DELETE id=${loser.id}  rows=${loser.rowCount}  created=${loser.createdAt.toISOString()}  name="${loser.name}"`
      );
    }
    toDelete.push(...losers);
  }

  console.log(
    `\nTotal datasets to soft-delete: ${toDelete.length} (across ${dupGroups.length} case(s))`
  );

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to mutate.");
    return;
  }

  const ids = toDelete.map((d) => d.id);
  const result = await prisma.dataSet.updateMany({
    where: { id: { in: ids } },
    data: { isDeleted: true },
  });
  console.log(`\nSoft-deleted ${result.count} DataSet row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
