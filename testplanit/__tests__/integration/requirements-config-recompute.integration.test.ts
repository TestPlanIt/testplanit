// Live-DB integration scaffold for CFG-03 — the requirements-config
// recompute pass (both-direction isRequirement flip, one audited
// transaction, project-scoped, no stale rows). Plan 22-03 converts these
// todos in the same commit that adds the recompute function.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-config-recompute.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rc-${Date.now()}`;

describeIntegration("requirements-config recompute (live DB)", () => {
  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
    // real bulk isRequirement flips.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }
  });

  it.todo("classifies issues whose type was added to the config");
  it.todo("de-classifies issues whose type was removed from the config");
  it.todo("leaves another project's issues of the same type untouched");
  it.todo("skips soft-deleted issues in both directions");
  it.todo("leaves requirementDetachedAt, parentId and title untouched");
});

// STAMP retained for the converting plan's fixture-row prefixing
// convention (mirrors requirement-subtree-delete.integration.test.ts's
// STAMP usage) — referenced here only to keep the constant from being
// flagged unused until 22-03 starts creating fixture rows with it.
void STAMP;
