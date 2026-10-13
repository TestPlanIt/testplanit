import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (h: any) => h,
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: vi.fn(),
  hasBearerToken: vi.fn(() => false),
}));

vi.mock("~/lib/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("~/lib/execution/executionTargetsService", () => ({
  createExecutionTargetForActor: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: { executionTarget: { findMany: vi.fn() } },
}));

vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: vi.fn(),
}));

import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { createExecutionTargetForActor } from "~/lib/execution/executionTargetsService";
import { getServerAuthSession } from "~/server/auth";
import { POST } from "./route";

const mockedSession = vi.mocked(getServerAuthSession);
const mockedAuth = vi.mocked(authenticateRequest);
const mockedHasBearer = vi.mocked(hasBearerToken);
const mockedRateLimit = vi.mocked(checkApiRateLimit);
const mockedCreate = vi.mocked(createExecutionTargetForActor);

function req(body: unknown) {
  return new NextRequest("https://x.test/api/projects/7/execution-targets", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const ctx = { params: Promise.resolve({ projectId: "7" }) };

describe("POST /api/projects/[projectId]/execution-targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue(null as any);
    mockedHasBearer.mockReturnValue(true);
    mockedRateLimit.mockResolvedValue({ allowed: true } as any);
  });

  it("401s when neither a session nor a valid token is present", async () => {
    mockedAuth.mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    } as any);
    const res = await POST(req({ name: "x" }), ctx as any);
    expect(res.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("429s a token caller over the rate limit before touching the service", async () => {
    mockedAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: "u1", access: "ADMIN" },
    } as any);
    mockedRateLimit.mockResolvedValue({ allowed: false } as any);
    const res = await POST(req({ name: "x" }), ctx as any);
    expect(res.status).toBe(429);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("delegates to createExecutionTargetForActor with the resolved actor and project id, returning 201 on success", async () => {
    mockedAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: "u1", access: "ADMIN" },
    } as any);
    mockedCreate.mockResolvedValue({
      success: true,
      target: { id: 9, name: "New target" } as any,
    });
    const body = {
      name: "New target",
      provider: "GENERIC_WEBHOOK",
      url: "https://ci.example.com",
    };
    const res = await POST(req(body), ctx as any);
    expect(mockedCreate).toHaveBeenCalledWith(
      { userId: "u1", access: "ADMIN" },
      7,
      body
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.target.id).toBe(9);
  });

  it("maps a Forbidden result from the service to 403", async () => {
    mockedAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: "u1", access: "MEMBER" },
    } as any);
    mockedCreate.mockResolvedValue({ success: false, error: "Forbidden" });
    const res = await POST(req({ name: "x" }), ctx as any);
    expect(res.status).toBe(403);
  });

  it("400s invalid JSON before calling the service", async () => {
    mockedAuth.mockResolvedValue({
      authenticated: true,
      user: { userId: "u1", access: "ADMIN" },
    } as any);
    const badReq = new NextRequest(
      "https://x.test/api/projects/7/execution-targets",
      {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json" },
      }
    );
    const res = await POST(badReq, ctx as any);
    expect(res.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });
});
