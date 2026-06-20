/**
 * Backfill: assign every existing configuration to every existing project.
 *
 * Configurations used to be global (visible in all projects). They are now
 * scoped per project via `ProjectConfigurationAssignment`. To preserve the
 * pre-existing behavior on upgrade, this assigns each non-deleted
 * configuration to each non-deleted project. Idempotent (skips pairs that are
 * already assigned), so it is safe to re-run. New projects do NOT get configs
 * automatically — they opt in.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-config-project-assignments.ts          # dry run
 *   pnpm tsx scripts/backfill-config-project-assignments.ts --apply  # mutate
 */



// Bare PrismaClient (not the lib/prisma.ts singleton) — that singleton pulls
// in Elasticsearch sync, audit, and webhook side-effects at import time, which
// hangs a one-off CLI script.
const prisma = createRawDbClient();

const APPLY = process.argv.includes("--apply");

async function main() {
  const [configs, projects] = await Promise.all([
    prisma.configurations.findMany({
      where: { isDeleted: false },
      select: { id: true },
    }),
    prisma.projects.findMany({
      where: { isDeleted: false },
      select: { id: true },
    }),
  ]);

  const existing = await prisma.projectConfigurationAssignment.findMany({
    select: { configurationId: true, projectId: true },
  });
  const have = new Set(
    existing.map((a) => `${a.configurationId}:${a.projectId}`)
  );

  const toCreate: { configurationId: number; projectId: number }[] = [];
  for (const c of configs) {
    for (const p of projects) {
      if (!have.has(`${c.id}:${p.id}`)) {
        toCreate.push({ configurationId: c.id, projectId: p.id });
      }
    }
  }

  console.log(
    `Configurations: ${configs.length} | Projects: ${projects.length} | ` +
      `Existing assignments: ${existing.length} | Missing pairs: ${toCreate.length}`
  );

  if (toCreate.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  if (!APPLY) {
    console.log("Dry run — re-run with --apply to create the assignments.");
    return;
  }

  const result = await prisma.projectConfigurationAssignment.createMany({
    data: toCreate,
    skipDuplicates: true,
  });
  console.log(`Created ${result.count} configuration-project assignments.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
