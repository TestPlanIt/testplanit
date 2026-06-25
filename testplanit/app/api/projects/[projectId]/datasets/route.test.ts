import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const dataSetCreateMock = vi.fn();
const dataSetFindManyMock = vi.fn();
const dataSetCountMock = vi.fn();
const projectsFindFirstMock = vi.fn(async () => ({ id: 1 }));
const transactionMock = vi.fn(async (cb: any) =>
  cb({
    dataSet: { create: dataSetCreateMock },
  })
);

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    projects: { findFirst: projectsFindFirstMock },
    dataSet: {
      findMany: dataSetFindManyMock,
      count: dataSetCountMock,
    },
    $transaction: transactionMock,
  })),
}));

// The POST handler bypasses the enhanced client and uses raw `baseDb`
// for the actual create (Phase 1 @@deny null-safety workaround). Mock
// `~/lib/db` so the raw $transaction routes through the same
// captured `dataSetCreateMock` as the enhanced path.
vi.mock("~/lib/db", () => ({
  baseDb: {
    $transaction: (cb: any) =>
      cb({
        dataSet: { create: dataSetCreateMock },
      }),
  },
}));

const captureAuditEventMock = vi.fn(
  async () => undefined
) as unknown as ReturnType<typeof vi.fn<(...args: any[]) => Promise<void>>>;
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => captureAuditEventMock(...args),
}));

import { getServerSession } from "next-auth";

import { GET, POST } from "./route";

const mockSession = {
  user: { id: "user-1", name: "Tester" },
};

const buildGet = (
  projectId: string,
  search = ""
): [NextRequest, { params: Promise<{ projectId: string }> }] => {
  const url = `http://localhost/api/projects/${projectId}/datasets${search}`;
  const req = new NextRequest(url);
  return [req, { params: Promise.resolve({ projectId }) }];
};

const buildPost = (
  projectId: string,
  body: unknown
): [NextRequest, { params: Promise<{ projectId: string }> }] => {
  const url = `http://localhost/api/projects/${projectId}/datasets`;
  const req = new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ projectId }) }];
};

describe("GET /api/projects/[projectId]/datasets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildGet("1");
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 when projectId is non-numeric", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildGet("not-a-number");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("filters datasets by isShared:true and isDeleted:false", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    dataSetFindManyMock.mockResolvedValue([{ id: 7, name: "Test users" }]);
    dataSetCountMock.mockResolvedValue(1);

    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items).toEqual([{ id: 7, name: "Test users" }]);
    expect(json.total).toBe(1);

    // Both findMany and count must scope by the right where clause.
    const findManyArgs = dataSetFindManyMock.mock.calls[0][0];
    expect(findManyArgs.where).toEqual({
      projectId: 42,
      isShared: true,
      isDeleted: false,
    });
    const countArgs = dataSetCountMock.mock.calls[0][0];
    expect(countArgs.where).toEqual({
      projectId: 42,
      isShared: true,
      isDeleted: false,
    });
  });

  it("paginates with default pageSize=50 and clamps page>=1", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    dataSetFindManyMock.mockResolvedValue([]);
    dataSetCountMock.mockResolvedValue(0);

    const [req, ctx] = buildGet("1", "?page=0&pageSize=10");
    const res = await GET(req, ctx);
    const json = await res.json();
    expect(json.page).toBe(1); // clamped from 0
    expect(json.pageSize).toBe(10);
  });

  it("clamps pageSize to 200 maximum", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    dataSetFindManyMock.mockResolvedValue([]);
    dataSetCountMock.mockResolvedValue(0);

    const [req, ctx] = buildGet("1", "?pageSize=999");
    const res = await GET(req, ctx);
    const json = await res.json();
    expect(json.pageSize).toBe(200);
  });
});

describe("POST /api/projects/[projectId]/datasets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildPost("1", { name: "X" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 with details when payload is invalid (empty name)", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildPost("1", { name: "" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("creates a shared dataset with isShared:true and version:1", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    dataSetCreateMock.mockResolvedValue({
      id: 100,
      name: "Login users",
      description: "test users for login",
      version: 1,
      isShared: true,
    });

    const [req, ctx] = buildPost("42", {
      name: "Login users",
      description: "test users for login",
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dataSet).toEqual({
      id: 100,
      name: "Login users",
      description: "test users for login",
      version: 1,
      isShared: true,
    });

    // The transaction body must call create with isShared:true,
    // ownerCaseId:null, version:1.
    const createArgs = dataSetCreateMock.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      projectId: 42,
      name: "Login users",
      description: "test users for login",
      isShared: true,
      ownerCaseId: null,
      version: 1,
      createdById: "user-1",
    });
  });

  it("treats missing description as null", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    dataSetCreateMock.mockResolvedValue({
      id: 101,
      name: "X",
      description: null,
      version: 1,
      isShared: true,
    });

    const [req, ctx] = buildPost("1", { name: "X" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const createArgs = dataSetCreateMock.mock.calls[0][0];
    expect(createArgs.data.description).toBeNull();
  });

  it("emits an audit event with action=CREATE on successful POST", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    dataSetCreateMock.mockResolvedValue({
      id: 100,
      name: "Login users",
      description: null,
      version: 1,
      isShared: true,
    });

    const [req, ctx] = buildPost("42", { name: "Login users" });
    await POST(req, ctx);

    expect(captureAuditEventMock).toHaveBeenCalledTimes(1);
    const event = captureAuditEventMock.mock.calls[0][0];
    expect(event).toMatchObject({
      action: "CREATE",
      entityType: "DataSet",
      entityId: "100",
      entityName: "Login users",
      projectId: 42,
      userId: "user-1",
      metadata: { isShared: true },
    });
  });
});
