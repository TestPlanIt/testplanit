import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function setupExtensions() {
  console.log("Setting up PostgreSQL extensions...");

  // pg_trgm extension for fuzzy text search (used by duplicate detection)
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  console.log("pg_trgm extension ensured.");

  // GIN index on RepositoryCases.name for fast trigram similarity queries
  // CONCURRENTLY avoids table locks; IF NOT EXISTS makes it idempotent
  // Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction,
  // so we use $executeRawUnsafe instead of $executeRaw tagged template
  await prisma.$executeRawUnsafe(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_repository_cases_name_trgm
     ON "RepositoryCases" USING GIN (name gin_trgm_ops)
     WHERE "isDeleted" = false`
  );
  console.log("GIN trigram index on RepositoryCases.name ensured.");
}

setupExtensions()
  .then(() => {
    console.log("PostgreSQL extensions setup complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed to setup PostgreSQL extensions:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
