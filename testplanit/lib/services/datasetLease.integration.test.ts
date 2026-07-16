/**
 * Live-DB integration test for the DataSetRow lease raw-SQL primitives
 * (999.12). The atomic claim uses `FOR UPDATE SKIP LOCKED` + `make_interval`
 * and the release/extend paths use data-modifying CTEs — none of which the
 * ORM can express, so a mocked-tx unit test cannot catch a column-name typo
 * or a Postgres syntax error. This exercises them against a real
 * `baseDb.$transaction` (per the repo rule: raw helpers need ≥1 live-DB test).
 *
 * Execution model mirrors iterationFanOut.shared.integration.test.ts:
 *   - Skipped by default; opt-in with `RUN_DB_INTEGRATION=1` + `DATABASE_URL`.
 *   - Every test runs inside a `baseDb.$transaction` forced to roll back, so
 *     the database is never mutated. Sequential claims within one tx already
 *     prove "next free row" ordering + leased-row skipping; the cross-session
 *     no-double-claim guarantee is a `FOR UPDATE SKIP LOCKED` property of
 *     Postgres itself and is not re-verified here.
 */

import { describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("DataSetRow lease primitives (live DB)", () => {
  const importDeps = async () => {
    const { baseDb } = await import("~/lib/db");
    const lease = await import("./datasetLease");
    return { baseDb, ...lease };
  };

  const ROLLBACK_SENTINEL = "__DATASET_LEASE_TEST_ROLLBACK__";

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

  /** Seed a project + shared dataset with `rowCount` rows (rowIndex 0..n-1). */
  async function seedDataset(tx: any, rowCount: number) {
    const creator = await tx.user.findFirst({ select: { id: true } });
    if (!creator) throw new Error("No User row available — seed the DB first");

    const project = await tx.projects.create({
      data: {
        name: `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdBy: creator.id,
      },
      select: { id: true },
    });
    const dataSet = await tx.dataSet.create({
      data: {
        projectId: project.id,
        name: `pool-${Date.now()}`,
        isShared: true,
        createdById: creator.id,
      },
      select: { id: true },
    });
    for (let i = 0; i < rowCount; i++) {
      await tx.dataSetRow.create({
        data: {
          dataSetId: dataSet.id,
          rowIndex: i,
          label: `row-${i}`,
          valuesJson: { seat: i },
        },
      });
    }
    return {
      creatorId: creator.id,
      projectId: project.id,
      dataSetId: dataSet.id,
    };
  }

  const readRow = (tx: any, rowId: number) =>
    tx.dataSetRow.findUnique({
      where: { id: rowId },
      select: { rowIndex: true, leaseToken: true, leaseExpiresAt: true },
    });

  it("claims the lowest-rowIndex free row and exhausts the pool", async () => {
    const { baseDb, acquireNextRow, mintLeaseToken } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { creatorId, dataSetId } = await seedDataset(tx, 3);

      const claims = [];
      for (let i = 0; i < 3; i++) {
        const row = await acquireNextRow(tx, {
          dataSetId,
          userId: creatorId,
          ttlSeconds: 300,
          leaseToken: mintLeaseToken(),
        });
        claims.push(row);
      }
      // Distinct rows, ascending rowIndex.
      expect(claims.map((c: any) => c?.rowIndex)).toEqual([0, 1, 2]);
      // Distinct tokens minted per acquire.
      expect(new Set(claims.map((c: any) => c?.leaseToken)).size).toBe(3);
      // valuesJson is returned to the holder.
      expect(claims[0]?.valuesJson).toEqual({ seat: 0 });

      // Pool exhausted → null.
      const none = await acquireNextRow(tx, {
        dataSetId,
        userId: creatorId,
        ttlSeconds: 300,
        leaseToken: mintLeaseToken(),
      });
      expect(none).toBeNull();
    });
  });

  it("reclaims an expired lease (lazy expiry) ahead of a never-leased higher index", async () => {
    const { baseDb, acquireNextRow, mintLeaseToken } = await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { creatorId, dataSetId } = await seedDataset(tx, 2);

      const first = await acquireNextRow(tx, {
        dataSetId,
        userId: creatorId,
        ttlSeconds: 300,
        leaseToken: mintLeaseToken(),
      });
      expect(first?.rowIndex).toBe(0);

      // Force row 0's lease into the past.
      await tx.$executeRaw`
        UPDATE "DataSetRow" SET "leaseExpiresAt" = now() - interval '1 hour'
        WHERE "id" = ${first!.id}
      `;

      // Next acquire reclaims row 0 (expired == free, lowest rowIndex) rather
      // than the never-leased row 1.
      const reclaimed = await acquireNextRow(tx, {
        dataSetId,
        userId: creatorId,
        ttlSeconds: 300,
        leaseToken: mintLeaseToken(),
      });
      expect(reclaimed?.rowIndex).toBe(0);
    });
  });

  it("releases only with the matching token (or admin) and is idempotent", async () => {
    const { baseDb, acquireNextRow, releaseRow, mintLeaseToken } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { creatorId, dataSetId } = await seedDataset(tx, 1);
      const token = mintLeaseToken();
      const row = await acquireNextRow(tx, {
        dataSetId,
        userId: creatorId,
        ttlSeconds: 300,
        leaseToken: token,
      });

      // Wrong token → conflict; row stays leased.
      const wrong = await releaseRow(tx, {
        dataSetId,
        rowId: row!.id,
        leaseToken: "not-the-token",
        isAdmin: false,
      });
      expect(wrong.status).toBe("conflict");
      expect((await readRow(tx, row!.id)).leaseToken).not.toBeNull();

      // Correct token → released; columns cleared.
      const ok = await releaseRow(tx, {
        dataSetId,
        rowId: row!.id,
        leaseToken: token,
        isAdmin: false,
      });
      expect(ok.status).toBe("released");
      expect((await readRow(tx, row!.id)).leaseToken).toBeNull();

      // Second release → idempotent not_leased.
      const again = await releaseRow(tx, {
        dataSetId,
        rowId: row!.id,
        leaseToken: token,
        isAdmin: false,
      });
      expect(again.status).toBe("not_leased");
    });
  });

  it("admin can force-release a row held by another token", async () => {
    const { baseDb, acquireNextRow, releaseRow, mintLeaseToken } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { creatorId, dataSetId } = await seedDataset(tx, 1);
      const row = await acquireNextRow(tx, {
        dataSetId,
        userId: creatorId,
        ttlSeconds: 300,
        leaseToken: mintLeaseToken(),
      });
      const forced = await releaseRow(tx, {
        dataSetId,
        rowId: row!.id,
        leaseToken: null,
        isAdmin: true,
      });
      expect(forced.status).toBe("released");
    });
  });

  it("extends a live lease and refuses to revive an expired one", async () => {
    const { baseDb, acquireNextRow, extendLease, mintLeaseToken } =
      await importDeps();
    await withRollback(baseDb, async (tx) => {
      const { creatorId, dataSetId } = await seedDataset(tx, 1);
      const token = mintLeaseToken();
      const row = await acquireNextRow(tx, {
        dataSetId,
        userId: creatorId,
        ttlSeconds: 60,
        leaseToken: token,
      });
      const before = (await readRow(tx, row!.id)).leaseExpiresAt as Date;

      const extended = await extendLease(tx, {
        dataSetId,
        rowId: row!.id,
        leaseToken: token,
        ttlSeconds: 3600,
        isAdmin: false,
      });
      expect(extended.status).toBe("extended");
      const after = (await readRow(tx, row!.id)).leaseExpiresAt as Date;
      expect(after.getTime()).toBeGreaterThan(before.getTime());

      // Force expiry, then extend → must fail closed (re-acquire required).
      await tx.$executeRaw`
        UPDATE "DataSetRow" SET "leaseExpiresAt" = now() - interval '1 hour'
        WHERE "id" = ${row!.id}
      `;
      const expired = await extendLease(tx, {
        dataSetId,
        rowId: row!.id,
        leaseToken: token,
        ttlSeconds: 3600,
        isAdmin: false,
      });
      expect(expired.status).toBe("expired");
    });
  });
});
