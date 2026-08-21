// Live-DB integration proof for the reparent route
// (app/api/projects/[projectId]/requirements/[issueId]/reparent/route.ts,
// landing in 25-05). Proves assertValidReparent's cycle/same-project rules
// are actually enforced server-side, before any parentId write — not just
// asserted against a mocked query client.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-reparent-route.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rp-${Date.now()}`;

describeIntegration("requirements reparent route (live DB)", () => {
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
    "rejects a reparent that would create a cycle, server-side, before any parentId write"
  );
  it.todo("rejects a reparent whose new parent belongs to a different project");
  it.todo(
    "accepts a legitimate same-project, non-cyclic reparent and persists the new parentId"
  );
  it.todo("leaves parentId unchanged in the database after a rejected reparent");
  it.todo("refuses a reparent addressed at a defect-typed issue");
});

void STAMP;
