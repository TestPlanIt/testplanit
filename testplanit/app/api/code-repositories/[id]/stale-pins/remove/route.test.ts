import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const { db } = vi.hoisted(() => ({
  db: {
    projectCodeRepositoryConfig: { findFirst: vi.fn() },
    repositoryCaseCodePin: { updateMany: vi.fn() },
  },
}));
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => db),
}));

vi.mock("~/lib/utils/errors", () => ({
  isAccessPolicyError: (error: unknown) =>
    error instanceof Error && error.message === "policy",
}));

import { getServerSession } from "next-auth/next";
import { POST } from "./route";

const session = { user: { id: "user-1" } };

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/code-repositories/8/stale-pins/remove",
    {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

function makeParams() {
  return { params: Promise.resolve({ id: "8" }) };
}

describe("POST /api/code-repositories/[id]/stale-pins/remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (getServerSession as any).mockResolvedValue(session);
    db.projectCodeRepositoryConfig.findFirst.mockResolvedValue({ id: 9 });
    db.repositoryCaseCodePin.updateMany.mockResolvedValue({ count: 3 });
  });

  it("returns 401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(401);
  });

  it("returns 400 without a config id or with a malformed body", async () => {
    expect((await POST(request({}), makeParams())).status).toBe(400);
    expect((await POST(request("{nope"), makeParams())).status).toBe(400);
    expect(db.repositoryCaseCodePin.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller cannot see an Impact config with that id", async () => {
    db.projectCodeRepositoryConfig.findFirst.mockResolvedValue(null);

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(404);
    expect(db.projectCodeRepositoryConfig.findFirst).toHaveBeenCalledWith({
      where: { id: 9, purpose: "IMPACT" },
      select: { id: true },
    });
  });

  it("soft-deletes the flagged, undismissed, unmanaged pins and reports the count", async () => {
    const res = await POST(request({ projectConfigId: "9" }), makeParams());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 3 });
    expect(db.repositoryCaseCodePin.updateMany).toHaveBeenCalledWith({
      where: {
        configId: 9,
        isDeleted: false,
        staleReason: { not: null },
        staleDismissedAt: null,
        source: { notIn: ["ANNOTATION", "MAPFILE"] },
      },
      data: { isDeleted: true, deletedAt: expect.any(Date) },
    });
  });

  it("maps a policy rejection to 403", async () => {
    db.repositoryCaseCodePin.updateMany.mockRejectedValue(new Error("policy"));

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(403);
  });

  it("returns 500 on an unexpected failure", async () => {
    db.repositoryCaseCodePin.updateMany.mockRejectedValue(new Error("db down"));

    const res = await POST(request({ projectConfigId: 9 }), makeParams());

    expect(res.status).toBe(500);
  });
});
