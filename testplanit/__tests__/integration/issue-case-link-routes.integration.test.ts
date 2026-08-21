// Live-DB regression proof for LINK-01/02 against the already-shipped
// generic link/unlink routes (app/api/issues/[issueId]/link and
// .../unlink), exercised with entityType: "testCase" against a
// requirement-typed issue. These routes need zero code changes for this
// phase (25-CONTEXT.md, "Existing routes that need ZERO changes") — this
// file exists to prove that claim rather than merely assert it, and to
// catch a future regression that narrows the routes to defect-typed
// issues only.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-case-link-routes.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `lc-${Date.now()}`;

describeIntegration("issue-case link/unlink routes for requirements (live DB)", () => {
  // NOTE: vitest skips beforeAll entirely when a describe block holds only
  // it.todo entries, so this guard is DORMANT until 25-04 adds the first
  // real test to this file. 25-04 is responsible for observing this guard
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
    "POST /api/issues/[issueId]/link with entityType testCase creates the RepositoryCaseIssue join row for a requirement-typed issue"
  );
  it.todo(
    "POST /api/issues/[issueId]/unlink with entityType testCase removes the join row"
  );
  it.todo("unlinking a link that does not exist succeeds as a no-op");
  it.todo("one test case can be linked to two different requirements simultaneously");
  it.todo("one requirement can be linked to two different test cases simultaneously");
  it.todo(
    "linking does not mutate any LOCKED_ISSUE_FIELDS value on a synced, locked requirement"
  );
});

void STAMP;
