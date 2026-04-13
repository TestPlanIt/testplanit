import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateIntegrationProjects() {
  console.log("Starting IntegrationProject migration...");

  const integrations = await prisma.projectIntegration.findMany({
    where: { isActive: true },
  });

  console.log(`Found ${integrations.length} active ProjectIntegration records`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const pi of integrations) {
    const config = pi.config as Record<string, any> | null;

    // Fallback chain: externalProjectId > externalProjectKey
    const externalProjectId = config?.externalProjectId || config?.externalProjectKey;
    if (!externalProjectId) {
      console.log(`  Skipping ${pi.id} — no externalProjectId or externalProjectKey in config`);
      skipped++;
      continue;
    }

    // Check if already migrated (idempotent)
    const existing = await prisma.integrationProject.findFirst({
      where: {
        projectIntegrationId: pi.id,
        externalProjectId: String(externalProjectId),
      },
    });

    if (existing) {
      console.log(`  Skipping ${pi.id} — already migrated (${externalProjectId})`);
      skipped++;
      continue;
    }

    try {
      await prisma.integrationProject.create({
        data: {
          projectIntegrationId: pi.id,
          externalProjectId: String(externalProjectId),
          externalProjectKey: String(config?.externalProjectKey || externalProjectId),
          externalProjectName: String(config?.externalProjectName || config?.externalProjectKey || externalProjectId),
          isActive: true,
          isDefault: true, // First-and-only project becomes default per D-03
          defaultIssueType: config?.defaultIssueType || null,
          defaultIssueTypeName: config?.defaultIssueTypeName || null,
        },
      });
      console.log(`  Migrated ${pi.id} -> ${externalProjectId}`);
      migrated++;
    } catch (error: any) {
      console.error(`  Error migrating ${pi.id}: ${error.message}`);
      errors++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
}

migrateIntegrationProjects()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
