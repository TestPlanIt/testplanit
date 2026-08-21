// Live-DB integration proof for HIER-06 — discrete file attachments on a
// requirement via the new Attachments.issueId FK (landed in 25-01,
// schema.zmodel + tpi_req20/ew). Proves the one-nullable-FK-per-entity
// idiom behaves identically for Issue as it already does for every other
// Attachments consumer (testCaseId, sessionId, ...), and that attachments
// are NOT a locked field on a synced, non-detached requirement.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-attachments.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `att-${Date.now()}`;

describeIntegration(
  "requirement attachments via Attachments.issueId (live DB)",
  () => {
    // NOTE: vitest skips beforeAll entirely when a describe block holds only
    // it.todo entries, so this guard is DORMANT until 25-12 adds the first
    // real test to this file. 25-12 is responsible for observing this guard
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

    it.todo("creates an Attachments row bound to a requirement via issueId");
    it.todo(
      "reads back only that requirement's attachments, excluding soft-deleted rows"
    );
    it.todo(
      "soft-deletes an attachment by setting isDeleted rather than removing the row"
    );
    it.todo(
      "an attachment can be created on a synced, non-detached requirement — attachments are not a locked field"
    );
  }
);

void STAMP;
