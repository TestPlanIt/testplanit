// Live-DB integration scaffold for the tpl_issue_content_updated_at_guard
// Postgres trigger (COV-05, D-01/D-02). The trigger is diff-aware — it
// stamps Issue.contentUpdatedAt = now() on a BEFORE UPDATE only when one of
// the watched columns (title, description, note) IS DISTINCT FROM its old
// value. This is the load-bearing evidence-driven decision from CONTEXT.md:
// SyncService.ts's unconditional `lastSyncedAt: new Date()` write on every
// sync poll (:1886, :2043) must never arm the flag when title/description/
// note are byte-identical to what was already there.
//
// Mirrors issue-hierarchy-cycle-guard.integration.test.ts's scaffold shape
// (imports, RUN_INTEGRATION gate, DB_URL, describeIntegration binding, the
// current_database() allowlist guard in beforeAll, the withRollback +
// ROLLBACK_SENTINEL helper) so 27-05 can convert titles into real
// assertions with the smallest possible diff.
//
// TODO(27-05): once the trigger DDL exists, import
// ISSUE_CONTENT_UPDATED_AT_TRIGGER_SQL from ~/scripts/apply-triggers and
// self-apply it here (idempotently, the same way
// ISSUE_HIERARCHY_CYCLE_GUARD_SQL is self-applied above) so this file stays
// self-sufficient in CI without an operator having run the trigger applier
// ahead of time. That export does not exist yet — importing it now would
// break the unit lane's type-check, so this plan (27-01) deliberately
// leaves the import out.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-content-updated-at-trigger.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DB_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Issue contentUpdatedAt trigger (live DB)", () => {
  const ROLLBACK_SENTINEL = "__ISSUE_CONTENT_UPDATED_AT_TEST_ROLLBACK__";

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
          `Refusing to run against database "${dbName}" — the issue ` +
            `contentUpdatedAt trigger integration suite only runs against ` +
            `tpi_req20 (scratch) or tpi_test (CI's ephemeral service database).`
        );
      }
      // TODO(27-05): self-apply ISSUE_CONTENT_UPDATED_AT_TRIGGER_SQL here,
      // idempotently, once it exists in ~/scripts/apply-triggers.
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

  it.todo("stamps contentUpdatedAt when title actually changes");
  it.todo("stamps contentUpdatedAt when description actually changes");
  it.todo("stamps contentUpdatedAt when note actually changes");
  it.todo(
    "leaves contentUpdatedAt untouched when a sync poll rewrites title and description with identical values"
  );
  it.todo(
    "leaves contentUpdatedAt untouched when only status, priority or parentId change"
  );
  it.todo("leaves contentUpdatedAt NULL on insert");

  afterAll(() => {
    // No teardown beyond what each converted test will handle via
    // withRollback's transaction rollback.
  });
});
