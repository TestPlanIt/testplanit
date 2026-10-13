import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through the audit wrapper so POST keeps its (request, { params }) shape.
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (h: any) => h,
  enrichFromApiAuth: vi.fn(),
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/api-token-auth", () => ({
  extractBearerToken: vi.fn(),
  authenticateApiTokenForMethod: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    repositoryCases: { findUnique: vi.fn() },
    projects: { findFirst: vi.fn() },
  },
}));

const txStub = vi.hoisted(() => ({
  repositoryCases: { update: vi.fn() },
}));

vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: vi.fn(async (fn: any) => fn(txStub)),
}));

vi.mock("~/lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: vi.fn(async () => ({
    id: 900,
    version: 2,
  })),
}));

import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { getServerSession } from "next-auth";
import { POST } from "./route";

const createVersionMock = createTestCaseVersionInTransaction as any;

function createRequest(
  body: any,
  caseId = "42",
  headers: Record<string, string> = {}
): [NextRequest, { params: Promise<{ caseId: string }> }] {
  const request = {
    json: async () => body,
    headers: new Headers(headers),
    method: "POST",
  } as unknown as NextRequest;
  return [request, { params: Promise.resolve({ caseId }) }];
}

function useApiToken(overrides: Record<string, unknown> = {}): void {
  (getServerSession as any).mockResolvedValue(null);
  (extractBearerToken as any).mockReturnValue("tpi_token");
  (authenticateApiTokenForMethod as any).mockResolvedValue({
    authenticated: true,
    userId: "api-user",
    userName: "API User",
    userEmail: "api@example.com",
    access: "USER",
    scopes: ["client:mcp"],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  txStub.repositoryCases.update.mockResolvedValue({ currentVersion: 2 });
  (baseDb as any).repositoryCases.findUnique.mockResolvedValue({
    id: 42,
    projectId: 7,
  });
  (baseDb as any).projects.findFirst.mockResolvedValue({ id: 7 });
  createVersionMock.mockResolvedValue({ id: 900, version: 2 });
});

describe("POST /api/repository/cases/[caseId]/versions", () => {
  it("rejects a request with neither a session nor a Bearer token", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (extractBearerToken as any).mockReturnValue(null);

    const response = await POST(...createRequest({}));

    expect(response.status).toBe(401);
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  // #598: an API client could change a case through /api/model but had no way
  // to record the version for it — this endpoint was session-only.
  it("accepts an API token and snapshots the case", async () => {
    useApiToken();

    const response = await POST(
      ...createRequest({ copyFieldValues: true }, "42", {
        authorization: "Bearer tpi_token",
      })
    );

    expect(response.status).toBe(200);
    expect(enrichFromApiAuth).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "api-user" })
    );
    expect(createVersionMock).toHaveBeenCalledWith(
      txStub,
      42,
      expect.objectContaining({
        creatorId: "api-user",
        creatorName: "API User",
        copyFieldValues: true,
      })
    );
  });

  it("rejects a read-only token with 403", async () => {
    (getServerSession as any).mockResolvedValue(null);
    (extractBearerToken as any).mockReturnValue("tpi_token");
    (authenticateApiTokenForMethod as any).mockResolvedValue({
      authenticated: false,
      error: "Token is read-only; write operations are not permitted.",
      errorCode: "READ_ONLY_TOKEN",
    });

    const response = await POST(...createRequest({}));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "READ_ONLY_TOKEN",
    });
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it("bumpVersion increments currentVersion and snapshots at the new number", async () => {
    useApiToken();
    txStub.repositoryCases.update.mockResolvedValue({ currentVersion: 5 });

    const response = await POST(...createRequest({ bumpVersion: true }));

    expect(response.status).toBe(200);
    expect(txStub.repositoryCases.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { currentVersion: { increment: 1 } },
      select: { currentVersion: true },
    });
    expect(createVersionMock).toHaveBeenCalledWith(
      txStub,
      42,
      expect.objectContaining({ version: 5 })
    );
  });

  it("does not touch currentVersion without bumpVersion", async () => {
    useApiToken();

    await POST(...createRequest({}));

    expect(txStub.repositoryCases.update).not.toHaveBeenCalled();
    expect(createVersionMock.mock.calls[0][2]).not.toHaveProperty("version");
  });

  it("refuses bumpVersion together with an explicit version", async () => {
    useApiToken();

    const response = await POST(
      ...createRequest({ bumpVersion: true, version: 3 })
    );

    expect(response.status).toBe(400);
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it("404s when the case is not in a project the caller can reach", async () => {
    useApiToken();
    (baseDb as any).projects.findFirst.mockResolvedValue(null);

    const response = await POST(...createRequest({}));

    expect(response.status).toBe(404);
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it("404s on a missing case", async () => {
    useApiToken();
    (baseDb as any).repositoryCases.findUnique.mockResolvedValue(null);

    const response = await POST(...createRequest({}));

    expect(response.status).toBe(404);
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it("keeps the session path's creator metadata and overrides", async () => {
    (getServerSession as any).mockResolvedValue({
      user: {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        access: "ADMIN",
      },
    });

    const response = await POST(
      ...createRequest({
        creatorId: "original-author",
        creatorName: "Original Author",
        overrides: { name: "Renamed", tags: ["smoke"] },
      })
    );

    expect(response.status).toBe(200);
    expect(createVersionMock).toHaveBeenCalledWith(
      txStub,
      42,
      expect.objectContaining({
        creatorId: "original-author",
        creatorName: "Original Author",
        overrides: { name: "Renamed", tags: ["smoke"] },
      })
    );
  });
});
