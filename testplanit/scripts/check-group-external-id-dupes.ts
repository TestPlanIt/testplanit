#!/usr/bin/env tsx
/**
 * check-group-external-id-dupes.ts — Pre-migration audit gate for the
 * Groups.externalId UNIQUE constraint.
 *
 * Run BEFORE applying the schema migration that flips Groups.externalId to
 * @unique. If duplicate non-null externalId values exist, the @unique
 * constraint application will fail mid-migration with an ambiguous error;
 * this script surfaces the offending rows up front so an engineer can
 * decide which row keeps the externalId and which gets nulled / renamed.
 *
 * Behaviour:
 *   - Exits 0 with a "PASS" message when no duplicates exist.
 *   - Exits 1 with the offending externalId values + per-value row counts
 *     printed to stderr when duplicates exist. Manual resolution is
 *     required — the script never auto-picks a winner because the choice
 *     depends on which Group the IdP currently considers authoritative.
 *
 * Usage:
 *   pnpm scim:check-group-dupes
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const rows = await prisma.$queryRaw<
    Array<{ externalId: string; count: bigint }>
  >`SELECT "externalId", COUNT(*) as count FROM "Groups" WHERE "externalId" IS NOT NULL GROUP BY "externalId" HAVING COUNT(*) > 1`;

  if (rows.length === 0) {
    console.log("PASS: no duplicate externalId values; safe to apply @unique");
    process.exit(0);
  }

  console.error("FAIL: duplicate externalId values found:");
  for (const r of rows) {
    console.error(`  ${r.externalId}: ${r.count} rows`);
  }
  console.error("\nResolve manually before applying the @unique migration.");
  process.exit(1);
}

void main().finally(() => prisma.$disconnect());
