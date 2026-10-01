import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internalReportBypassToken } from "~/lib/internalReportBypass";
import { hashReportBuilderState } from "~/lib/services/reportBuilderState";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: (...args: any[]) => any) => handler,
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    reportBuilderState: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("~/lib/auth/utils", () => ({ getEnhancedDb: vi.fn() }));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { GET, POST } from "./route";

const states = baseDb.reportBuilderState as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

function postReq(
  body: unknown,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/reports/state", {
      method: "POST",
      headers: { "content-type": "application/json", ...extraHeaders },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function getReq(query: string): NextRequest {
  return new NextRequest(
    new Request(`http://localhost/api/reports/state${query}`)
  );
}

function signInAs(access: "ADMIN" | "USER", id = "u1") {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id, access },
  } as never);
}

function projectReadable(readable: boolean) {
  vi.mocked(getEnhancedDb as any).mockResolvedValue({
    projects: {
      findFirst: vi.fn().mockResolvedValue(readable ? { id: 7 } : null),
    },
  });
}

const config = {
  dimensions: ["testRun", "status"],
  metrics: ["testCaseCount"],
  dimensionFilters: { testRun: [1, 2, 3] },
};

describe("POST /api/reports/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    states.findFirst.mockResolvedValue(null);
    states.create.mockImplementation(async ({ data }: any) => ({
      id: "new-state",
      ...data,
    }));
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(
      postReq({ projectId: 7, reportType: "test-execution", config })
    );
    expect(res.status).toBe(401);
  });

  it("400s on a malformed JSON body", async () => {
    signInAs("USER");
    const res = await POST(postReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("400s when the body fails validation", async () => {
    signInAs("USER");
    const res = await POST(
      postReq({ projectId: 7, config: { dimensions: "status" } })
    );
    expect(res.status).toBe(400);
    expect(states.create).not.toHaveBeenCalled();
  });

  it("403s when the caller cannot read the project", async () => {
    signInAs("USER");
    projectReadable(false);
    const res = await POST(
      postReq({ projectId: 7, reportType: "test-execution", config })
    );
    expect(res.status).toBe(403);
    expect(states.create).not.toHaveBeenCalled();
  });

  it("requires ADMIN for a cross-project state (no projectId)", async () => {
    signInAs("USER");
    const res = await POST(
      postReq({ reportType: "cross-project-test-execution", config })
    );
    expect(res.status).toBe(401);
    expect(states.create).not.toHaveBeenCalled();
  });

  it("rejects the share-replay bypass token — there is no user to own the row", async () => {
    const res = await POST(
      postReq(
        { projectId: 7, reportType: "test-execution", config },
        { "x-shared-report-bypass": internalReportBypassToken() }
      )
    );
    expect(res.status).toBe(401);
    expect(states.create).not.toHaveBeenCalled();
  });

  it("creates a row owned by the caller with the config hash and returns its id", async () => {
    signInAs("USER");
    projectReadable(true);
    const res = await POST(
      postReq({ projectId: 7, reportType: "test-execution", config })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "new-state" });

    const { data } = states.create.mock.calls[0][0];
    expect(data).toMatchObject({
      projectId: 7,
      createdById: "u1",
      reportType: "test-execution",
      config,
    });
    expect(data.configHash).toBe(
      hashReportBuilderState("test-execution", config)
    );
  });

  it("reuses an existing row with the same project and hash, bumping lastUsedAt", async () => {
    signInAs("USER");
    projectReadable(true);
    states.findFirst.mockResolvedValue({ id: "existing" });

    const res = await POST(
      postReq({ projectId: 7, reportType: "test-execution", config })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "existing" });

    const where = states.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      projectId: 7,
      configHash: hashReportBuilderState("test-execution", config),
    });
    expect(states.create).not.toHaveBeenCalled();
    expect(states.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing" },
        data: { lastUsedAt: expect.any(Date) },
      })
    );
  });

  it("dedupes cross-project states per creator", async () => {
    signInAs("ADMIN", "admin-1");
    const res = await POST(
      postReq({ reportType: "cross-project-test-execution", config })
    );
    expect(res.status).toBe(201);

    const where = states.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      projectId: null,
      configHash: hashReportBuilderState(
        "cross-project-test-execution",
        config
      ),
      createdById: "admin-1",
    });
    expect(states.create.mock.calls[0][0].data).toMatchObject({
      projectId: null,
      createdById: "admin-1",
    });
  });
});

describe("GET /api/reports/state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    states.findUnique.mockResolvedValue({
      id: "s1",
      projectId: 7,
      reportType: "test-execution",
      config,
    });
  });

  it("400s without an id", async () => {
    signInAs("USER");
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
  });

  it("404s for an unknown id", async () => {
    signInAs("USER");
    states.findUnique.mockResolvedValue(null);
    const res = await GET(getReq("?id=missing"));
    expect(res.status).toBe(404);
  });

  it("401s when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(getReq("?id=s1"));
    expect(res.status).toBe(401);
    expect(states.update).not.toHaveBeenCalled();
  });

  it("403s for a project member of another project", async () => {
    signInAs("USER", "outsider");
    projectReadable(false);
    const res = await GET(getReq("?id=s1"));
    expect(res.status).toBe(403);
    expect(states.update).not.toHaveBeenCalled();
  });

  it("returns the stored config to any project member and marks the row used", async () => {
    signInAs("USER", "someone-else");
    projectReadable(true);
    const res = await GET(getReq("?id=s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reportType: "test-execution",
      config,
    });
    expect(states.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: { lastUsedAt: expect.any(Date) },
      })
    );
  });

  it("requires ADMIN for a cross-project state", async () => {
    states.findUnique.mockResolvedValue({
      id: "s2",
      projectId: null,
      reportType: "cross-project-test-execution",
      config,
    });
    signInAs("USER");
    expect((await GET(getReq("?id=s2"))).status).toBe(401);

    signInAs("ADMIN");
    expect((await GET(getReq("?id=s2"))).status).toBe(200);
  });
});
