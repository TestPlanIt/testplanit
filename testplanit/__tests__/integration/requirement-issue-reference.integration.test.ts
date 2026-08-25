// Live-DB integration scaffold for the RequirementIssueReference join model
// (LINK-03, D-09/D-11/D-15). A reference joins a requirement (the Issue row
// with isRequirement: true) to a referenced Issue — internal or, via the
// existing linked-issue-shell upsert path, an imported external ticket.
//
// Load-bearing companion rule under proof here: a reference-created shell
// NEVER sets isRequirement (D-09) — references must never appear in the
// requirements tree — and removal hard-deletes only the join row, leaving
// the referenced Issue intact (D-15), mirroring the bare-join
// RepositoryCaseIssue unlink semantics.
//
// Mirrors issue-hierarchy-cycle-guard.integration.test.ts's scaffold shape
// (imports, RUN_INTEGRATION gate, DB_URL, describeIntegration binding, the
// current_database() allowlist guard in beforeAll, the withRollback +
// ROLLBACK_SENTINEL helper) so 27-08 can convert titles into real
// assertions with the smallest possible diff.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-issue-reference.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("RequirementIssueReference join model (live DB)", () => {
  const ROLLBACK_SENTINEL = "__REQUIREMENT_ISSUE_REFERENCE_TEST_ROLLBACK__";

  beforeAll(async () => {
    // Standard database guard: refuse to run DDL/writes against anything
    // other than the tpi_req20 scratch database or tpi_test (CI's ephemeral
    // service database) — the worktree's default .env DATABASE_URL resolves
    // to `ew`, and this suite must never touch it.
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query<{ current_database: string }>(
        "select current_database()"
      );
      const dbName = rows[0]?.current_database;
      if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
        throw new Error(
          `Refusing to run against database "${dbName}" — the ` +
            `RequirementIssueReference integration suite only runs against ` +
            `tpi_req20 (scratch) or tpi_test (CI's ephemeral service database).`
        );
      }
    } finally {
      await client.end();
    }
  });

  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    return { baseDb };
  };

  async function withRollback<T>(
    baseDb: any,
    body: (tx: any) => Promise<T>,
    timeoutMs = 60_000
  ): Promise<T> {
    let captured: T | undefined;
    let captureErr: unknown;
    try {
      await baseDb.$transaction(
        async (tx: any) => {
          try {
            captured = await body(tx);
          } catch (err) {
            captureErr = err;
          }
          throw new Error(ROLLBACK_SENTINEL);
        },
        { timeout: timeoutMs }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes(ROLLBACK_SENTINEL)) throw err;
    }
    if (captureErr) throw captureErr;
    return captured as T;
  }

  it.todo("creates a reference row joining a requirement to an internal issue");
  it.todo(
    "rejects a second reference row for the same requirement and referenced issue"
  );
  it.todo(
    "rejects a self-reference where requirementId equals referencedIssueId"
  );
  it.todo("never sets isRequirement on a reference-created issue shell");
  it.todo("never writes parentId when attaching a reference");
  it.todo(
    "hard-deletes only the join row and leaves the referenced Issue intact"
  );
  it.todo("allows attaching a reference to a synced, locked requirement");

  afterAll(() => {
    // No teardown beyond what each converted test will handle via
    // withRollback's transaction rollback.
  });
});
