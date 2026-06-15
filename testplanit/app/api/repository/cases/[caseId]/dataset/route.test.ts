import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const mocks = vi.hoisted(() => ({
  repositoryCasesFindFirst: vi.fn(),
  dataSetFindFirst: vi.fn(),
  dataSetCreate: vi.fn(),
  captureAuditEvent: vi.fn(async () => undefined) as unknown as ReturnType<
    typeof vi.fn<(...args: any[]) => Promise<void>>
  >,
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    repositoryCases: { findFirst: mocks.repositoryCasesFindFirst },
    dataSet: {
      findFirst: mocks.dataSetFindFirst,
      create: mocks.dataSetCreate,
    },
  })),
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mocks.captureAuditEvent(...args),
}));

import { getServerSession } from "next-auth";

import { POST } from "./route";

const session = { user: { id: "user-1", name: "Tester" } };

const buildPost = (
  caseId: string
): [NextRequest, { params: Promise<{ caseId: string }> }] => {
  const url = `http://localhost/api/repository/cases/${caseId}/dataset`;
  const req = new NextRequest(url, { method: "POST" });
  return [req, { params: Promise.resolve({ caseId }) }];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/repository/cases/[caseId]/dataset", () => {
  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildPost("1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
    expect(mocks.captureAuditEvent).not.toHaveBeenCalled();
  });

  it("creates the owned dataset and emits a DataSet CREATE audit event", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({
      id: 7,
      projectId: 42,
      name: "Login",
    });
    mocks.dataSetFindFirst.mockResolvedValue(null);
    mocks.dataSetCreate.mockResolvedValue({
      id: 99,
      name: "Login dataset",
      ownerCaseId: 7,
      projectId: 42,
      isShared: false,
    });

    const [req, ctx] = buildPost("7");
    const res = await POST(req, ctx);

    expect(res.status).toBe(200);
    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        entityType: "DataSet",
        entityId: "99",
        entityName: "Login dataset",
        projectId: 42,
        userId: "user-1",
        metadata: { isShared: false, ownerCaseId: 7 },
      })
    );
  });

  it("does not audit (or create) when a dataset is already attached", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({
      id: 7,
      projectId: 42,
      name: "Login",
    });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 50,
      name: "Login dataset",
      ownerCaseId: 7,
      projectId: 42,
      isShared: false,
    });

    const [req, ctx] = buildPost("7");
    const res = await POST(req, ctx);

    expect(res.status).toBe(200);
    expect(mocks.dataSetCreate).not.toHaveBeenCalled();
    expect(mocks.captureAuditEvent).not.toHaveBeenCalled();
  });
});
