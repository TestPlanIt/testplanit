

const prisma = createRawDbClient();

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

  // Partial unique index: at most one PENDING ReviewRequest per (entityType, entityId)
  // across all toStateId values (D-11, D-12). Prisma's schema language can't express
  // partial unique indexes. UNIQUE indexes cannot use CONCURRENTLY inside a transaction;
  // $executeRawUnsafe runs outside a Prisma transaction and IF NOT EXISTS makes it idempotent.
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS review_request_one_pending_per_entity
     ON "ReviewRequest" ("entityType", "entityId")
     WHERE status = 'PENDING' AND "isDeleted" = false`
  );
  console.log(
    "Partial unique index review_request_one_pending_per_entity ensured."
  );
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
