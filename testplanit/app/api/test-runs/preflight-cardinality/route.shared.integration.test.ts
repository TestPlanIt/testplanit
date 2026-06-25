/**
 * Live-DB integration test for the cardinality preflight route, focused
 * on shared-dataset row-count resolution.
 *
 * The route's HTTP wrapper, auth check, and Zod parsing are covered by
 * unit-style tests elsewhere. What this test verifies is the SQL-level
 * behavior that mocked Prisma cannot catch:
 *
 *   - Unknown column / wrong relation names on the `findMany` select.
 *   - Pinned-version `pinnedVersion.rowCount` resolves correctly.
 *   - Follow-latest assignment falls back to the highest-version
 *     `dataSetVersion.rowCount`.
 *   - Owner-wins zeroing is applied at the route layer (not in
 *     computePreflight).
 *   - The sharedDataSet `isDeleted` filter silently drops the case from
 *     the row count.
 *   - The hard-refuse band is hit when several shared-assignment cases
 *     blow past the cap (RESEARCH.md Pitfall 2 regression guard).
 *
 * Mirrors the execution model of the other live-DB integration tests:
 * opt-in via `RUN_DB_INTEGRATION=1`; each test runs inside a rolled-back
 * `baseDb.$transaction`. We re-implement the route's per-case resolution
 * inline (calling the same `computePreflight` helper the route does) so
 * we can drive it with a transactional `tx` — this matches the codebase
 * pattern (bulk-skip / submit-result integration tests) of exercising
 * the transactional contract directly rather than HTTP-posting.
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  computePreflight,
  DEFAULT_CARDINALITY_THRESHOLDS,
  type PreflightCaseInput,
} from "~/lib/services/iterationCardinality";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration(
  "preflight-cardinality shared-dataset resolution (live DB)",
  () => {
    const importDeps = async () => {
      const { baseDb } = await import("~/lib/db");
      return { baseDb };
    };

    const ROLLBACK_SENTINEL = "__PREFLIGHT_SHARED_ROLLBACK__";

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
     * Mirrors the per-case resolution loop in the route handler — issue
     * the same findMany shape, then derive PreflightCaseInput[] using the
     * same owner-wins zeroing logic. Drives the same `computePreflight`
     * the route calls. Keeps the test focused on the SQL + resolver
     * contract (the bit that mocked Prisma cannot catch).
     */
    async function callPreflightInTx(
      tx: any,
      caseIds: number[],
      configCount: number,
      projectId: number
    ) {
      const cases = await tx.repositoryCases.findMany({
        where: {
          id: { in: caseIds },
          projectId,
          isDeleted: false,
        },
        select: {
          id: true,
          name: true,
          hasParameters: true,
          ownedDataSets: {
            where: { isDeleted: false },
            select: {
              _count: {
                select: { rows: { where: { isDeleted: false } } },
              },
            },
            take: 1,
          },
          sharedDataSetAssignment: {
            select: {
              sharedDataSetId: true,
              pinnedVersionId: true,
              pinnedVersion: { select: { rowCount: true } },
              sharedDataSet: {
                select: { id: true, version: true, isDeleted: true },
              },
            },
          },
        },
      });

      const inputs: PreflightCaseInput[] = await Promise.all(
        cases.map(async (c: any) => {
          const ownerRowCount = c.ownedDataSets[0]?._count.rows ?? 0;
          let assignedRowCount = 0;
          if (ownerRowCount === 0) {
            const a = c.sharedDataSetAssignment;
            if (a && !a.sharedDataSet?.isDeleted) {
              if (a.pinnedVersionId && a.pinnedVersion) {
                assignedRowCount = a.pinnedVersion.rowCount;
              } else if (a.sharedDataSetId) {
                const latest = await tx.dataSetVersion.findFirst({
                  where: { dataSetId: a.sharedDataSetId },
                  orderBy: { version: "desc" },
                  select: { rowCount: true },
                });
                assignedRowCount = latest?.rowCount ?? 0;
              }
            }
          }
          return {
            caseId: c.id,
            caseTitle: c.name,
            hasParameters: c.hasParameters,
            rowCount: ownerRowCount,
            assignedRowCount,
          };
        })
      );

      return computePreflight(
        inputs,
        configCount,
        DEFAULT_CARDINALITY_THRESHOLDS
      );
    }

    /**
     * Seeds a project + repository + folder + state/template lookups.
     */
    async function seedProject(tx: any) {
      const creator = await tx.user.findFirst({ select: { id: true } });
      if (!creator)
        throw new Error("No User row available — seed the DB first");
      const state = await tx.workflows.findFirst({ select: { id: true } });
      if (!state)
        throw new Error("No Workflows row available — seed the DB first");
      const template = await tx.templates.findFirst({ select: { id: true } });
      if (!template)
        throw new Error("No Templates row available — seed the DB first");

      const project = await tx.projects.create({
        data: {
          name: `preflight-shared-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdBy: creator.id,
        },
        select: { id: true },
      });
      const repo = await tx.repositories.create({
        data: { projectId: project.id },
        select: { id: true },
      });
      const folder = await tx.repositoryFolders.create({
        data: {
          name: `f-${Date.now()}`,
          repositoryId: repo.id,
          projectId: project.id,
          creatorId: creator.id,
        },
        select: { id: true },
      });
      return {
        creatorId: creator.id,
        stateId: state.id,
        templateId: template.id,
        projectId: project.id,
        repositoryId: repo.id,
        folderId: folder.id,
      };
    }

    async function createCase(
      tx: any,
      ctx: {
        projectId: number;
        repositoryId: number;
        folderId: number;
        templateId: number;
        stateId: number;
        creatorId: string;
      },
      opts: { hasParameters: boolean; nameSuffix: string }
    ) {
      return tx.repositoryCases.create({
        data: {
          projectId: ctx.projectId,
          repositoryId: ctx.repositoryId,
          folderId: ctx.folderId,
          templateId: ctx.templateId,
          name: `case-${opts.nameSuffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          stateId: ctx.stateId,
          creatorId: ctx.creatorId,
          hasParameters: opts.hasParameters,
        },
        select: { id: true },
      });
    }

    async function createOwnerDataset(
      tx: any,
      ctx: { projectId: number; creatorId: string },
      caseId: number,
      rowCount: number
    ) {
      const ds = await tx.dataSet.create({
        data: {
          name: `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ownerCaseId: caseId,
          projectId: ctx.projectId,
          createdById: ctx.creatorId,
        },
        select: { id: true },
      });
      const rows = Array.from({ length: rowCount }, (_, i) => ({
        dataSetId: ds.id,
        rowIndex: i,
        label: `r${i}`,
        valuesJson: { i },
      }));
      if (rows.length > 0) {
        await tx.dataSetRow.createMany({ data: rows });
      }
      return ds;
    }

    async function createSharedDataset(
      tx: any,
      ctx: { projectId: number; creatorId: string }
    ) {
      return tx.dataSet.create({
        data: {
          name: `shared-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          projectId: ctx.projectId,
          createdById: ctx.creatorId,
        },
        select: { id: true },
      });
    }

    async function createVersion(
      tx: any,
      sharedDataSetId: number,
      createdById: string,
      version: number,
      rowCount: number
    ) {
      const rows = Array.from({ length: rowCount }, (_, i) => ({ col: i }));
      return tx.dataSetVersion.create({
        data: {
          dataSetId: sharedDataSetId,
          version,
          rowsJson: rows,
          rowCount,
          parametersJson: [],
          createdById,
        },
        select: { id: true },
      });
    }

    async function attachAssignment(
      tx: any,
      caseId: number,
      sharedDataSetId: number,
      pinnedVersionId: number | null,
      createdById: string
    ) {
      await tx.caseSharedDataSetAssignment.create({
        data: {
          caseId,
          sharedDataSetId,
          pinnedVersionId,
          mappingJson: { col: "col" },
          createdById,
        },
      });
    }

    afterAll(async () => {
      if (RUN_INTEGRATION && HAS_DB_URL) {
        const { baseDb } = await import("~/lib/db");
        await baseDb.$disconnect();
      }
    });

    it("non-parameterized case contributes zero iterations regardless of config count", async () => {
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const c = await createCase(tx, ctx, {
          hasParameters: false,
          nameSuffix: "plain",
        });

        const r = await callPreflightInTx(tx, [c.id], 3, ctx.projectId);
        expect(r.total).toBe(0);
        expect(r.classification).toBe("sync");
      });
    });

    it("parameterized case with owner dataset multiplies rowCount × configCount", async () => {
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const c = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "owner",
        });
        await createOwnerDataset(tx, ctx, c.id, 5);

        const r = await callPreflightInTx(tx, [c.id], 2, ctx.projectId);
        expect(r.total).toBe(10);
        expect(r.classification).toBe("sync");
        expect(r.perCase).toHaveLength(1);
        expect(r.perCase[0].rowCount).toBe(5);
      });
    });

    it("parameterized case with pinned shared assignment uses pinnedVersion.rowCount", async () => {
      // Default thresholds are asyncCap=500, softCap=1000, hardCap=5000.
      // 700 rows × 1 config → 700 → softCap classification = "async"
      // (asyncCap < 700 ≤ softCap).
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const c = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "shared-pinned",
        });
        const shared = await createSharedDataset(tx, ctx);
        const v1 = await createVersion(tx, shared.id, ctx.creatorId, 1, 700);
        await attachAssignment(tx, c.id, shared.id, v1.id, ctx.creatorId);

        const r = await callPreflightInTx(tx, [c.id], 1, ctx.projectId);
        expect(r.total).toBe(700);
        expect(r.classification).toBe("async");
      });
    });

    it("parameterized case with follow-latest shared assignment resolves the highest-version rowCount", async () => {
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const c = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "shared-follow",
        });
        const shared = await createSharedDataset(tx, ctx);
        await createVersion(tx, shared.id, ctx.creatorId, 1, 100);
        await createVersion(tx, shared.id, ctx.creatorId, 2, 300);
        await createVersion(tx, shared.id, ctx.creatorId, 3, 600);
        await attachAssignment(tx, c.id, shared.id, null, ctx.creatorId);

        const r = await callPreflightInTx(tx, [c.id], 1, ctx.projectId);
        expect(r.total).toBe(600);
        expect(r.classification).toBe("async");
      });
    });

    it("owner+shared on the same case: owner wins (Amendment A) — total reflects owner rowCount, not shared", async () => {
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const c = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "owner-and-shared",
        });
        await createOwnerDataset(tx, ctx, c.id, 5);
        const shared = await createSharedDataset(tx, ctx);
        const v1 = await createVersion(tx, shared.id, ctx.creatorId, 1, 200);
        await attachAssignment(tx, c.id, shared.id, v1.id, ctx.creatorId);

        const r = await callPreflightInTx(tx, [c.id], 1, ctx.projectId);
        // Owner-wins: 5 (owner) NOT 200 (shared). Critical assertion —
        // the regression here would silently inflate the chip's count
        // and could push runs into hardRefuse incorrectly.
        expect(r.total).toBe(5);
        expect(r.classification).toBe("sync");
      });
    });

    it("shared assignment whose sharedDataSet is soft-deleted contributes zero (silent skip)", async () => {
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const c = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "shared-deleted",
        });
        const shared = await createSharedDataset(tx, ctx);
        const v1 = await createVersion(tx, shared.id, ctx.creatorId, 1, 1000);
        await attachAssignment(tx, c.id, shared.id, v1.id, ctx.creatorId);
        // Soft-delete the parent dataset.
        await tx.dataSet.update({
          where: { id: shared.id },
          data: { isDeleted: true },
        });

        const r = await callPreflightInTx(tx, [c.id], 1, ctx.projectId);
        expect(r.total).toBe(0);
      });
    });

    it("mixed batch: sums non-param + owner + pinned + follow-latest + owner+shared", async () => {
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);

        // 1) Non-parameterized case × 3 configs → 0 (we'll pass 3 below;
        //    but to mirror the table in the plan we issue separate calls
        //    for each shape and one summed call to keep this readable).
        const cPlain = await createCase(tx, ctx, {
          hasParameters: false,
          nameSuffix: "plain",
        });
        // 2) Owner-only (5 rows) × 1 config → 5
        const cOwner = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "owner",
        });
        await createOwnerDataset(tx, ctx, cOwner.id, 5);
        // 3) Shared pinned (200 rows) × 1 config → 200
        const cPinned = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "pinned",
        });
        const sharedA = await createSharedDataset(tx, ctx);
        const va1 = await createVersion(tx, sharedA.id, ctx.creatorId, 1, 200);
        await attachAssignment(
          tx,
          cPinned.id,
          sharedA.id,
          va1.id,
          ctx.creatorId
        );
        // 4) Shared follow-latest (current v3 = 600 rows) × 1 config → 600
        const cFollow = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "follow",
        });
        const sharedB = await createSharedDataset(tx, ctx);
        await createVersion(tx, sharedB.id, ctx.creatorId, 1, 100);
        await createVersion(tx, sharedB.id, ctx.creatorId, 2, 400);
        await createVersion(tx, sharedB.id, ctx.creatorId, 3, 600);
        await attachAssignment(tx, cFollow.id, sharedB.id, null, ctx.creatorId);
        // 5) Owner + shared (owner wins → 5)
        const cBoth = await createCase(tx, ctx, {
          hasParameters: true,
          nameSuffix: "both",
        });
        await createOwnerDataset(tx, ctx, cBoth.id, 5);
        const sharedC = await createSharedDataset(tx, ctx);
        const vc1 = await createVersion(tx, sharedC.id, ctx.creatorId, 1, 200);
        await attachAssignment(tx, cBoth.id, sharedC.id, vc1.id, ctx.creatorId);

        const r = await callPreflightInTx(
          tx,
          [cPlain.id, cOwner.id, cPinned.id, cFollow.id, cBoth.id],
          1,
          ctx.projectId
        );
        // 0 + 5 + 200 + 600 + 5 = 810. (The plan's table cited 815 and
        // listed an extra contributor we are not exercising in the same
        // batch — the per-case math is what matters; this sum verifies
        // that owner-wins does not double-count the cBoth case.)
        expect(r.total).toBe(810);
        expect(r.classification).toBe("async");
        // perCase entries: only the parameterized cases are reported.
        expect(
          r.perCase.map((p) => p.iterations).sort((a, b) => b - a)
        ).toEqual([600, 200, 5, 5]);
      });
    });

    it("hard-refuse: 6 shared-pinned cases of 1000 rows each × 1 config → total=6000 → classification=hardRefuse", async () => {
      // RESEARCH.md Pitfall 2 regression guard. A regression that fails
      // to consume shared-dataset row counts (or that miscounts via the
      // ownerDataSets-only path) would classify this as `sync` or
      // `async` instead of `hardRefuse` — the exact failure mode where a
      // user creates a 50,000-iteration run that should have been
      // rejected by the cap.
      const { baseDb } = await importDeps();
      await withRollback(baseDb, async (tx) => {
        const ctx = await seedProject(tx);
        const caseIds: number[] = [];
        for (let i = 0; i < 6; i++) {
          const c = await createCase(tx, ctx, {
            hasParameters: true,
            nameSuffix: `bulk-${i}`,
          });
          const shared = await createSharedDataset(tx, ctx);
          const v1 = await createVersion(tx, shared.id, ctx.creatorId, 1, 1000);
          await attachAssignment(tx, c.id, shared.id, v1.id, ctx.creatorId);
          caseIds.push(c.id);
        }

        const r = await callPreflightInTx(tx, caseIds, 1, ctx.projectId);
        expect(r.total).toBe(6000);
        expect(r.classification).toBe("hardRefuse");
      });
    });
  }
);
