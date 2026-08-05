import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE importing the route handler.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiTokenForMethod: vi.fn(),
  extractBearerToken: (request: NextRequest) => {
    const header = request.headers.get("authorization");
    return header?.startsWith("Bearer ") ? header.slice(7) : null;
  },
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/auditContextWrappers", () => ({
  enrichFromApiAuth: vi.fn(),
  withAuditContext: <T extends (...args: any[]) => any>(handler: T): T =>
    handler,
}));

vi.mock("~/lib/services/reviewDecisions", () => ({
  decideReviewRequest: vi.fn(),
}));

import { authenticateApiTokenForMethod } from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { decideReviewRequest } from "~/lib/services/reviewDecisions";
import {
  FeatureDisabledError,
  IneligibleReviewerError,
} from "~/lib/utils/errors";
import { getServerAuthSession } from "~/server/auth";

// Importing the route AFTER mocks are registered so the route picks up mocks.
import { POST } from "./route";

const createMockRequest = (body: unknown, authHeader?: string): NextRequest => {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return {
    method: "POST",
    headers,
    json: async () => body,
    url: "http://localhost:3000/api/reviews/rr1/decide",
  } as unknown as NextRequest;
};

const context = { params: Promise.resolve({ id: "rr1" }) };

const tokenUser = {
  id: "u_token",
  name: "Token User",
  email: "token@example.com",
  access: "USER",
};

describe("POST /api/reviews/[id]/decide — API token path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerAuthSession).mockResolvedValue(null as any);
    vi.mocked(decideReviewRequest).mockResolvedValue({
      id: "rr1",
      status: "APPROVED",
    } as any);
    vi.mocked(baseDb.user.findUnique).mockResolvedValue(tokenUser as any);
    vi.mocked(authenticateApiTokenForMethod).mockResolvedValue({
      authenticated: true,
      userId: tokenUser.id,
      access: "USER",
      scopes: ["client:mcp"],
    });
  });

  it("decides as the token owner when no session is present", async () => {
    const response = await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(response.status).toBe(200);
    // The service receives a session shaped from the token identity: the
    // actor id, the access level (its ADMIN override) and the name that
    // lands on the paired comment / notification / webhook.
    const [session, reviewRequestId, decision] =
      vi.mocked(decideReviewRequest).mock.calls[0]!;
    expect(session.user).toMatchObject({
      id: "u_token",
      name: "Token User",
      access: "USER",
    });
    expect(reviewRequestId).toBe("rr1");
    expect(decision).toBe("APPROVED");
  });

  it("attributes the audit trail to the token owner", async () => {
    await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(enrichFromApiAuth).toHaveBeenCalledWith({
      userId: "u_token",
      userEmail: "token@example.com",
      userName: "Token User",
      scopes: ["client:mcp"],
    });
  });

  it("rejects a read-only token without touching the service", async () => {
    vi.mocked(authenticateApiTokenForMethod).mockResolvedValue({
      authenticated: false,
      error: "Token is read-only; write operations are not permitted.",
      errorCode: "READ_ONLY_TOKEN",
    });

    const response = await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_readonly"),
      context
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "READ_ONLY_TOKEN" },
    });
    expect(decideReviewRequest).not.toHaveBeenCalled();
  });

  it("still 401s with no session and no bearer token", async () => {
    const response = await POST(
      createMockRequest({ decision: "APPROVED" }),
      context
    );

    expect(response.status).toBe(401);
    expect(authenticateApiTokenForMethod).not.toHaveBeenCalled();
    expect(decideReviewRequest).not.toHaveBeenCalled();
  });

  it("prefers an existing session over the bearer token", async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: "u_session", name: "Sess", access: "ADMIN" },
    } as any);

    await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(authenticateApiTokenForMethod).not.toHaveBeenCalled();
    expect(vi.mocked(decideReviewRequest).mock.calls[0]![0].user.id).toBe(
      "u_session"
    );
  });

  it("401s when the token resolves to a user that no longer exists", async () => {
    vi.mocked(baseDb.user.findUnique).mockResolvedValue(null as any);

    const response = await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(response.status).toBe(401);
    expect(decideReviewRequest).not.toHaveBeenCalled();
  });

  it("still enforces the comment requirement for a token caller", async () => {
    const response = await POST(
      createMockRequest({ decision: "REJECTED" }, "Bearer tpi_abc"),
      context
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_BODY" },
    });
    expect(decideReviewRequest).not.toHaveBeenCalled();
  });

  it("maps an ineligible reviewer to 403", async () => {
    vi.mocked(decideReviewRequest).mockRejectedValue(
      new IneligibleReviewerError("u_token", "rr1")
    );

    const response = await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "INELIGIBLE_REVIEWER" },
    });
  });

  it("maps a disabled review feature to 403 rather than 500", async () => {
    vi.mocked(decideReviewRequest).mockRejectedValue(
      new FeatureDisabledError()
    );

    const response = await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FEATURE_DISABLED" },
    });
  });

  it("maps a concurrent decide to 409", async () => {
    vi.mocked(decideReviewRequest).mockRejectedValue(
      new Error("Review request already decided")
    );

    const response = await POST(
      createMockRequest({ decision: "APPROVED" }, "Bearer tpi_abc"),
      context
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "ALREADY_DECIDED" },
    });
  });
});
