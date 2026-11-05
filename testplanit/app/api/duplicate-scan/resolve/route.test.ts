import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockIsProjectAdminFor,
  mockUserHasAreaPermission,
  mockCaptureAuditEvent,
  mockMergeCases,
  mockLinkCases,
  mockLinkPairs,
  mockDismissPair,
  mockDismissPairs,
  mockCaseCount,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockIsProjectAdminFor: vi.fn(),
  mockUserHasAreaPermission: vi.fn(),
  mockCaptureAuditEvent: vi.fn(),
  mockMergeCases: vi.fn(),
  mockLinkCases: vi.fn(),
  mockLinkPairs: vi.fn(),
  mockDismissPair: vi.fn(),
  mockDismissPairs: vi.fn(),
  mockCaseCount: vi.fn(),
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: (...args: any[]) => any) => handler,
}));

vi.mock("next-auth", () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
}));

vi.mock("~/lib/services/areaPermission", () => ({
  isProjectAdminFor: (...args: any[]) => mockIsProjectAdminFor(...args),
  userHasAreaPermission: (...args: any[]) => mockUserHasAreaPermission(...args),
}));

vi.mock("~/lib/rawDb", () => ({
  rawDb: {
    repositoryCases: { count: (...args: any[]) => mockCaseCount(...args) },
  },
}));

vi.mock("~/lib/services/mergeService", () => ({
  mergeCases: (...args: any[]) => mockMergeCases(...args),
  linkCases: (...args: any[]) => mockLinkCases(...args),
  linkPairs: (...args: any[]) => mockLinkPairs(...args),
  dismissPair: (...args: any[]) => mockDismissPair(...args),
  dismissPairs: (...args: any[]) => mockDismissPairs(...args),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/duplicate-scan/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const pairs = [
  { caseAId: 1, caseBId: 2 },
  { caseAId: 3, caseBId: 4 },
];

describe("POST /api/duplicate-scan/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: "user-1", email: "u@example.com" },
    });
    mockIsProjectAdminFor.mockResolvedValue(false);
    mockUserHasAreaPermission.mockResolvedValue(true);
    mockDismissPairs.mockResolvedValue({ dismissed: 2 });
    mockLinkPairs.mockResolvedValue({ linked: 2 });
    mockMergeCases.mockResolvedValue({ survivorId: 1, summary: {} });
  });

  it("returns 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(
      makeRequest({ action: "bulkDismiss", projectId: 5, pairs })
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user cannot edit the repository", async () => {
    mockUserHasAreaPermission.mockResolvedValue(false);
    const res = await POST(
      makeRequest({ action: "bulkDismiss", projectId: 5, pairs })
    );
    expect(res.status).toBe(403);
    expect(mockDismissPairs).not.toHaveBeenCalled();
  });

  it("allows project admins without the area permission", async () => {
    mockIsProjectAdminFor.mockResolvedValue(true);
    mockUserHasAreaPermission.mockResolvedValue(false);
    const res = await POST(
      makeRequest({ action: "dismiss", projectId: 5, caseAId: 1, caseBId: 2 })
    );
    expect(res.status).toBe(200);
    expect(mockDismissPair).toHaveBeenCalledWith(1, 2, 5);
  });

  it("bulkDismiss resolves all pairs in one call with one audit event", async () => {
    const res = await POST(
      makeRequest({ action: "bulkDismiss", projectId: 5, pairs })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ action: "bulkDismiss", dismissed: 2 });
    expect(mockDismissPairs).toHaveBeenCalledWith(pairs, 5);
    expect(mockCaptureAuditEvent).toHaveBeenCalledOnce();
    expect(mockCaptureAuditEvent.mock.calls[0][0].metadata).toMatchObject({
      resolution: "dismiss",
      bulk: true,
      pairCount: 2,
    });
  });

  it("bulkLink resolves all pairs in one call", async () => {
    const res = await POST(
      makeRequest({ action: "bulkLink", projectId: 5, pairs })
    );
    expect(res.status).toBe(200);
    expect(mockLinkPairs).toHaveBeenCalledWith(pairs, "user-1", 5);
    expect(mockCaptureAuditEvent).toHaveBeenCalledOnce();
  });

  it("rejects an empty bulk selection", async () => {
    const res = await POST(
      makeRequest({ action: "bulkDismiss", projectId: 5, pairs: [] })
    );
    expect(res.status).toBe(400);
  });

  it("refuses to merge cases outside the authorized project", async () => {
    mockCaseCount.mockResolvedValue(1);
    const res = await POST(
      makeRequest({ action: "merge", projectId: 5, survivorId: 1, victimId: 2 })
    );
    expect(res.status).toBe(404);
    expect(mockMergeCases).not.toHaveBeenCalled();
  });

  it("merges when both cases are in the project", async () => {
    mockCaseCount.mockResolvedValue(2);
    const res = await POST(
      makeRequest({ action: "merge", projectId: 5, survivorId: 1, victimId: 2 })
    );
    expect(res.status).toBe(200);
    expect(mockMergeCases).toHaveBeenCalledWith(1, 2, "user-1");
  });
});
