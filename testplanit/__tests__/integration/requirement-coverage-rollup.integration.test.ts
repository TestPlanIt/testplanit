// Live-DB integration scaffold for the requirement coverage rollup
// (COV-01/COV-02/COV-03). The rollup's recursive walk through a
// requirement's whole subtree, its case-linking dedup, and its
// accessible-project scope gating can only be proven against real
// Postgres recursion and real joined rows — a mocked query client would
// prove nothing about the actual SQL shape.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   BASE = .env DATABASE_URL with /ew?schema=public replaced by
//   /tpi_req20?schema=public
//   DATABASE_URL="$BASE" RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/requirement-coverage-rollup.integration.test.ts
//
// This suite must never inherit the worktree's own .env: that file's
// DATABASE_URL resolves to the real, shared dev database, which holds
// real classified requirement rows and may back a running dev server —
// running fixture writes and a rollup proof against it would corrupt
// live data and produce results that don't reflect a clean scratch state.
// The current_database() guard in beforeAll below refuses to proceed
// against anything but the scratch database, whatever DATABASE_URL a
// caller supplies.

import { afterAll, beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

// Deliberately no top-level import of "~/lib/services/requirementCoverage"
// — that module does not exist yet, and a top-level import of a missing
// module fails this file at transform time, taking the whole unit lane
// red for everyone working in parallel. The converting plan adds the
// import when it builds the fixtures and fills these titles in.

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
// Run-scoped stamp for fixture naming — the converting plan uses this to
// keep concurrent runs' rows distinguishable and to scope teardown.
const STAMP = `rc-${Date.now()}`;

describeIntegration(
  "requirement coverage rollup (live DB, COV-01/COV-02/COV-03)",
  () => {
    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to the real, shared dev
      // database, and this suite's converting plan will write and tear
      // down fixture rows.
      const [{ current_database: dbName }] = await db.$queryRaw<
        Array<{ current_database: string }>
      >`SELECT current_database()`;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
        );
      }
      // No fixtures yet — the converting plan builds the requirement
      // trees, linked cases, and results these titles need.
    });

    afterAll(async () => {
      await db.$disconnect();
    });

    it.todo(
      "a case linked at both a parent and a descendant counts once toward the parent"
    );

    it.todo(
      "a requirement with no linked cases anywhere in its subtree returns as an explicit gap row"
    );

    it.todo("one failed covering case makes the whole requirement FAILED");

    it.todo(
      "a case linked only to a non-requirement intermediate node still rolls up to the ancestor requirement"
    );

    it.todo("a soft-deleted or archived case does not cover a requirement");

    it.todo("the latest result is the most recent execution across every run");

    it.todo(
      "cases in another project count and are reported separately as cross-project"
    );

    it.todo(
      "a viewer's accessible project scope excludes cases from projects they cannot read"
    );

    it.todo(
      "a requirement in another project never appears in a project-scoped rollup"
    );

    it.todo(
      "covering-case drill-down returns each case's project so a cross-project case can be badged"
    );
  }
);

// STAMP is declared for the converting plan's fixture naming; referencing
// it here keeps this scaffold free of an unused-variable lint failure
// until that plan builds real fixtures around it.
void STAMP;
