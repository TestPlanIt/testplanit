import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getCurrentTenantId: vi.fn(),
  isMultiTenantMode: vi.fn(),
  isProjectAdminFor: vi.fn(),
  getRiskScoreQueue: vi.fn(),
  enqueueRiskProjectRecompute: vi.fn(),
  db: {
    projects: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/multiTenantDb", () => ({
  getCurrentTenantId: mocks.getCurrentTenantId,
  isMultiTenantMode: mocks.isMultiTenantMode,
}));

vi.mock("~/lib/db", () => ({ baseDb: mocks.db }));

vi.mock("~/lib/services/areaPermission", () => ({
  isProjectAdminFor: mocks.isProjectAdminFor,
}));

vi.mock("~/lib/queues", () => ({
  getRiskScoreQueue: mocks.getRiskScoreQueue,
}));

vi.mock("~/lib/services/risk/enqueue", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/risk/enqueue")>();
  return {
    ...actual,
    enqueueRiskProjectRecompute: mocks.enqueueRiskProjectRecompute,
  };
});

import { riskProjectJobId } from "~/lib/services/risk/enqueue";
import { GET as getHandler, POST as postHandler } from "./route";

// Every path in these handlers returns a NextResponse; the route's inferred
// return type otherwise reads as possibly undefined at the call sites.
const GET = getHandler as (
  ...args: Parameters<typeof getHandler>
) => Promise<NextResponse>;
const POST = postHandler as (
  ...args: Parameters<typeof postHandler>
) => Promise<NextResponse>;

const projectAdmin = { user: { id: "user-1", access: "USER" } };
const systemAdmin = { user: { id: "admin-1", access: "ADMIN" } };
const member = { user: { id: "user-2", access: "USER" } };

function request(method: "GET" | "POST") {
  return new NextRequest("http://localhost/api/projects/7/risk/backfill", {
    method,
  });
}

function makeParams(projectId = "7") {
  return { params: Promise.resolve({ projectId }) };
}

function makeJob(
  state: string,
  data: Record<string, unknown> = { projectId: 7 },
  progress?: unknown
) {
  return {
    id: riskProjectJobId(7),
    data,
    progress,
    getState: vi.fn().mockResolvedValue(state),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function makeQueue() {
  return {
    getJob: vi.fn().mockResolvedValue(null),
    add: vi.fn(),
  };
}

describe("/api/projects/[projectId]/risk/backfill", () => {
  let queue: ReturnType<typeof makeQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    queue = makeQueue();
    mocks.getServerSession.mockResolvedValue(projectAdmin);
    mocks.getCurrentTenantId.mockReturnValue(undefined);
    mocks.isMultiTenantMode.mockReturnValue(false);
    mocks.db.projects.findFirst.mockResolvedValue({ id: 7 });
    mocks.isProjectAdminFor.mockImplementation(
      async (userId: string, projectId: number) =>
        userId === "user-1" && projectId === 7
    );
    mocks.getRiskScoreQueue.mockReturnValue(queue);
    mocks.db.projects.findUnique.mockResolvedValue({
      riskScoringEnabled: true,
    });
    mocks.enqueueRiskProjectRecompute.mockResolvedValue(riskProjectJobId(7));
  });

  describe("authorization", () => {
    it("returns 401 on GET and POST without a signed-in user", async () => {
      for (const session of [null, { user: { access: "ADMIN" } }]) {
        mocks.getServerSession.mockResolvedValue(session);

        expect((await GET(request("GET"), makeParams())).status).toBe(401);
        expect((await POST(request("POST"), makeParams())).status).toBe(401);
      }
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(mocks.enqueueRiskProjectRecompute).not.toHaveBeenCalled();
    });

    it("returns 400 on GET and POST for a projectId that is not an integer", async () => {
      for (const projectId of ["abc", "7.5"]) {
        expect((await GET(request("GET"), makeParams(projectId))).status).toBe(
          400
        );
        expect(
          (await POST(request("POST"), makeParams(projectId))).status
        ).toBe(400);
      }
      expect(mocks.isProjectAdminFor).not.toHaveBeenCalled();
      expect(mocks.enqueueRiskProjectRecompute).not.toHaveBeenCalled();
    });

    it("refuses GET to a user who is not an admin of the project", async () => {
      const job = makeJob("active", { projectId: 7 }, { processed: 3 });
      queue.getJob.mockResolvedValue(job);
      mocks.getServerSession.mockResolvedValue(member);

      const res = await GET(request("GET"), makeParams());

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
      expect(mocks.isProjectAdminFor).toHaveBeenCalledWith("user-2", 7);
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(job.getState).not.toHaveBeenCalled();
    });

    it("refuses POST to a user who is not an admin of the project, queueing and removing nothing", async () => {
      const finished = makeJob("completed");
      queue.getJob.mockResolvedValue(finished);
      mocks.getServerSession.mockResolvedValue(member);

      const res = await POST(request("POST"), makeParams());

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
      expect(mocks.isProjectAdminFor).toHaveBeenCalledWith("user-2", 7);
      expect(mocks.db.projects.findUnique).not.toHaveBeenCalled();
      expect(finished.remove).not.toHaveBeenCalled();
      expect(mocks.enqueueRiskProjectRecompute).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("lets the project's admin read the backfill state and start one", async () => {
      const getRes = await GET(request("GET"), makeParams());
      const postRes = await POST(request("POST"), makeParams());

      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual({ state: "none" });
      expect(postRes.status).toBe(200);
      expect(await postRes.json()).toEqual({ jobId: riskProjectJobId(7) });
      expect(mocks.isProjectAdminFor).toHaveBeenCalledWith("user-1", 7);
      expect(mocks.enqueueRiskProjectRecompute).toHaveBeenCalledWith({
        projectId: 7,
        requestedById: "user-1",
        tenantId: undefined,
      });
    });

    it("lets a system admin read the backfill state and start one without a project role", async () => {
      mocks.getServerSession.mockResolvedValue(systemAdmin);

      const getRes = await GET(request("GET"), makeParams());
      const postRes = await POST(request("POST"), makeParams());

      expect(getRes.status).toBe(200);
      expect(await getRes.json()).toEqual({ state: "none" });
      expect(postRes.status).toBe(200);
      expect(mocks.isProjectAdminFor).not.toHaveBeenCalled();
      expect(mocks.enqueueRiskProjectRecompute).toHaveBeenCalledWith({
        projectId: 7,
        requestedById: "admin-1",
        tenantId: undefined,
      });
    });
  });

  describe("GET", () => {
    it("reports none when the queue is unavailable or holds no backfill job", async () => {
      mocks.getRiskScoreQueue.mockReturnValue(null);
      const noQueue = await GET(request("GET"), makeParams());
      expect(noQueue.status).toBe(200);
      expect(await noQueue.json()).toEqual({ state: "none" });

      mocks.getRiskScoreQueue.mockReturnValue(queue);
      const noJob = await GET(request("GET"), makeParams());
      expect(noJob.status).toBe(200);
      expect(await noJob.json()).toEqual({ state: "none" });
      expect(queue.getJob).toHaveBeenCalledWith(riskProjectJobId(7));
    });

    it("returns the job state with the processed count from its progress", async () => {
      const cases: [unknown, number][] = [
        [{ scanned: 42 }, 42],
        [{}, 0],
        [5, 0],
        [undefined, 0],
      ];
      for (const [progress, processed] of cases) {
        queue.getJob.mockResolvedValue(
          makeJob("active", { projectId: 7 }, progress)
        );

        const res = await GET(request("GET"), makeParams());

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ state: "active", processed });
      }
    });

    it("only reports the current tenant's job in multi-tenant mode", async () => {
      mocks.isMultiTenantMode.mockReturnValue(true);
      mocks.getCurrentTenantId.mockReturnValue("tenant-a");
      const foreign = makeJob("active", {
        projectId: 7,
        tenantId: "tenant-b",
      });
      queue.getJob.mockResolvedValue(foreign);

      const res = await GET(request("GET"), makeParams());

      expect(await res.json()).toEqual({ state: "none" });
      expect(queue.getJob).toHaveBeenCalledWith(
        riskProjectJobId(7, "tenant-a")
      );
      expect(foreign.getState).not.toHaveBeenCalled();

      queue.getJob.mockResolvedValue(
        makeJob("waiting", { projectId: 7, tenantId: "tenant-a" })
      );
      const own = await GET(request("GET"), makeParams());
      expect(await own.json()).toEqual({ state: "waiting", processed: 0 });
    });
  });

  describe("POST", () => {
    it("refuses when risk scoring is not enabled for the project", async () => {
      for (const project of [{ riskScoringEnabled: false }, null]) {
        mocks.db.projects.findUnique.mockResolvedValue(project);

        const res = await POST(request("POST"), makeParams());

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: "Risk scoring is disabled for this project",
        });
      }
      expect(mocks.db.projects.findUnique).toHaveBeenCalledWith({
        where: { id: 7 },
        select: { riskScoringEnabled: true },
      });
      expect(queue.getJob).not.toHaveBeenCalled();
      expect(mocks.enqueueRiskProjectRecompute).not.toHaveBeenCalled();
    });

    it("returns 503 when the queue is unavailable", async () => {
      mocks.getRiskScoreQueue.mockReturnValue(null);

      const res = await POST(request("POST"), makeParams());

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Background job queue is not available",
      });
      expect(mocks.enqueueRiskProjectRecompute).not.toHaveBeenCalled();
    });

    it("returns 409 with the job id while a backfill is queued or running", async () => {
      for (const state of ["waiting", "delayed", "active"]) {
        const live = makeJob(state);
        queue.getJob.mockResolvedValue(live);

        const res = await POST(request("POST"), makeParams());

        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({
          error: "A recompute is already running",
          jobId: riskProjectJobId(7),
        });
        expect(live.remove).not.toHaveBeenCalled();
      }
      expect(mocks.enqueueRiskProjectRecompute).not.toHaveBeenCalled();
    });

    it.each(["completed", "failed"])(
      "removes a %s job before queueing the next backfill under its id",
      async (state) => {
        const finished = makeJob(state);
        queue.getJob.mockResolvedValue(finished);

        const res = await POST(request("POST"), makeParams());

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ jobId: riskProjectJobId(7) });
        expect(finished.remove).toHaveBeenCalledTimes(1);
        expect(finished.remove.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.enqueueRiskProjectRecompute.mock.invocationCallOrder[0]
        );
      }
    );

    it("queues the backfill for the project, the requesting user and the current tenant", async () => {
      mocks.getCurrentTenantId.mockReturnValue("tenant-a");
      mocks.enqueueRiskProjectRecompute.mockResolvedValue(
        riskProjectJobId(7, "tenant-a")
      );

      const res = await POST(request("POST"), makeParams());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        jobId: riskProjectJobId(7, "tenant-a"),
      });
      expect(queue.getJob).toHaveBeenCalledWith(
        riskProjectJobId(7, "tenant-a")
      );
      expect(mocks.enqueueRiskProjectRecompute).toHaveBeenCalledWith({
        projectId: 7,
        requestedById: "user-1",
        tenantId: "tenant-a",
      });
    });

    it("leaves another tenant's finished job in place in multi-tenant mode", async () => {
      mocks.isMultiTenantMode.mockReturnValue(true);
      mocks.getCurrentTenantId.mockReturnValue("tenant-a");
      const foreign = makeJob("completed", {
        projectId: 7,
        tenantId: "tenant-b",
      });
      queue.getJob.mockResolvedValue(foreign);

      await POST(request("POST"), makeParams());

      expect(foreign.getState).not.toHaveBeenCalled();
      expect(foreign.remove).not.toHaveBeenCalled();
    });

    it("returns 503 when the backfill could not be queued", async () => {
      mocks.enqueueRiskProjectRecompute.mockResolvedValue(null);

      const res = await POST(request("POST"), makeParams());

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: "Background job queue is not available",
      });
    });

    it("returns 500 when queueing the backfill throws", async () => {
      mocks.enqueueRiskProjectRecompute.mockRejectedValue(
        new Error("connection lost")
      );

      const res = await POST(request("POST"), makeParams());

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "Failed to start the analysis",
      });
      expect(console.error).toHaveBeenCalled();
    });
  });
});
