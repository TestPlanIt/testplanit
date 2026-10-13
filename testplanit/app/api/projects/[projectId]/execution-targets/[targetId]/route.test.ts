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
  getExecutionTargetForActor: vi.fn(),
  updateExecutionTargetForActor: vi.fn(),
  deleteExecutionTargetForActor: vi.fn(),
}));

import { authenticateRequest } from "~/lib/api-token-auth";
import {
  deleteExecutionTargetForActor,
  getExecutionTargetForActor,
  updateExecutionTargetForActor,
} from "~/lib/execution/executionTargetsService";
import { getServerAuthSession } from "~/server/auth";
import { DELETE, GET, PATCH } from "./route";

const mockedSession = vi.mocked(getServerAuthSession);
const mockedAuth = vi.mocked(authenticateRequest);
const mockedGet = vi.mocked(getExecutionTargetForActor);
const mockedUpdate = vi.mocked(updateExecutionTargetForActor);
const mockedDelete = vi.mocked(deleteExecutionTargetForActor);

const ctx = { params: Promise.resolve({ targetId: "4" }) };
const url = "https://x.test/api/projects/7/execution-targets/4";

function authedAsAdmin() {
  mockedSession.mockResolvedValue(null as any);
  mockedAuth.mockResolvedValue({
    authenticated: true,
    user: { userId: "u1", access: "ADMIN" },
  } as any);
}

describe("GET /api/projects/[projectId]/execution-targets/[targetId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400s a non-numeric target id without calling the service", async () => {
    authedAsAdmin();
    const res = await GET(new NextRequest(url), {
      params: Promise.resolve({ targetId: "nope" }),
    } as any);
    expect(res.status).toBe(400);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("404s when the service reports the target missing", async () => {
    authedAsAdmin();
    mockedGet.mockResolvedValue({ success: false, error: "Target not found" });
    const res = await GET(new NextRequest(url), ctx as any);
    expect(res.status).toBe(404);
  });

  it("returns the target on success", async () => {
    authedAsAdmin();
    mockedGet.mockResolvedValue({
      success: true,
      target: { id: 4, name: "Admin E2E" } as any,
    });
    const res = await GET(new NextRequest(url), ctx as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.target.name).toBe("Admin E2E");
  });
});

describe("PATCH /api/projects/[projectId]/execution-targets/[targetId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates the parsed body and actor to updateExecutionTargetForActor", async () => {
    authedAsAdmin();
    mockedUpdate.mockResolvedValue({
      success: true,
      target: { id: 4, paramSchema: [{ name: "STACK" }] } as any,
    });
    const body = { paramSchema: [{ name: "STACK" }] };
    const res = await PATCH(
      new NextRequest(url, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      ctx as any
    );
    expect(mockedUpdate).toHaveBeenCalledWith(
      { userId: "u1", access: "ADMIN" },
      4,
      body
    );
    expect(res.status).toBe(200);
  });

  it("maps a validation error to 422", async () => {
    authedAsAdmin();
    mockedUpdate.mockResolvedValue({
      success: false,
      error: "A target with this name already exists",
      errorCode: "automation.settings.errors.nameTaken",
    });
    const res = await PATCH(
      new NextRequest(url, {
        method: "PATCH",
        body: JSON.stringify({ name: "dup" }),
        headers: { "content-type": "application/json" },
      }),
      ctx as any
    );
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/projects/[projectId]/execution-targets/[targetId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 204 on success", async () => {
    authedAsAdmin();
    mockedDelete.mockResolvedValue({ success: true });
    const res = await DELETE(
      new NextRequest(url, { method: "DELETE" }),
      ctx as any
    );
    expect(res.status).toBe(204);
  });

  it("403s when the service reports Forbidden", async () => {
    authedAsAdmin();
    mockedDelete.mockResolvedValue({ success: false, error: "Forbidden" });
    const res = await DELETE(
      new NextRequest(url, { method: "DELETE" }),
      ctx as any
    );
    expect(res.status).toBe(403);
  });
});
