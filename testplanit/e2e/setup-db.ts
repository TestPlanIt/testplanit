/**
 * E2E Test Database Setup Script
 *
 * This script:
 * 1. Resets the test database (drops all data)
 * 2. Runs Prisma seed (for system data: workflows, templates, roles, etc.)
 * 3. Creates admin user with hasCompletedWelcomeTour = true (prevents onboarding overlay)
 *
 * Tests are responsible for creating their own projects and test data.
 * This ensures tests are self-contained and explicit about their data requirements.
 *
 * Run with: pnpm test:e2e:setup-db
 */


import bcrypt from "bcrypt";
import { createRawDbClient } from "~/lib/rawDbClient";

const prisma = createRawDbClient();

// E2E Test user credentials
const E2E_ADMIN_EMAIL = "admin@example.com";
const E2E_ADMIN_PASSWORD = "admin";

async function ensureSchema() {
  console.log("🔧 Ensuring database schema is up to date...");

  const { execSync } = await import("child_process");

  try {
    // The E2E database is ephemeral (reset + reseeded every run), so accept
    // destructive schema changes (column drops/renames) without prompting.
    execSync("pnpm prisma db push --skip-generate --accept-data-loss", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    console.log("   Schema is ready");
  } catch (error) {
    console.error("   Failed to push schema:", error);
    throw error;
  }
}

async function ensureExtensions() {
  console.log("🧩 Applying PostgreSQL extensions / custom indexes...");

  const { execSync } = await import("child_process");

  try {
    execSync("npx tsx prisma/setup-extensions.ts", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    console.log("   Extensions applied");
  } catch (error) {
    console.error("   Failed to apply extensions:", error);
    throw error;
  }
}

async function ensureAuditTriggers() {
  // prisma db push drops unmanaged triggers, so re-apply after every schema
  // sync or the audit specs see no rows once the app-layer hooks are removed.
  console.log("🔔 Applying audit-capture triggers...");

  const { execSync } = await import("child_process");

  try {
    execSync("npx tsx scripts/apply-triggers.ts", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    console.log("   Audit triggers applied");
  } catch (error) {
    console.error("   Failed to apply audit triggers:", error);
    throw error;
  }
}

async function resetDatabase() {
  console.log("🗑️  Resetting database...");

  // Get all table names except _prisma_migrations, ordered by foreign key dependencies
  // We'll use TRUNCATE with CASCADE which handles FK constraints
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != '_prisma_migrations'
    ORDER BY tablename
  `;

  // Truncate all tables with CASCADE (handles foreign keys)
  // Do this in a single statement to avoid constraint issues
  const tableNames = tables.map((t) => `"public"."${t.tablename}"`).join(", ");

  if (tableNames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableNames} CASCADE;`);
      console.log(`   Truncated ${tables.length} tables`);
    } catch {
      // If truncate fails, try deleting from each table individually
      console.log("   TRUNCATE failed, trying DELETE approach...");
      for (const { tablename } of tables.reverse()) {
        try {
          await prisma.$executeRawUnsafe(
            `DELETE FROM "public"."${tablename}";`
          );
        } catch {
          // Ignore errors for individual tables (FK constraints)
        }
      }
      console.log(`   Deleted data from tables`);
    }
  }
}

async function seedCoreData() {
  console.log("🌱 Seeding core data...");

  // Import and run the main seed function
  // We need to run it inline since it's designed to be run as a script
  const { execSync } = await import("child_process");

  try {
    execSync("pnpm prisma db seed", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: { ...process.env, SEED_TEST_DATA: "true" },
    });
  } catch {
    console.error("   Failed to run prisma db seed, continuing...");
  }
}

/**
 * Flip the system-level Review & Approval feature flag on for E2E.
 *
 * v0.30.0 ships with the system flag opt-in-default-off — a missing
 * `AppConfig.review_feature_enabled` row resolves to disabled, hiding the
 * Request review button, the reviewer inbox, and the requires-review
 * toggle. Existing review specs predate the opt-in flip and assume the
 * feature is implicitly available; flipping it on here matches the
 * pre-opt-in baseline they were written against. Production stays
 * restrictive — fresh installs still ship with the feature off until an
 * administrator explicitly enables it.
 */
async function enableSystemReviewFeatureForE2E() {
  console.log("🚦 Enabling system Review feature flag for E2E...");
  await prisma.appConfig.upsert({
    where: { key: "review_feature_enabled" },
    update: { value: true },
    create: { key: "review_feature_enabled", value: true },
  });
  console.log("   AppConfig.review_feature_enabled = true");
}

/**
 * Open up the seeded `user` role with the two per-area opt-in permissions
 * v0.30.0 added — `canApprove` (Review & Approval reviewer eligibility) and
 * `canReadSensitive` (Parameterized Test Cases restricted-field viewer
 * gate). The production seed deliberately leaves these off by default so a
 * fresh install ships restrictive, but E2E specs assume any test user the
 * spec creates can act as a reviewer / read sensitive values without per-
 * spec fixture setup. This override only runs in the E2E setup path; the
 * shared `prisma/seed.ts` (also used by docker / dev installs) is unchanged.
 */
async function openUserRolePermissionsForE2E() {
  console.log(
    "🔓 Opening user-role permissions for E2E (canApprove + canReadSensitive)..."
  );

  const userRole = await prisma.roles.findFirst({ where: { name: "user" } });
  if (!userRole) {
    console.warn("   No `user` role found — skipping E2E permission widening");
    return;
  }

  const reviewAreas = [
    "TestCaseRepository" as const,
    "TestRuns" as const,
    "Sessions" as const,
  ];
  for (const area of reviewAreas) {
    await prisma.rolePermission.upsert({
      where: { roleId_area: { roleId: userRole.id, area } },
      update: { canApprove: true },
      create: { roleId: userRole.id, area, canApprove: true },
    });
  }

  const restrictedAreas = [
    "TestCaseRestrictedFields" as const,
    "TestRunResultRestrictedFields" as const,
  ];
  for (const area of restrictedAreas) {
    await prisma.rolePermission.upsert({
      where: { roleId_area: { roleId: userRole.id, area } },
      update: { canReadSensitive: true },
      create: { roleId: userRole.id, area, canReadSensitive: true },
    });
  }

  console.log(
    `   user-role canApprove granted on [${reviewAreas.join(", ")}]; canReadSensitive granted on [${restrictedAreas.join(", ")}]`
  );
}

async function ensureAdminUser() {
  console.log("👤 Ensuring admin user exists with correct settings...");

  const adminRole = await prisma.roles.findFirst({
    where: { name: "admin" },
  });

  if (!adminRole) {
    throw new Error("Admin role not found. Run seed first.");
  }

  const hashedPassword = bcrypt.hashSync(E2E_ADMIN_PASSWORD, 10);

  // Upsert admin user
  const admin = await prisma.user.upsert({
    where: { email: E2E_ADMIN_EMAIL },
    update: {
      password: hashedPassword,
      roleId: adminRole.id,
      emailVerified: new Date(),
      access: "ADMIN",
    },
    create: {
      email: E2E_ADMIN_EMAIL,
      name: "E2E Test Admin",
      password: hashedPassword,
      isApi: true,
      roleId: adminRole.id,
      emailVerified: new Date(),
      access: "ADMIN",
    },
  });

  // Ensure user preferences exist with hasCompletedWelcomeTour = true
  await prisma.userPreferences.upsert({
    where: { userId: admin.id },
    update: {
      hasCompletedWelcomeTour: true,
      hasCompletedInitialPreferencesSetup: true,
    },
    create: {
      userId: admin.id,
      itemsPerPage: "P10",
      dateFormat: "MM_DD_YYYY_DASH",
      timeFormat: "HH_MM_A",
      theme: "Light",
      locale: "en_US",
      hasCompletedWelcomeTour: true,
      hasCompletedInitialPreferencesSetup: true,
    },
  });

  console.log(`   Admin user: ${E2E_ADMIN_EMAIL} / ${E2E_ADMIN_PASSWORD}`);
  console.log(`   hasCompletedWelcomeTour: true`);

  return admin;
}

async function clearAuthSession() {
  console.log("🔑 Clearing stale auth session...");
  const fs = await import("fs");
  const path = await import("path");
  const authFile = path.join(__dirname, ".auth", "admin.json");

  if (fs.existsSync(authFile)) {
    fs.unlinkSync(authFile);
    console.log("   Deleted old auth session");
  } else {
    console.log("   No existing auth session found");
  }
}

async function reindexElasticsearch() {
  // setup-db truncates Postgres but Elasticsearch lives outside the DB, so it
  // drifts unless we reset it here too. Rebuild the indices (with mappings) and
  // index the freshly seeded data; per-test data is indexed live by the Prisma
  // middleware. Reuses scripts/reindexAllEntities.ts --fresh.
  if (!process.env.ELASTICSEARCH_NODE) {
    console.warn(
      "\n⚠️  ELASTICSEARCH_NODE is not set — skipping Elasticsearch reindex."
    );
    console.warn(
      "   Report, search, and share specs query Elasticsearch; without it the"
    );
    console.warn(
      "   ES client no-ops and those specs return empty results and fail."
    );
    console.warn("   Set ELASTICSEARCH_NODE in .env.e2e to enable them.\n");
    return;
  }

  console.log("🔎 Resetting + reindexing Elasticsearch (--fresh)...");
  const { execSync } = await import("child_process");
  try {
    execSync("npx tsx scripts/reindexAllEntities.ts --fresh", {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    console.log("   Elasticsearch reindex complete");
  } catch (error) {
    // Non-fatal: ES-backed specs will fail, but the rest of the suite can run.
    console.warn(
      "\n⚠️  Elasticsearch reindex failed — search-backed specs will fail."
    );
    console.warn(
      `   Is the ES node reachable at ${process.env.ELASTICSEARCH_NODE}?`
    );
    console.warn(
      `   ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

async function main() {
  console.log("\n🚀 E2E Test Database Setup\n");
  console.log("=" + "=".repeat(50) + "\n");

  try {
    // Step 0: Ensure schema exists (handles fresh databases)
    await ensureSchema();

    // Step 0.5: Apply PostgreSQL extensions + custom indexes (e.g.,
    // review_request_one_pending_per_entity partial unique). Idempotent via
    // IF NOT EXISTS; mirrors docker-entrypoint.sh production invocation.
    await ensureExtensions();

    // Step 0.6: Re-apply the 68 tpl_audit_* capture triggers and the
    // DataChangeLog append-only enforcement triggers. prisma db push drops
    // all unmanaged triggers, so they must be re-applied here. Idempotent
    // via DROP IF EXISTS + CREATE and CREATE OR REPLACE for functions.
    await ensureAuditTriggers();

    // Step 1: Reset database
    await resetDatabase();

    // Step 2: Seed core data (this runs prisma db seed)
    await seedCoreData();

    // Step 2.5: E2E-only widening of seeded user-role permissions for the two
    // per-area opt-in grants v0.30.0 added (canApprove, canReadSensitive).
    await openUserRolePermissionsForE2E();

    // Step 2.6: Flip the system Review & Approval feature flag on so the
    // pre-Phase-2-opt-in review specs continue to find the request /
    // reviewer-inbox surfaces by default.
    await enableSystemReviewFeatureForE2E();

    // Step 3: Ensure admin user with correct settings
    await ensureAdminUser();

    // Step 3.5: Reset + reindex Elasticsearch so search-backed specs (reports,
    // search, share) see the seeded data. Non-fatal if ES is unset/unreachable.
    await reindexElasticsearch();

    // Step 4: Clear stale auth session (so global-setup will regenerate)
    await clearAuthSession();

    console.log("\n" + "=" + "=".repeat(50));
    console.log("✅ E2E database setup complete!\n");
    console.log("You can now run: pnpm test:e2e\n");
  } catch (error) {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
