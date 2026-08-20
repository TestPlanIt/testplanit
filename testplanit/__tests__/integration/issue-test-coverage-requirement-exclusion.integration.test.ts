// Wave 0 scaffold for HYG-03's coverage-parity proof. Plan 23-04 converts
// the four placeholder titles below into real assertions inside this same
// describeIntegration block, reusing the DB guard and STAMP already wired
// here.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/issue-test-coverage-requirement-exclusion.integration.test.ts
//
// PROOF DESIGN — why the obvious cheap fixture proves nothing: the
// coverage report's query joins Issue to RepositoryCaseIssue with an INNER
// JOIN, so a requirement row with no case links can never appear in the
// report at all, before or after reclassification. Asserting "unchanged
// counts" against an unlinked row would pass trivially and prove nothing
// about the real risk. The real risk is an issue that already carried case
// links and contributed real coverage rows and results under the old
// undifferentiated model, and is only later reclassified when an admin
// enables its issue type as a requirement type through the config
// recompute path. That is exactly the fixture this suite must build: a
// defect issue WITH linked cases and results, reclassified through the
// real production recompute function, proving the coverage count drops by
// exactly its own contribution with zero effect on sibling defect issues.

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
// Exported so 23-04's fixture rows can share this run-scoped stamp instead
// of redeclaring it.
export const STAMP = `ic-${Date.now()}`;

describeIntegration(
  "issue test-coverage requirement exclusion (live DB, HYG-03)",
  () => {
    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to `ew`, and this suite
      // reclassifies a live issue through the real recompute path.
      const [{ current_database: dbName }] = await db.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
        );
      }
    });

    it.todo(
      "a defect issue with linked cases appears in the coverage report before reclassification"
    );
    it.todo(
      "reclassifying that issue as a requirement removes exactly its contribution"
    );
    it.todo(
      "sibling defect issues keep byte-identical coverage rows across the reclassification"
    );
    it.todo(
      "the cross-project coverage variant excludes the reclassified issue too"
    );
  }
);
