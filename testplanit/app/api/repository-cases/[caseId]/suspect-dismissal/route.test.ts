// WR-02 (27.1-05): moves the suspect-dismissal clock from the browser to the
// server. Mirrors the co-located route unit-test convention this directory
// already uses (see ../latest-execution/route.test.ts and
// ../../projects/[projectId]/requirements/[issueId]/references/route.test.ts):
// vi.mock of next-auth, ~/server/auth, ~/lib/auth/utils (getEnhancedDb), and
// ~/lib/utils/errors, then a makeRequest helper.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/utils/errors", () => ({
  isNotFoundError: vi.fn(),
  isAccessPolicyError: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isAccessPolicyError, isNotFoundError } from "~/lib/utils/errors";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedGetEnhancedDb = getEnhancedDb as unknown as ReturnType<
  typeof vi.fn
>;
const mockedIsNotFoundError = isNotFoundError as unknown as ReturnType<
  typeof vi.fn
>;
const mockedIsAccessPolicyError = isAccessPolicyError as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(caseId = "5", body?: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/repository-cases/${caseId}/suspect-dismissal`,
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

const params = (caseId = "5") => ({
  params: Promise.resolve({ caseId }),
});

describe("POST /api/repository-cases/[caseId]/suspect-dismissal", () => {
  let mockUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockUpdate = vi.fn().mockResolvedValue({
      caseId: 5,
      issueId: 42,
      suspectDismissedAt: new Date(),
    });
    mockedGetEnhancedDb.mockResolvedValue({
      repositoryCaseIssue: { update: mockUpdate },
    });
    mockedIsNotFoundError.mockReturnValue(false);
    mockedIsAccessPolicyError.mockReturnValue(false);
  });

  it("returns 401 without a session, with the enhanced client never resolved", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(makeRequest("5", { issueId: 42 }), params("5"));

    expect(res.status).toBe(401);
    expect(mockedGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer caseId", async () => {
    const res = await POST(
      makeRequest("not-a-number", { issueId: 42 }),
      params("not-a-number")
    );

    expect(res.status).toBe(400);
    expect(mockedGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns 400 for a body with a missing issueId", async () => {
    const res = await POST(makeRequest("5", {}), params("5"));

    expect(res.status).toBe(400);
    expect(mockedGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("returns 400 for a body with a non-integer issueId", async () => {
    const res = await POST(
      makeRequest("5", { issueId: "not-a-number" }),
      params("5")
    );

    expect(res.status).toBe(400);
    expect(mockedGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("writes suspectDismissedAt from the server's own clock", async () => {
    const before = Date.now();

    const res = await POST(makeRequest("5", { issueId: 42 }), params("5"));

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { caseId_issueId: { caseId: 5, issueId: 42 } },
      data: { suspectDismissedAt: expect.any(Date) },
    });
    const writtenDate = mockUpdate.mock.calls[0][0].data.suspectDismissedAt;
    expect(Math.abs(writtenDate.getTime() - before)).toBeLessThan(5000);
  });

  it("ignores a client-supplied timestamp", async () => {
    const res = await POST(
      makeRequest("5", {
        issueId: 42,
        suspectDismissedAt: "1999-01-01T00:00:00.000Z",
      }),
      params("5")
    );

    expect(res.status).toBe(200);
    const writtenDate = mockUpdate.mock.calls[0][0].data.suspectDismissedAt;
    expect(writtenDate.toISOString()).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("returns 404 when the update throws a not-found error", async () => {
    mockUpdate.mockRejectedValue(new Error("not found"));
    mockedIsNotFoundError.mockReturnValue(true);

    const res = await POST(makeRequest("5", { issueId: 42 }), params("5"));

    expect(res.status).toBe(404);
  });

  it("returns 403 when the update throws an access-policy error", async () => {
    mockUpdate.mockRejectedValue(new Error("denied"));
    mockedIsAccessPolicyError.mockReturnValue(true);

    const res = await POST(makeRequest("5", { issueId: 42 }), params("5"));

    expect(res.status).toBe(403);
  });
});
