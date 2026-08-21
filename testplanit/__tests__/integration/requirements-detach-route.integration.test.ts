// Live-DB integration proof for the detach route
// (app/api/projects/[projectId]/requirements/[issueId]/detach/route.ts,
// landing in 25-05). Proves detach's requirementDetachedAt write flips the
// locked-field predicate (isRequirementLocked / LOCKED_ISSUE_FIELDS) so a
// previously-locked field becomes writable through the enhanced client —
// state that can only be observed against a real access-policy-enforcing
// client, not a mock.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-detach-route.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `dt-${Date.now()}`;

describeIntegration("requirements detach route (live DB)", () => {
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
    "sets requirementDetachedAt on a synced requirement and leaves integrationId intact"
  );
  it.todo(
    "a synced, non-detached requirement rejects a locked-field update through the enhanced client"
  );
  it.todo(
    "the same requirement accepts the identical locked-field update after detach"
  );
  it.todo(
    "a detached requirement and a natively-created requirement accept the byte-identical update payload"
  );
  it.todo("note stays writable on a synced, non-detached requirement");
});

void STAMP;
