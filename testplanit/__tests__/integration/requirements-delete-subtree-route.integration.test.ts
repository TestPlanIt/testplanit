// Live-DB integration proof for the delete-subtree and restore routes
// (app/api/projects/[projectId]/requirements/[issueId]/delete-subtree/route.ts
// and .../restore/route.ts, landing in 25-05). Proves the routes actually
// call deleteRequirementSubtree/restoreRequirementSubtree end-to-end
// (auth, scoping, response shape) — the services themselves are already
// proven in __tests__/integration/requirement-subtree-delete.integration.test.ts.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-delete-subtree-route.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `ds-${Date.now()}`;

describeIntegration("requirements delete-subtree and restore routes (live DB)", () => {
  // NOTE: vitest skips beforeAll entirely when a describe block holds only
  // it.todo entries, so this guard is DORMANT until 25-06 adds the first
  // real test to this file. 25-06 is responsible for observing this guard
  // actually fire (e.g. by temporarily pointing DATABASE_URL at a
  // non-scratch database and confirming the throw) before relying on it.
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

  it.todo(
    "soft-deletes the addressed requirement and every live descendant in one call"
  );
  it.todo("does not touch an independent second root tree in the same project");
  it.todo("restore returns exactly the cohort the matching cascade delete touched");
  it.todo(
    "restore does not resurrect a descendant that was already soft-deleted before the cascade ran"
  );
  it.todo("refuses a delete addressed at a defect-typed issue rather than cascading it");
});

void STAMP;
