// Live-DB integration test inventory scaffold for the requirement
// traceability export (COV-04). Titles only — converted by 26-08. Guard
// copied verbatim from
// __tests__/integration/requirement-coverage-rollup.integration.test.ts:121-129.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-traceability-export.integration.test.ts
//
// This suite must never inherit the worktree's own .env DATABASE_URL,
// which resolves to the real, shared dev database. The current_database()
// guard in beforeAll below refuses to proceed against anything but the
// scratch database, whatever DATABASE_URL a caller supplies. In the unit
// lane (RUN_DB_INTEGRATION unset), describeIntegration resolves to
// describe.skip, so beforeAll never runs and no connection is attempted.

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();

describeIntegration(
  "requirement traceability export (live DB, converted by 26-08)",
  () => {
    beforeAll(async () => {
      const [{ current_database: dbName }] = await db.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
        );
      }
    });

    it.todo("produces one row per requirement and covering case for a real hierarchy");
    it.todo("produces exactly one null-case row per uncovered requirement");
    it.todo("excludes cases in projects outside the viewer scope");
    it.todo("agrees with getRequirementCoverage on which requirements are uncovered");
  }
);
