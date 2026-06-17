/**
 * Phase 13 Wave 0 — Nyquist verification scaffold (RED until the substrate ships in 13-06).
 *
 * Client/method-agnostic capture matrix. Proves a single database-level trigger captures EVERY
 * write path regardless of which client issues it:
 *   (a) hooked Prisma client (lib/prisma.ts)         → CTX-01 (non-null actor from injected GUC)
 *   (b) raw `$executeRaw` UPDATE bypassing all hooks → SUCCESS CRITERION #1 / COV-01
 *   (c) createMany bulk insert                       → COV-01 (bulk method coverage)
 *   (d) worker/raw path via withAuditGuc()           → CTX-02 (payload.userId stamped as actor)
 *   (e) tag implicit m2m join table INSERT+DELETE    → COV-02 (tag-link pattern, pk = column "A")
 *   (e2) issue implicit m2m join table INSERT+DELETE → COV-02 (issue-link pattern, pk = column "A")
 *   (f) SAF-01 skip_audit hatch                       → ZERO rows captured (bulk-import escape hatch)
 *   (g) SAF-04 excluded credential table (negative)   → ZERO rows (VerificationToken is NOT audited)
 *
 * Gating: copies the Phase 12 spike pattern EXACTLY — skips cleanly (no DB connection attempted)
 * when RUN_DB_INTEGRATION is unset, so the unit lane stays green. Read DataChangeLog assertions go
 * through a direct `pg.Client` (no policy layer); mutations go through the app's Prisma clients.
 *
 * Run (RED today; GREEN after 13-06):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   DATABASE_URL="postgresql://user:password@localhost:56432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/captureMatrix.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

const ctx = (o: Record<string, string>) => JSON.stringify(o);

describeDb("captureMatrix — client/method-agnostic capture (Phase 13 success criterion #1 + COV/CTX/SAF)", () => {
  // Lazy state — modules and connections are only touched when the suite actually runs, so the
  // not-yet-existing gucContext / prisma imports never load in the skipped unit lane.
  // NOTE: gucContext (~/lib/audit/gucContext) does not exist yet — it ships in 13-02. The dynamic
  // import below uses a runtime-built specifier + /* @vite-ignore */ so Vite's static
  // import-analysis can't try to resolve the missing module at transform time (which would FAIL the
  // suite instead of skipping it). TODO(13-02): once gucContext exists this stays runtime-resolved.
  // The 13-02 GUC helpers and the Prisma client are intentionally untyped here (substrate absent);
  // `any` keeps the RED scaffold compiling without importing not-yet-existing types.
  let direct: import("pg").Client;
  let prisma: any;
  let prismaBase: any;
  // Shipped 13-04 GUC helpers (lib/audit/gucContext):
  //   injectAuditGuc(tx)                  — sets app.audit_context from the ALS frame (hooked path, CTX-01).
  //                                          Must be the FIRST await inside a $transaction; returns void.
  //   withAuditGuc(client, payload, fn)   — opens its own $transaction, sets app.audit_context from an
  //                                          explicit payload, runs fn (worker/raw path, CTX-02).
  // runWithAuditContext(ctx, fn)          — establishes the ALS frame injectAuditGuc reads (lib/auditContext).
  type GucPayload = { userId: string | null; requestId: string | null; source: string; tenantId: string | null };
  let withAuditGuc: <T>(client: unknown, payload: GucPayload, fn: (tx: any) => Promise<T>) => Promise<T>;
  let injectAuditGuc: (tx: any) => Promise<void>;
  let runWithAuditContext: <T>(
    context: { userId?: string; requestId?: string; suppressWebhooks?: boolean },
    fn: () => T,
  ) => T;

  // Unique marker per run scopes every assertion to rows this run created.
  const MARKER = `capmatrix-${Date.now()}`;
  // A RepositoryCases id we created (b/f reuse it); created via the hooked client in (a).
  let seededCaseId: number;
  // Track fixture ids for afterAll cleanup.
  const verificationTokens: string[] = [];

  // Read helper: count + fetch DataChangeLog rows for a given table/op scoped to our marker text.
  // The marker is embedded in changed_cols->name->new (cases) or matched by pk (join/cred tables).
  const dclRowsByNameMarker = async (table: string, op: string, nameMarker: string) => {
    const r = await direct.query(
      `SELECT "table", op, pk, changed_cols, actor, operation_id, tenant
         FROM "DataChangeLog"
        WHERE "table" = $1 AND op = $2 AND changed_cols->'name'->>'new' = $3
        ORDER BY id ASC`,
      [table, op, nameMarker],
    );
    return r.rows;
  };

  const dclRowsByPk = async (table: string, op: string, pk: string) => {
    const r = await direct.query(
      `SELECT "table", op, pk, changed_cols, actor, operation_id, tenant
         FROM "DataChangeLog"
        WHERE "table" = $1 AND op = $2 AND pk = $3
        ORDER BY id ASC`,
      [table, op, String(pk)],
    );
    return r.rows;
  };

  beforeAll(async () => {
    const { Client } = await import("pg");
    direct = new Client({ connectionString: DIRECT_URL });
    await direct.connect();

    // Drop RepositoryCases / Steps / join-table outgoing FK constraints so minimal fixture rows
    // insert without a full parent graph (the spike DB seeds none). The audit triggers fire
    // regardless of referential integrity — this is the disposable-spike-DB pattern from Phase 12
    // (lib/audit/__spike__/setLocalPgbouncer.spike.test.ts beforeAll). It does NOT weaken any
    // capture assertion; it only lets the seed produce a real id so the trigger has a row to capture.
    await direct.query(`DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conrelid::regclass::text AS tbl, conname
            FROM pg_constraint
           WHERE contype = 'f'
             AND conrelid IN (
               '"RepositoryCases"'::regclass,
               '"Steps"'::regclass,
               '"_RepositoryCasesToTags"'::regclass,
               '"_IssueToRepositoryCases"'::regclass
             )
        LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname); END LOOP;
      END $$;`);

    // App clients (hooked = prisma; base/raw = prismaBase — both are lib/prisma's hooked client,
    // but the raw $executeRaw / $transaction paths don't fire the entity-audit hooks; capture
    // happens at the DB trigger level). Importing here (not at module top) keeps the file pure for
    // skip. Runtime-built specifiers + /* @vite-ignore */ so Vite's import-analysis can't statically
    // resolve the gucContext module and break clean-skip in the unit lane.
    const prismaMod = "~/lib/prisma";
    const gucMod = "~/lib/audit/gucContext";
    const auditCtxMod = "~/lib/auditContext";
    ({ prisma } = await import(/* @vite-ignore */ prismaMod));
    prismaBase = prisma;
    ({ withAuditGuc, injectAuditGuc } = await import(/* @vite-ignore */ gucMod));
    ({ runWithAuditContext } = await import(/* @vite-ignore */ auditCtxMod));
  }, 60_000);

  afterAll(async () => {
    if (direct) {
      try {
        // Best-effort fixture cleanup so reruns stay scoped.
        for (const token of verificationTokens) {
          await direct.query(`DELETE FROM "VerificationToken" WHERE token = $1`, [token]);
        }
        if (seededCaseId != null) {
          await direct.query(`DELETE FROM "_IssueToRepositoryCases" WHERE "B" = $1`, [seededCaseId]);
          await direct.query(`DELETE FROM "_RepositoryCasesToTags" WHERE "A" = $1`, [seededCaseId]);
          await direct.query(`DELETE FROM "Steps" WHERE "testCaseId" = $1`, [seededCaseId]);
          await direct.query(`DELETE FROM "RepositoryCases" WHERE id = $1`, [seededCaseId]);
        }
      } catch {
        /* best effort */
      }
      await direct.end();
    }
  });

  it("(a) hooked client UPDATE under injected GUC → one U row, changed-only diff, non-null actor (CTX-01)", async () => {
    // Hooked-client path: establish the ALS audit frame (runWithAuditContext), open a $transaction,
    // call injectAuditGuc(tx) as the first statement (it reads userId from the ALS frame), then run
    // the create inside the same tx. This exercises the SHIPPED 13-04 injectAuditGuc(tx) signature.
    //
    // suppressWebhooks: the hooked client also fires the webhook-outbox side-effect (emitCaseUpdated
    // → webhookOutboxEvent.create), which FKs to Projects — a parent the bare spike DB doesn't seed.
    // That outbound-webhook plumbing is unrelated to the CDC capture this test asserts, so we use the
    // sanctioned suppressWebhooks hatch (webhookEvents.emit short-circuits on it). It does NOT touch
    // the GUC payload (injectAuditGuc reads only userId/requestId) nor the DB audit trigger, so the
    // CTX-01 assertion (non-null actor 'actor-a' in the captured row) is fully preserved. The async ES
    // sync error on this path is already swallowed (logged only) by the hook.
    const created = await runWithAuditContext(
      { userId: "actor-a", requestId: "req-a", suppressWebhooks: true },
      () =>
        prisma.$transaction(async (tx: any) => {
          await injectAuditGuc(tx);
          return tx.repositoryCases.create({
            data: {
              name: `${MARKER}-a`,
              projectId: 1,
              repositoryId: 1,
              folderId: 1,
              templateId: 1,
              stateId: 1,
              creatorId: "actor-a",
            },
          });
        }),
    );
    seededCaseId = created.id;

    // Mutate exactly one column (name) and assert the diff carries ONLY that column.
    await runWithAuditContext(
      { userId: "actor-a", requestId: "req-a", suppressWebhooks: true },
      () =>
        prisma.$transaction(async (tx: any) => {
          await injectAuditGuc(tx);
          return tx.repositoryCases.update({
            where: { id: seededCaseId },
            data: { name: `${MARKER}-a-updated` },
          });
        }),
    );

    const rows = await dclRowsByNameMarker("RepositoryCases", "U", `${MARKER}-a-updated`);
    expect(rows).toHaveLength(1);
    expect(rows[0].pk).toBe(String(seededCaseId));
    // changed_cols is { name: { old, new } } and contains ONLY the changed column.
    expect(Object.keys(rows[0].changed_cols)).toEqual(["name"]);
    expect(rows[0].changed_cols.name.new).toBe(`${MARKER}-a-updated`);
    expect(rows[0].changed_cols.name.old).toBe(`${MARKER}-a`);
    // CTX-01: actor is captured from the GUC and is NOT null.
    expect(rows[0].actor).not.toBeNull();
    expect(rows[0].actor).toBe("actor-a");
  });

  it("(b) raw $executeRaw UPDATE bypassing all hooks → one U row with correct diff (SUCCESS CRITERION #1 / COV-01)", async () => {
    // The headline guarantee: a raw SQL UPDATE that NEVER touches a Prisma hook still produces a diff.
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${ctx({ userId: "actor-b" })}, true)`;
      await tx.$executeRawUnsafe(
        `UPDATE "RepositoryCases" SET name = $1 WHERE id = $2`,
        `${MARKER}-b-raw`,
        seededCaseId,
      );
    });

    const rows = await dclRowsByNameMarker("RepositoryCases", "U", `${MARKER}-b-raw`);
    expect(rows).toHaveLength(1);
    expect(rows[0].pk).toBe(String(seededCaseId));
    expect(rows[0].changed_cols.name.new).toBe(`${MARKER}-b-raw`);
  });

  it("(c) createMany on a child table (Steps) → one I row per inserted row (COV-01)", async () => {
    await runWithAuditContext({ userId: "actor-c", requestId: "req-c" }, () =>
      prisma.$transaction(async (tx: any) => {
        await injectAuditGuc(tx);
        return tx.steps.createMany({
          data: [
            { testCaseId: seededCaseId, order: 1 },
            { testCaseId: seededCaseId, order: 2 },
          ],
        });
      }),
    );

    const r = await direct.query(
      `SELECT op FROM "DataChangeLog"
        WHERE "table" = 'Steps' AND op = 'I' AND changed_cols->'testCaseId'->>'new' = $1`,
      [String(seededCaseId)],
    );
    // Bulk createMany must yield one INSERT row per inserted child (the trigger is per-row).
    expect(r.rows).toHaveLength(2);
  });

  it("(d) worker/raw path via withAuditGuc → row stamped with payload.userId as actor (CTX-02)", async () => {
    await withAuditGuc(
      prismaBase,
      { userId: "worker-actor-d", requestId: "req-d", source: "worker", tenantId: "tenant-d" },
      async (tx) => {
        await tx.$executeRawUnsafe(
          `UPDATE "RepositoryCases" SET name = $1 WHERE id = $2`,
          `${MARKER}-d-worker`,
          seededCaseId,
        );
      },
    );

    const rows = await dclRowsByNameMarker("RepositoryCases", "U", `${MARKER}-d-worker`);
    expect(rows).toHaveLength(1);
    // CTX-02: the worker payload's userId lands in the actor column.
    expect(rows[0].actor).toBe("worker-actor-d");
  });

  it("(e) TAG join-table _RepositoryCasesToTags INSERT then DELETE → I then D keyed by column A (COV-02)", async () => {
    // _RepositoryCasesToTags: A = RepositoryCases.id, B = Tags.id (alphabetical RepositoryCases < Tags).
    // Use a seeded tag (id 1) and our case; pk in DataChangeLog is the "A" side (RepositoryCases.id).
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${ctx({ userId: "actor-e" })}, true)`;
      await tx.$executeRawUnsafe(
        `INSERT INTO "_RepositoryCasesToTags" ("A", "B") VALUES ($1, 1)`,
        seededCaseId,
      );
    });
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${ctx({ userId: "actor-e" })}, true)`;
      await tx.$executeRawUnsafe(
        `DELETE FROM "_RepositoryCasesToTags" WHERE "A" = $1 AND "B" = 1`,
        seededCaseId,
      );
    });

    const inserts = await dclRowsByPk("_RepositoryCasesToTags", "I", String(seededCaseId));
    const deletes = await dclRowsByPk("_RepositoryCasesToTags", "D", String(seededCaseId));
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(deletes.length).toBeGreaterThanOrEqual(1);
  });

  it("(e2) ISSUE-link join-table _IssueToRepositoryCases INSERT then DELETE → I then D keyed by column A (COV-02)", async () => {
    // _IssueToRepositoryCases (CONFIRMED production name): A = Issue.id, B = RepositoryCases.id.
    // The pk in DataChangeLog is the "A" side (Issue.id) → proves coverage extends past tag links
    // to the issue link tables. ALL 9 implicit m2m join tables are in the 13-03 registry (full
    // production coverage); this test exercises only the representative tag + issue patterns. The
    // 2 ASSUMED-name join tables (_SessionsToTags / _TagsToTestRuns) are verified by the 13-03
    // Wave 0 checkpoint, NOT by this test.
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${ctx({ userId: "actor-e2" })}, true)`;
      await tx.$executeRawUnsafe(
        `INSERT INTO "_IssueToRepositoryCases" ("A", "B") VALUES (1, $1)`,
        seededCaseId,
      );
    });
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${ctx({ userId: "actor-e2" })}, true)`;
      await tx.$executeRawUnsafe(
        `DELETE FROM "_IssueToRepositoryCases" WHERE "A" = 1 AND "B" = $1`,
        seededCaseId,
      );
    });

    // pk = "A" = Issue.id = "1".
    const inserts = await dclRowsByPk("_IssueToRepositoryCases", "I", "1");
    const deletes = await dclRowsByPk("_IssueToRepositoryCases", "D", "1");
    expect(inserts.length).toBeGreaterThanOrEqual(1);
    expect(deletes.length).toBeGreaterThanOrEqual(1);
  });

  it("(f) SAF-01 HATCH: set_config('app.skip_audit','true',true) first in a tx → ZERO DataChangeLog rows", async () => {
    // The bulk-import escape hatch: the trigger early-returns when skip_audit is set as the FIRST
    // statement of the transaction, so a mutation on an allowlisted table captures NOTHING.
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.skip_audit', 'true', true)`;
      await tx.$executeRawUnsafe(
        `UPDATE "RepositoryCases" SET name = $1 WHERE id = $2`,
        `${MARKER}-f-skipped`,
        seededCaseId,
      );
    });

    const rows = await dclRowsByNameMarker("RepositoryCases", "U", `${MARKER}-f-skipped`);
    // SAF-01: ZERO rows for the skip-marked mutation.
    expect(rows).toHaveLength(0);
  });

  it("(g) SAF-04 NEGATIVE: a write to the excluded credential table VerificationToken → ZERO DataChangeLog rows", async () => {
    // VerificationToken has NO FK parents (only scalars identifier/token/expires), so the INSERT
    // cannot throw on a missing parent — it cleanly asserts zero capture. ApiToken is deliberately
    // NOT used here: its FK-parent requirements would make the fixture INSERT throw instead.
    const token = `${MARKER}-g-token`;
    verificationTokens.push(token);
    await prismaBase.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.audit_context', ${ctx({ userId: "actor-g" })}, true)`;
      await tx.$executeRawUnsafe(
        `INSERT INTO "VerificationToken" (identifier, token, expires) VALUES ($1, $2, now() + interval '1 day')`,
        `${MARKER}-g-id`,
        token,
      );
    });

    const r = await direct.query(
      `SELECT count(*)::int AS n FROM "DataChangeLog" WHERE "table" = 'VerificationToken' AND pk = $1`,
      [token],
    );
    // SAF-04: the credential table is excluded — no audit row exists for it.
    expect(r.rows[0].n).toBe(0);
  });
});
