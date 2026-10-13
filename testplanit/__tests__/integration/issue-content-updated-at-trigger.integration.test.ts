// Live-DB integration proof for the tpl_issue_content_updated_at_upd
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
// ROLLBACK_SENTINEL helper).
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-content-updated-at-trigger.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { ISSUE_CONTENT_UPDATED_AT_TRIGGER_SQL } from "~/scripts/apply-triggers";

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
      // Idempotent apply so the file is self-sufficient in CI, where no
      // operator ran the trigger applier ahead of time.
      await client.query(ISSUE_CONTENT_UPDATED_AT_TRIGGER_SQL);
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

  /**
   * Seed a minimal fixture — a project, a creator user, and one Issue row —
   * stamp-prefixed with `cua-` + a run-unique tag so fixture rows are
   * greppable and never collide across tests. The seeded row's `note`
   * starts as a real (non-null) jsonb document so the note test below has
   * something genuinely different to diff against.
   */
  async function seedIssue(tx: any, extra: Record<string, unknown> = {}) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await tx.projects.create({
      data: { name: `cua-${stamp}`, createdBy: creator.id },
      select: { id: true },
    });
    const issue = await tx.issue.create({
      data: {
        name: `cua-${stamp}-issue`,
        title: `cua-${stamp}-title`,
        description: `cua-${stamp}-description`,
        note: { seed: true },
        createdById: creator.id,
        projectId: project.id,
        ...extra,
      },
      select: { id: true },
    });

    return {
      creatorId: creator.id as string,
      projectId: project.id as number,
      issueId: issue.id as number,
      stamp,
    };
  }

  /**
   * Reads contentUpdatedAt with a raw select, never through the ORM, so no
   * assertion below can be satisfied by a client-side default.
   */
  async function readContentUpdatedAt(
    tx: any,
    issueId: number
  ): Promise<Date | null> {
    const rows = await tx.$queryRaw<Array<{ contentUpdatedAt: Date | null }>>`
      SELECT "contentUpdatedAt" FROM "Issue" WHERE id = ${issueId}
    `;
    return rows[0]?.contentUpdatedAt ?? null;
  }

  it("stamps contentUpdatedAt when title actually changes", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { issueId, stamp } = await seedIssue(tx);

      const before = await readContentUpdatedAt(tx, issueId);
      expect(before).toBeNull();

      await tx.issue.update({
        where: { id: issueId },
        data: { title: `cua-${stamp}-title-updated` },
      });

      const after = await readContentUpdatedAt(tx, issueId);
      expect(after).not.toBeNull();
    });
  });

  it("stamps contentUpdatedAt when description actually changes", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { issueId, stamp } = await seedIssue(tx);

      const before = await readContentUpdatedAt(tx, issueId);
      expect(before).toBeNull();

      await tx.issue.update({
        where: { id: issueId },
        data: { description: `cua-${stamp}-description-updated` },
      });

      const after = await readContentUpdatedAt(tx, issueId);
      expect(after).not.toBeNull();
    });
  });

  it("stamps contentUpdatedAt when note actually changes", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { issueId } = await seedIssue(tx);

      const before = await readContentUpdatedAt(tx, issueId);
      expect(before).toBeNull();

      // Genuinely different jsonb document from the seeded `{ seed: true }`.
      await tx.issue.update({
        where: { id: issueId },
        data: { note: { seed: true, changed: true, at: Date.now() } },
      });

      const after = await readContentUpdatedAt(tx, issueId);
      expect(after).not.toBeNull();
    });
  });

  it("leaves contentUpdatedAt untouched when a sync poll rewrites title and description with identical values", async () => {
    const { baseDb } = await importDeps();

    // Deliberately NOT one withRollback transaction for the whole test:
    // Postgres freezes now() for the entire life of a single transaction
    // (transaction_timestamp() semantics), so two UPDATEs issued inside ONE
    // transaction always read back the SAME contentUpdatedAt regardless of
    // whether the trigger fired once or twice — that would make the no-op
    // assertion below pass even under a broken, unconditionally-firing
    // trigger (confirmed: widening the trigger's WHEN clause to WHEN (TRUE)
    // did NOT turn this test red until it was split like this — see the
    // Deviations note in the plan's SUMMARY). The real content edit below
    // runs in its own COMMITTED transaction; the sync-poll rewrite runs in
    // a SEPARATE, later, rolled-back transaction — so a mistakenly
    // re-firing trigger stamps a genuinely DIFFERENT wall-clock value.
    const creator = await baseDb.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const project = await baseDb.projects.create({
      data: { name: `cua-${stamp}`, createdBy: creator.id },
      select: { id: true },
    });
    const issue = await baseDb.issue.create({
      data: {
        name: `cua-${stamp}-issue`,
        title: `cua-${stamp}-title`,
        description: `cua-${stamp}-description`,
        note: { seed: true },
        createdById: creator.id,
        projectId: project.id,
      },
      select: { id: true },
    });

    try {
      // First, a REAL content edit stamps contentUpdatedAt — so the
      // no-op assertion below proves the no-op case for an ALREADY-stamped
      // row, not just a fresh NULL one. Committed (not rolled back), so its
      // stamped value is a real, persisted wall-clock timestamp.
      const currentTitle = `cua-${stamp}-title-real-edit`;
      await baseDb.issue.update({
        where: { id: issue.id },
        data: { title: currentTitle },
      });
      const stampedAt = await readContentUpdatedAt(baseDb, issue.id);
      expect(stampedAt).not.toBeNull();

      // Simulates SyncService.ts's sync-poll write shape (createNewIssue
      // ~:1866-1890, updateExistingIssue ~:2021-2050): title and
      // description rewritten with BYTE-IDENTICAL values alongside an
      // unconditional lastSyncedAt bump. This single assertion is what
      // justifies D-01's entire diff-aware mechanism over the ROADMAP's
      // original @updatedAt sketch — an ORM-managed @updatedAt would
      // re-stamp on every one of these polls, marking every synced
      // requirement suspect after every sync poll, dead on arrival.
      await withRollback(baseDb, async (tx) => {
        const row = await tx.issue.findUnique({
          where: { id: issue.id },
          select: { description: true },
        });

        await tx.issue.update({
          where: { id: issue.id },
          data: {
            title: currentTitle,
            description: row?.description,
            lastSyncedAt: new Date(),
          },
        });

        const after = await readContentUpdatedAt(tx, issue.id);
        expect(
          after?.getTime(),
          "an identical-value sync-poll rewrite must leave contentUpdatedAt exactly as it was, including an already-stamped value — this is D-01's entire justification over @updatedAt"
        ).toBe(stampedAt?.getTime());
      });
    } finally {
      await baseDb.issue.delete({ where: { id: issue.id } });
      await baseDb.projects.delete({ where: { id: project.id } });
    }
  });

  it("leaves contentUpdatedAt untouched when only status, priority or parentId change", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { issueId, projectId, creatorId, stamp } = await seedIssue(tx);
      const otherParent = await tx.issue.create({
        data: {
          name: `cua-${stamp}-parent`,
          title: `cua-${stamp}-parent`,
          createdById: creatorId,
          projectId,
        },
        select: { id: true },
      });

      // Stamp contentUpdatedAt first via a real edit, so the assertion
      // below proves byte-identical timestamps rather than two NULLs
      // agreeing trivially.
      await tx.issue.update({
        where: { id: issueId },
        data: { title: `cua-${stamp}-title-stamped` },
      });
      const before = await readContentUpdatedAt(tx, issueId);
      expect(before).not.toBeNull();

      await tx.issue.update({
        where: { id: issueId },
        data: {
          status: "in_progress",
          priority: "high",
          parentId: otherParent.id,
        },
      });

      const after = await readContentUpdatedAt(tx, issueId);
      expect(after?.getTime()).toBe(before?.getTime());
    });
  });

  it("leaves contentUpdatedAt NULL on insert", async () => {
    const { baseDb } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { issueId } = await seedIssue(tx);
      const value = await readContentUpdatedAt(tx, issueId);
      expect(value).toBeNull();
    });
  });

  afterAll(() => {
    // No teardown beyond what each test already handles: every test rolls
    // its own transaction back via withRollback.
  });
});
