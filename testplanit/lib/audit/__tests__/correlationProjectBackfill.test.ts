/**
 * Project-scope backfill for materialized CDC rows (lib/audit/correlation).
 *
 * BUG: a child/value/join row carries no project of its own — the trigger reads
 * `project_id` from the row's configured projectCol or the GUC subject, and those
 * tables declare neither. It therefore depends on the owning root row's snapshot
 * being present in the SAME operation. When the owner was written by an EARLIER
 * request (a reporter adding cases to a run it created minutes ago; a tag applied
 * to an existing case) no snapshot exists, so the AuditLog row landed with a null
 * projectId and vanished from the project audit log. `Attachments` never resolved
 * at all: no projectId column, no projectCol, and absent from ROLLUP_MAP.
 *
 * FIX: backfillProjectIds resolves the gap from the owning row's live project —
 * sound because an entity never moves between projects, unlike `entityName`,
 * which keeps its write-time snapshot. Batched one query per owning table.
 */
import { describe, expect, it, vi } from "vitest";

import { backfillProjectIds, type MaterializedRow } from "../correlation";

/** A materialized row with the fields the backfill reads; the rest are inert. */
function row(over: Partial<MaterializedRow>): MaterializedRow {
  return {
    sourceRowId: 1,
    sourceTable: "TestRunCases",
    op: "I",
    entityType: "TestRuns",
    entityId: "7",
    action: "CREATE",
    actor: "u1",
    userName: null,
    userEmail: null,
    entityName: null,
    projectId: null,
    operationId: "op-1",
    tenant: null,
    changes: {},
    ...over,
  };
}

/**
 * Raw-client fake that answers the two SQL shapes the backfill issues: the
 * per-owner-table `SELECT id, "projectId" FROM "<table>"` and the multi-join
 * attachment resolver. Records every statement so batching can be asserted.
 */
function makeTx(data: {
  /** table -> (id -> projectId) */
  owners?: Record<string, Record<string, number>>;
  /** attachment id -> projectId */
  attachments?: Record<string, number>;
}) {
  const queries: Array<{ sql: string; params: unknown }> = [];
  // Postgres returns an integer pk as a number and a text pk as a string; the
  // fake mirrors that so a cast/coercion mismatch surfaces here.
  const asPk = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
  const $queryRawUnsafe = vi.fn(async (sql: string, params: unknown) => {
    queries.push({ sql, params });
    const ids = (params as Array<number | string>).map(String);
    if (sql.includes('FROM "Attachments" a')) {
      return ids
        .filter((id) => data.attachments?.[id] != null)
        .map((id) => ({ id: asPk(id), projectId: data.attachments![id] }));
    }
    const table = /FROM "([A-Za-z]+)"/.exec(sql)?.[1] ?? "";
    const rows = data.owners?.[table] ?? {};
    return ids
      .filter((id) => rows[id] != null)
      .map((id) => ({ id: asPk(id), projectId: rows[id] }));
  });
  const tx = {
    $queryRawUnsafe,
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  };
  return { tx: tx as never, queries };
}

describe("backfillProjectIds", () => {
  it("scopes a rolled-up child from its owning run's live project", async () => {
    const rows = [
      row({
        sourceTable: "TestRunCases",
        entityType: "TestRuns",
        entityId: "7",
      }),
    ];
    const { tx } = makeTx({ owners: { TestRuns: { "7": 42 } } });

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBe("42");
  });

  it("leaves the write-time entityName snapshot alone", async () => {
    const rows = [row({ entityName: "Run as it was named then" })];
    const { tx } = makeTx({ owners: { TestRuns: { "7": 42 } } });

    await backfillProjectIds(tx, rows);

    expect(rows[0].entityName).toBe("Run as it was named then");
  });

  it("never overwrites a project the capture substrate already recorded", async () => {
    const rows = [row({ projectId: "5" })];
    const { tx, queries } = makeTx({ owners: { TestRuns: { "7": 42 } } });

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBe("5");
    expect(queries).toHaveLength(0);
  });

  it("issues ONE query per owning table for the whole batch, not per row", async () => {
    const rows = [
      row({ entityType: "TestRuns", entityId: "7" }),
      row({ entityType: "TestRuns", entityId: "8" }),
      row({ entityType: "TestRuns", entityId: "7" }),
      row({ entityType: "RepositoryCases", entityId: "3" }),
    ];
    const { tx, queries } = makeTx({
      owners: { TestRuns: { "7": 42, "8": 43 }, RepositoryCases: { "3": 9 } },
    });

    await backfillProjectIds(tx, rows);

    expect(queries).toHaveLength(2);
    // Repeated owner ids are de-duplicated before the lookup.
    expect(queries.find((q) => q.sql.includes('"TestRuns"'))?.params).toEqual([
      7, 8,
    ]);
    expect(rows.map((r) => r.projectId)).toEqual(["42", "43", "42", "9"]);
  });

  it("resolves an attachment through whichever parent it hangs off", async () => {
    const rows = [
      row({
        sourceTable: "Attachments",
        entityType: "Attachments",
        entityId: "900",
        entityName: "failure.png",
      }),
    ];
    const { tx, queries } = makeTx({ attachments: { "900": 77 } });

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBe("77");
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('FROM "Attachments" a');
  });

  it("scopes a Projects row from its own id without querying", async () => {
    const rows = [row({ entityType: "Projects", entityId: "31" })];
    const { tx, queries } = makeTx({});

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBe("31");
    expect(queries).toHaveLength(0);
  });

  it("leaves a global entity unscoped and unqueried", async () => {
    const rows = [
      row({ sourceTable: "User", entityType: "User", entityId: "u1" }),
    ];
    const { tx, queries } = makeTx({});

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("leaves the row unscoped when the owner has been hard-deleted", async () => {
    const rows = [row({ entityType: "TestRuns", entityId: "7" })];
    const { tx } = makeTx({ owners: { TestRuns: {} } });

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBeNull();
  });

  it("skips synthetic (non-numeric) entity ids", async () => {
    const rows = [
      row({ entityType: "TestRuns", entityId: "bulk-1781877884025" }),
    ];
    const { tx, queries } = makeTx({});

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("resolves a text-primary-key owner with a text array cast", async () => {
    // ReviewRequest / ProjectIntegration / WebhookConfig / Comment have cuid pks:
    // an int cast would error and a numeric-only guard would skip them silently.
    const rows = [
      row({
        sourceTable: "ReviewRequest",
        entityType: "ReviewRequest",
        entityId: "cmqffq5ij0005",
      }),
    ];
    const { tx, queries } = makeTx({
      owners: { ReviewRequest: { cmqffq5ij0005: 64 } },
    });

    await backfillProjectIds(tx, rows);

    expect(rows[0].projectId).toBe("64");
    expect(queries[0].sql).toContain("$1::text[]");
    expect(queries[0].params).toEqual(["cmqffq5ij0005"]);
  });

  it("skips composite and synthetic ids on a text-primary-key owner", async () => {
    const rows = [
      row({ entityType: "ReviewRequest", entityId: "5:390" }),
      row({ entityType: "ReviewRequest", entityId: "bulk-17818778" }),
    ];
    const { tx, queries } = makeTx({});

    await backfillProjectIds(tx, rows);

    expect(rows.map((r) => r.projectId)).toEqual([null, null]);
    expect(queries).toHaveLength(0);
  });
});
