import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE importing the route handler.
vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiToken: vi.fn(),
}));

const { mockConfigurations } = vi.hoisted(() => ({
  mockConfigurations: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    configurations: mockConfigurations,
  },
}));

import { getServerAuthSession } from "~/server/auth";
import { POST } from "./route";

const createMockRequest = (body: unknown): NextRequest =>
  ({
    method: "POST",
    headers: new Headers(),
    json: async () => body,
    url: "http://localhost:3000/api/cli/lookup",
  }) as unknown as NextRequest;

describe("CLI lookup route — config scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerAuthSession as any).mockResolvedValue({ user: { id: "u_1" } });
    mockConfigurations.findFirst.mockResolvedValue({ id: 9, name: "Chrome" });
  });

  it("scopes the config lookup to the project when projectId is provided", async () => {
    const res = await POST(
      createMockRequest({ type: "config", name: "Chrome", projectId: 42 })
    );

    expect(res.status).toBe(200);
    const where = mockConfigurations.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      name: "Chrome",
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId: 42 } },
    });
  });

  it("does a global lookup when no projectId is provided", async () => {
    const res = await POST(
      createMockRequest({ type: "config", name: "Chrome" })
    );

    expect(res.status).toBe(200);
    const where = mockConfigurations.findFirst.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("projects");
  });

  it("returns 404 when the configuration is not found in the project", async () => {
    mockConfigurations.findFirst.mockResolvedValue(null);

    const res = await POST(
      createMockRequest({ type: "config", name: "Missing", projectId: 42 })
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe("NOT_FOUND");
  });
});
