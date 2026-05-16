/**
 * Live-DB route-layer integration test for cross-project denial across all
 * matrix endpoints.
 *
 * Complements the helper-layer test in
 * `testplanit/lib/matrix/matrixAggregation.shared.integration.test.ts`.
 * That test proves the SQL `WHERE projectId` bound is honored by the
 * aggregator helper. This test proves the `getEnhancedDb` project read-gate
 * short-circuits the route BEFORE any raw SQL runs — a separate, defense-
 * in-depth seam.
 *
 * Setup: two projects A and B in the same tenant; user U_A is a creator of
 * project A only, user U_B is a creator of project B only. Each project has
 * `defaultAccessType: SPECIFIC_ROLE` + `defaultRoleId: null` so the blanket
 * GLOBAL_ROLE read grant does NOT apply — only the creator can read each
 * project. Belt-and-suspenders: an explicit `NO_ACCESS` UserProjectPermission
 * is also set for the cross-project user.
 *
 * Endpoints under test:
 *   - POST /api/projects/[projectId]/matrix/aggregate
 *   - POST /api/projects/[projectId]/matrix/cell-count
 *   - GET  /api/projects/[projectId]/matrix/export
 *   - POST /api/report-builder/iteration-matrix
 *
 * The rollback-on-transaction pattern used by the helper-level integration
 * test does NOT work here because the route handler calls `getEnhancedDb`
 * which fetches the user via the OUTER `prisma` client — a freshly created
 * transactional user is invisible to the outer client until commit, but we
 * never commit. Instead this test creates committed test data in
 * `beforeAll` and explicitly cleans it up in `afterAll`.
 *
 * Skipped by default; opt-in with `RUN_DB_INTEGRATION=1`.
 */

import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

// `next-auth` + `~/server/auth` are stubbed so we can swap the session user
// per-test without going through the actual sign-in flow. The enhanced DB
// + Prisma + route handlers all run live against the test DB.
const getServerSessionMock = vi.fn();
vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

describeIntegration(
  "matrix routes — cross-project denial (live DB, route layer)",
  () => {
    const importDeps = async () => {
      const { prisma } = await import("~/lib/prisma");
      const aggregateRoute = await import("./route");
      const cellCountRoute = await import("../cell-count/route");
      const exportRoute = await import("../export/route");
      const reportBuilderRoute =
        await import("../../../../report-builder/iteration-matrix/route");
      return {
        prisma,
        aggregatePOST: aggregateRoute.POST,
        cellCountPOST: cellCountRoute.POST,
        exportGET: exportRoute.GET,
        reportBuilderPOST: reportBuilderRoute.POST,
      };
    };

    interface SeedCtx {
      projectA: number;
      projectB: number;
      userA: string;
      userB: string;
      sessionA: { user: { id: string; access: string } };
      sessionB: { user: { id: string; access: string } };
      configA: number;
      configB: number;
      caseA: number;
      caseB: number;
      // For cleanup
      runIds: number[];
      caseIds: number[];
      folderIds: number[];
      repoIds: number[];
      cfgIds: number[];
      projectIds: number[];
      userIds: string[];
    }

    let ctx: SeedCtx;

    async function seed(prisma: any): Promise<SeedCtx> {
      const wf = await prisma.workflows.findFirst({ select: { id: true } });
      if (!wf) throw new Error("Seed the DB first (no Workflows row)");
      const tpl = await prisma.templates.findFirst({ select: { id: true } });
      if (!tpl) throw new Error("Seed the DB first (no Templates row)");
      const role = await prisma.roles.findFirst({ select: { id: true } });
      if (!role) throw new Error("Seed the DB first (no Roles row)");

      const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const userA = await prisma.user.create({
        data: {
          name: `Matrix-RouteTest-UA-${stamp}`,
          email: `matrix-rt-ua-${stamp}@example.com`,
          access: "USER",
          roleId: role.id,
        },
        select: { id: true },
      });
      const userB = await prisma.user.create({
        data: {
          name: `Matrix-RouteTest-UB-${stamp}`,
          email: `matrix-rt-ub-${stamp}@example.com`,
          access: "USER",
          roleId: role.id,
        },
        select: { id: true },
      });

      async function setupProject(
        prefix: string,
        ownerId: string,
        denyOtherUserId: string
      ): Promise<{
        projectId: number;
        configId: number;
        caseId: number;
        repoId: number;
        folderId: number;
        runId: number;
      }> {
        const project = await prisma.projects.create({
          data: {
            name: `${prefix}-${stamp}`,
            createdBy: ownerId,
            defaultAccessType: "SPECIFIC_ROLE",
            defaultRoleId: null,
          },
          select: { id: true },
        });
        await prisma.userProjectPermission.create({
          data: {
            projectId: project.id,
            userId: denyOtherUserId,
            accessType: "NO_ACCESS",
          },
        });
        const repo = await prisma.repositories.create({
          data: { projectId: project.id },
          select: { id: true },
        });
        const folder = await prisma.repositoryFolders.create({
          data: {
            name: `f-${stamp}`,
            repositoryId: repo.id,
            projectId: project.id,
            creatorId: ownerId,
          },
          select: { id: true },
        });
        const cfg = await prisma.configurations.create({
          data: {
            name: `${prefix}-Cfg-${stamp}`,
          },
          select: { id: true },
        });
        const c = await prisma.repositoryCases.create({
          data: {
            projectId: project.id,
            repositoryId: repo.id,
            folderId: folder.id,
            templateId: tpl.id,
            name: `${prefix}-Case`,
            stateId: wf.id,
            creatorId: ownerId,
            hasParameters: true,
          },
          select: { id: true },
        });
        const tr = await prisma.testRuns.create({
          data: {
            name: `${prefix}-Run-${stamp}`,
            projectId: project.id,
            stateId: wf.id,
            createdById: ownerId,
            testRunType: "REGULAR",
            configId: cfg.id,
          },
          select: { id: true },
        });
        await prisma.testRunCases.create({
          data: { testRunId: tr.id, repositoryCaseId: c.id, order: 0 },
          select: { id: true },
        });
        return {
          projectId: project.id,
          configId: cfg.id,
          caseId: c.id,
          repoId: repo.id,
          folderId: folder.id,
          runId: tr.id,
        };
      }

      const a = await setupProject("MatrixRT-A", userA.id, userB.id);
      const b = await setupProject("MatrixRT-B", userB.id, userA.id);

      return {
        projectA: a.projectId,
        projectB: b.projectId,
        userA: userA.id,
        userB: userB.id,
        sessionA: { user: { id: userA.id, access: "USER" } },
        sessionB: { user: { id: userB.id, access: "USER" } },
        configA: a.configId,
        configB: b.configId,
        caseA: a.caseId,
        caseB: b.caseId,
        runIds: [a.runId, b.runId],
        caseIds: [a.caseId, b.caseId],
        folderIds: [a.folderId, b.folderId],
        repoIds: [a.repoId, b.repoId],
        cfgIds: [a.configId, b.configId],
        projectIds: [a.projectId, b.projectId],
        userIds: [userA.id, userB.id],
      };
    }

    async function cleanup(prisma: any, c: SeedCtx) {
      try {
        await prisma.testRunCases.deleteMany({
          where: { testRunId: { in: c.runIds } },
        });
        await prisma.testRuns.deleteMany({
          where: { id: { in: c.runIds } },
        });
        await prisma.repositoryCases.deleteMany({
          where: { id: { in: c.caseIds } },
        });
        await prisma.repositoryFolders.deleteMany({
          where: { id: { in: c.folderIds } },
        });
        await prisma.repositories.deleteMany({
          where: { id: { in: c.repoIds } },
        });
        await prisma.userProjectPermission.deleteMany({
          where: { projectId: { in: c.projectIds } },
        });
        await prisma.configurations.deleteMany({
          where: { id: { in: c.cfgIds } },
        });
        await prisma.projects.deleteMany({
          where: { id: { in: c.projectIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: c.userIds } },
        });
      } catch (err) {
        console.warn("[matrix route integration cleanup]", err);
      }
    }

    function buildPost(
      url: string,
      body: unknown,
      params?: { projectId: string }
    ): [NextRequest, { params: Promise<{ projectId: string }> }] {
      const req = new NextRequest(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
      return [
        req,
        {
          params: Promise.resolve(params ?? { projectId: "0" }),
        },
      ];
    }

    function buildGet(
      url: string,
      params: { projectId: string }
    ): [NextRequest, { params: Promise<{ projectId: string }> }] {
      const req = new NextRequest(url, { method: "GET" });
      return [req, { params: Promise.resolve(params) }];
    }

    beforeAll(async () => {
      const { prisma } = await importDeps();
      ctx = await seed(prisma);
    });

    afterAll(async () => {
      if (RUN_INTEGRATION && HAS_DB_URL) {
        const { prisma } = await import("~/lib/prisma");
        if (ctx) await cleanup(prisma, ctx);
        await prisma.$disconnect();
      }
    });

    beforeEach(() => {
      getServerSessionMock.mockReset();
    });

    it("U_A can read project A's matrix (200, returns project A data)", async () => {
      const { aggregatePOST } = await importDeps();
      getServerSessionMock.mockResolvedValue(ctx.sessionA);

      const [req, params] = buildPost(
        `http://localhost/api/projects/${ctx.projectA}/matrix/aggregate`,
        { filters: {} },
        { projectId: String(ctx.projectA) }
      );
      const res = await aggregatePOST(req, params);
      expect(res.status).toBe(200);
      const json = await res.json();
      // Project A's case is present.
      expect(json.caseAxis.some((c: any) => c.caseId === ctx.caseA)).toBe(true);
      // Project B's case is NOT present.
      expect(json.caseAxis.some((c: any) => c.caseId === ctx.caseB)).toBe(
        false
      );
    });

    it("U_A CANNOT read project B's matrix (403, no project B data)", async () => {
      const { aggregatePOST } = await importDeps();
      getServerSessionMock.mockResolvedValue(ctx.sessionA);

      const [req, params] = buildPost(
        `http://localhost/api/projects/${ctx.projectB}/matrix/aggregate`,
        { filters: {} },
        { projectId: String(ctx.projectB) }
      );
      const res = await aggregatePOST(req, params);
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).not.toContain(`"caseId":${ctx.caseB}`);
    });

    it("U_A CANNOT read project B's cell count (403)", async () => {
      const { cellCountPOST } = await importDeps();
      getServerSessionMock.mockResolvedValue(ctx.sessionA);

      const [req, params] = buildPost(
        `http://localhost/api/projects/${ctx.projectB}/matrix/cell-count`,
        { filters: {} },
        { projectId: String(ctx.projectB) }
      );
      const res = await cellCountPOST(req, params);
      expect(res.status).toBe(403);
    });

    it("U_A CANNOT export project B's CSV (403)", async () => {
      const { exportGET } = await importDeps();
      getServerSessionMock.mockResolvedValue(ctx.sessionA);

      const [req, params] = buildGet(
        `http://localhost/api/projects/${ctx.projectB}/matrix/export`,
        { projectId: String(ctx.projectB) }
      );
      const res = await exportGET(req, params);
      expect(res.status).toBe(403);
    });

    it("U_A CANNOT call the report-builder proxy with project B's id (403)", async () => {
      const { reportBuilderPOST } = await importDeps();
      getServerSessionMock.mockResolvedValue(ctx.sessionA);

      const url = "http://localhost/api/report-builder/iteration-matrix";
      const req = new NextRequest(url, {
        method: "POST",
        body: JSON.stringify({ projectId: ctx.projectB, filters: {} }),
        headers: { "Content-Type": "application/json" },
      });
      const res = await reportBuilderPOST(req);
      expect(res.status).toBe(403);
    });

    /**
     * Belt-and-suspenders #6: verify that the project read-gate rejects
     * the cross-project request BEFORE any raw SQL touches project B's
     * tables. We spy on `prisma.$queryRaw` and `prisma.$queryRawUnsafe`
     * for the duration of the request and assert no parameter binding
     * carries project B's id.
     */
    it("no raw SQL leaks project B data when U_A is denied", async () => {
      const { prisma, aggregatePOST } = await importDeps();
      getServerSessionMock.mockResolvedValue(ctx.sessionA);

      const queryRawSpy = vi.spyOn(prisma as any, "$queryRaw");
      const queryRawUnsafeSpy = vi.spyOn(prisma as any, "$queryRawUnsafe");

      try {
        const [req, params] = buildPost(
          `http://localhost/api/projects/${ctx.projectB}/matrix/aggregate`,
          { filters: {} },
          { projectId: String(ctx.projectB) }
        );
        const res = await aggregatePOST(req, params);
        expect(res.status).toBe(403);

        const allCalls = [
          ...(queryRawSpy as any).mock.calls,
          ...(queryRawUnsafeSpy as any).mock.calls,
        ];
        for (const call of allCalls) {
          const serialized = JSON.stringify(call);
          // Project B's id MUST NOT appear in any raw SQL bind.
          expect(serialized).not.toContain(`"${ctx.projectB}"`);
          expect(serialized).not.toContain(`:${ctx.projectB}`);
          expect(serialized).not.toContain(` ${ctx.projectB},`);
          expect(serialized).not.toContain(`,${ctx.projectB},`);
        }
      } finally {
        (queryRawSpy as any).mockRestore();
        (queryRawUnsafeSpy as any).mockRestore();
      }
    });
  }
);
