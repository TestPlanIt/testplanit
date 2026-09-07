import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: (...args: any[]) => any) => handler,
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
}));

vi.mock("~/lib/queues", () => ({
  getImpactAnalysisQueue: vi.fn(),
}));

vi.mock("@/lib/multiTenantDb", () => ({
  getCurrentTenantId: vi.fn(),
}));

vi.mock("~/lib/services/impact/repoAccess", () => ({
  findImpactConfigId: vi.fn(),
  loadRepoConfigForUser: vi.fn(),
}));

vi.mock("~/lib/services/impact/compareService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/lib/services/impact/compareService")
    >();
  return { ...actual, resolveRefToSha: vi.fn() };
});

vi.mock("~/lib/integrations/cache/RepoFileCache", () => ({
  repoFileCache: {},
}));

vi.mock("~/lib/utils/errors", () => ({
  isAccessPolicyError: vi.fn(),
}));

import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { getImpactAnalysisQueue } from "~/lib/queues";
import {
  RefNotFoundError,
  resolveRefToSha,
} from "~/lib/services/impact/compareService";
import { impactConfig } from "~/lib/services/impact/config";
import {
  findImpactConfigId,
  loadRepoConfigForUser,
} from "~/lib/services/impact/repoAccess";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { GET, POST } from "./route";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const session = { user: { id: "user-1" } };

const loaded = {
  config: {
    id: 5,
    projectId: 3,
    purpose: "IMPACT",
    branch: "main",
    cacheEnabled: true,
    repositoryId: 9,
    repository: { id: 9, name: "acme/app", provider: "github", settings: null },
  },
  adapter: { kind: "adapter" },
};

function makeDb() {
  return {
    projects: {
      findFirst: vi.fn().mockResolvedValue({ impactEnabled: true }),
    },
    projectLlmIntegration: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    impactAnalysis: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 77 }),
      update: vi.fn().mockResolvedValue({ id: 77 }),
    },
  };
}

function makeQueue() {
  return { add: vi.fn().mockResolvedValue({ id: "impact-77" }) };
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/projects/3/impact/analyses", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function getRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/projects/3/impact/analyses");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function makeParams(projectId = "3") {
  return { params: Promise.resolve({ projectId }) };
}

const validBody = { base: "main", head: "feature" };

describe("POST /api/projects/[projectId]/impact/analyses", () => {
  let db: ReturnType<typeof makeDb>;
  let queue: ReturnType<typeof makeQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    queue = makeQueue();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
    (findImpactConfigId as any).mockResolvedValue(5);
    (loadRepoConfigForUser as any).mockResolvedValue(loaded);
    (resolveRefToSha as any).mockImplementation(
      async (_a: unknown, ref: string) =>
        ref === "main" || ref === SHA_A ? SHA_A : SHA_B
    );
    (getImpactAnalysisQueue as any).mockReturnValue(queue);
    (getCurrentTenantId as any).mockReturnValue(undefined);
    (isAccessPolicyError as any).mockReturnValue(false);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(401);
    expect(updateAuditContext).not.toHaveBeenCalled();
  });

  it("stamps the audit context with the session user", async () => {
    await POST(postRequest(validBody), makeParams());

    expect(updateAuditContext).toHaveBeenCalledWith({ userId: "user-1" });
  });

  it.each(["abc", "0", "-3"])(
    "returns 400 for the invalid project id %s",
    async (projectId) => {
      const res = await POST(postRequest(validBody), makeParams(projectId));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid project id" });
    }
  );

  it("returns 400 for a malformed JSON body", async () => {
    const res = await POST(postRequest("{oops"), makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body" });
  });

  it("returns 400 with details when the body fails the schema", async () => {
    const missingHead = await POST(postRequest({ base: "main" }), makeParams());
    expect(missingHead.status).toBe(400);
    expect((await missingHead.json()).details).toBeDefined();

    const spacey = await POST(
      postRequest({ base: "my branch", head: "feature" }),
      makeParams()
    );
    expect(spacey.status).toBe(400);

    const badExclude = await POST(
      postRequest({ ...validBody, excludeCaseIds: [0] }),
      makeParams()
    );
    expect(badExclude.status).toBe(400);
    expect(getEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns 404 when the project is not visible", async () => {
    db.projects.findFirst.mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Project not found" });
    expect(db.projects.findFirst).toHaveBeenCalledWith({
      where: { id: 3, isDeleted: false },
      select: { impactEnabled: true },
    });
    expect(findImpactConfigId).not.toHaveBeenCalled();
  });

  it("returns 409 impact_disabled when the feature is off for the project", async () => {
    db.projects.findFirst.mockResolvedValue({ impactEnabled: false });

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "impact_disabled" });
    expect(findImpactConfigId).not.toHaveBeenCalled();
  });

  it("returns 404 no_impact_config when the project has no Impact config", async () => {
    (findImpactConfigId as any).mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "no_impact_config" });
    expect(findImpactConfigId).toHaveBeenCalledWith(db, 3);
    expect(loadRepoConfigForUser).not.toHaveBeenCalled();
  });

  it("returns 404 no_impact_config when the config cannot be loaded for the caller", async () => {
    (loadRepoConfigForUser as any).mockResolvedValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "no_impact_config" });
    expect(loadRepoConfigForUser).toHaveBeenCalledWith(session, 5, {
      purpose: "IMPACT",
    });
  });

  it("returns 404 when a ref cannot be resolved", async () => {
    (resolveRefToSha as any).mockImplementation(
      async (_a: unknown, ref: string) => {
        if (ref === "ghost") throw new RefNotFoundError(ref);
        return SHA_A;
      }
    );

    const res = await POST(
      postRequest({ base: "main", head: "ghost" }),
      makeParams()
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Ref not found: ghost" });
    expect(db.impactAnalysis.create).not.toHaveBeenCalled();
  });

  it("returns 400 when base and head resolve to the same commit", async () => {
    (resolveRefToSha as any).mockResolvedValue(SHA_A);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Base and head resolve to the same commit",
    });
    expect(db.impactAnalysis.create).not.toHaveBeenCalled();
  });

  it("returns 200 reused:true for a recent COMPLETED analysis of the same pair", async () => {
    db.impactAnalysis.findFirst.mockResolvedValue({
      id: 12,
      jobId: "impact-12",
    });
    const before = Date.now();

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      analysisId: 12,
      jobId: "impact-12",
      reused: true,
      aiAvailable: false,
    });
    expect(db.impactAnalysis.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();

    const where = db.impactAnalysis.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      configId: 5,
      baseSha: SHA_A,
      headSha: SHA_B,
      status: "COMPLETED",
      isDeleted: false,
    });
    // The reuse window is impactConfig.reuseHours wide.
    const gte: Date = where.createdAt.gte;
    const expectedMs = impactConfig.reuseHours * 3600_000;
    expect(before - gte.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(before - gte.getTime()).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it("skips the reuse lookup and creates a fresh analysis when force is set", async () => {
    db.impactAnalysis.findFirst.mockResolvedValue({
      id: 12,
      jobId: "impact-12",
    });

    const res = await POST(
      postRequest({ ...validBody, force: true }),
      makeParams()
    );

    expect(res.status).toBe(202);
    expect(db.impactAnalysis.findFirst).not.toHaveBeenCalled();
    expect(db.impactAnalysis.create).toHaveBeenCalledTimes(1);
  });

  it("returns 503 and marks the row FAILED when the queue is unavailable", async () => {
    (getImpactAnalysisQueue as any).mockReturnValue(null);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Background job queue is not available",
    });
    expect(db.impactAnalysis.create).toHaveBeenCalledTimes(1);
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: {
        status: "FAILED",
        error: "Background job queue is not available",
      },
    });
  });

  it("returns 503 and marks the row FAILED with the enqueue error", async () => {
    queue.add.mockRejectedValue(new Error("redis gone"));

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Failed to enqueue analysis" });
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { status: "FAILED", error: "redis gone" },
    });
  });

  it("returns 202 with jobId impact-<id> and enqueues the job with that jobId", async () => {
    (getCurrentTenantId as any).mockReturnValue("tenant-x");
    db.projectLlmIntegration.findFirst.mockResolvedValue({ id: 1 });

    const res = await POST(
      postRequest({
        ...validBody,
        notes: "release smoke",
        excludeCaseIds: [4, 8],
      }),
      makeParams()
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      analysisId: 77,
      jobId: "impact-77",
      reused: false,
      aiAvailable: true,
    });

    expect(db.impactAnalysis.create).toHaveBeenCalledWith({
      data: {
        projectId: 3,
        configId: 5,
        baseSha: SHA_A,
        headSha: SHA_B,
        baseRef: "main",
        headRef: "feature",
        notes: "release smoke",
        createdById: "user-1",
      },
      select: { id: true },
    });
    expect(queue.add).toHaveBeenCalledWith(
      "analyze",
      {
        analysisId: 77,
        projectId: 3,
        configId: 5,
        baseSha: SHA_A,
        headSha: SHA_B,
        userId: "user-1",
        notes: "release smoke",
        excludeCaseIds: [4, 8],
        tenantId: "tenant-x",
      },
      { jobId: "impact-77" }
    );
    expect(db.impactAnalysis.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { jobId: "impact-77" },
    });
  });

  it("stores null baseRef/headRef when the caller passed full shas", async () => {
    const res = await POST(
      postRequest({ base: SHA_A, head: SHA_B }),
      makeParams()
    );

    expect(res.status).toBe(202);
    expect(db.impactAnalysis.create.mock.calls[0][0].data).toMatchObject({
      baseRef: null,
      headRef: null,
      notes: null,
    });
  });

  it("returns 403 when a read is rejected by policy", async () => {
    db.projects.findFirst.mockRejectedValue(new Error("denied"));
    (isAccessPolicyError as any).mockReturnValue(true);

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 500 for any other failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.impactAnalysis.create.mockRejectedValue(new Error("db down"));

    const res = await POST(postRequest(validBody), makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to create analysis" });
  });
});

describe("GET /api/projects/[projectId]/impact/analyses", () => {
  let db: ReturnType<typeof makeDb>;

  const row = (id: number) => ({ id, status: "COMPLETED" });

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    (getServerSession as any).mockResolvedValue(session);
    (getEnhancedDb as any).mockResolvedValue(db);
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    expect((await GET(getRequest(), makeParams())).status).toBe(401);
  });

  it("returns 400 for an invalid project id", async () => {
    expect((await GET(getRequest(), makeParams("abc"))).status).toBe(400);
  });

  it("lists newest first with the default page size and no cursor", async () => {
    db.impactAnalysis.findMany.mockResolvedValue([row(3), row(2), row(1)]);

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      analyses: [row(3), row(2), row(1)],
      nextCursor: null,
    });
    const args = db.impactAnalysis.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      where: { projectId: 3, isDeleted: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
    expect(args).not.toHaveProperty("cursor");
    expect(args).not.toHaveProperty("skip");
  });

  it("returns nextCursor when more rows exist than the page size", async () => {
    db.impactAnalysis.findMany.mockResolvedValue([row(9), row(8), row(7)]);

    const res = await GET(getRequest({ take: "2" }), makeParams());

    expect(await res.json()).toEqual({
      analyses: [row(9), row(8)],
      nextCursor: 8,
    });
    expect(db.impactAnalysis.findMany.mock.calls[0][0].take).toBe(3);
  });

  it("continues from the cursor by skipping the cursor row", async () => {
    db.impactAnalysis.findMany.mockResolvedValue([row(7), row(6)]);

    const res = await GET(getRequest({ take: "2", cursor: "8" }), makeParams());

    expect(await res.json()).toEqual({
      analyses: [row(7), row(6)],
      nextCursor: null,
    });
    expect(db.impactAnalysis.findMany.mock.calls[0][0]).toMatchObject({
      cursor: { id: 8 },
      skip: 1,
      take: 3,
    });
  });

  it("clamps take into [1, 50] and ignores a non-numeric take", async () => {
    await GET(getRequest({ take: "500" }), makeParams());
    expect(db.impactAnalysis.findMany.mock.calls[0][0].take).toBe(51);

    await GET(getRequest({ take: "0" }), makeParams());
    expect(db.impactAnalysis.findMany.mock.calls[1][0].take).toBe(2);

    await GET(getRequest({ take: "abc" }), makeParams());
    expect(db.impactAnalysis.findMany.mock.calls[2][0].take).toBe(21);
  });

  it("returns 500 when the list fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.impactAnalysis.findMany.mockRejectedValue(new Error("db down"));

    const res = await GET(getRequest(), makeParams());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to list analyses" });
  });
});
