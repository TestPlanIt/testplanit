import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  baseDb: {
    integration: { findUnique: vi.fn() },
    userIntegrationAuth: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: vi.fn(),
  },
}));

import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth/next";

import { GET } from "./route";

function call(id: string, query = "") {
  const request = new NextRequest(
    `http://localhost/api/integrations/${id}/sprints${query}`
  );
  return GET(request, { params: Promise.resolve({ id }) });
}

describe("GET /api/integrations/[id]/sprints", () => {
  const getAdapter = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue({
      id: 7,
      authType: "API_KEY",
    } as any);
    vi.mocked(IntegrationManager.getInstance).mockReturnValue({
      getAdapter,
    } as any);
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await call("7", "?projectKey=PROJ");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("requires a projectKey", async () => {
    const response = await call("7");

    expect(response.status).toBe(400);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("answers 404 when the integration is missing or inactive", async () => {
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue(null);

    const response = await call("7", "?projectKey=PROJ");

    expect(response.status).toBe(404);
  });

  it("requires the user's own token on an OAuth integration", async () => {
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue({
      id: 7,
      authType: "OAUTH2",
    } as any);
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue(null);

    const response = await call("7", "?projectKey=PROJ");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("returns the project's open sprints, active first", async () => {
    const getExternalMilestones = vi.fn().mockResolvedValue({
      items: [
        { id: "12", kind: "ITERATION", name: "Sprint 12", state: "FUTURE" },
        { id: "11", kind: "ITERATION", name: "Sprint 11", state: "ACTIVE" },
        { id: "13", kind: "ITERATION", name: "Sprint 13", state: "FUTURE" },
        { id: "10", kind: "ITERATION", name: "Sprint 10", state: "CLOSED" },
        { id: "v1", kind: "RELEASE", name: "1.0", state: "ACTIVE" },
      ],
      hasMore: false,
    });
    getAdapter.mockResolvedValue({ getExternalMilestones });

    const response = await call("7", "?projectKey=PROJ");

    expect(response.status).toBe(200);
    expect(getExternalMilestones).toHaveBeenCalledWith({
      projectKey: "PROJ",
      kind: "ITERATION",
      includeClosed: false,
    });
    await expect(response.json()).resolves.toEqual({
      sprints: [
        { id: "11", name: "Sprint 11", state: "ACTIVE" },
        { id: "12", name: "Sprint 12", state: "FUTURE" },
        { id: "13", name: "Sprint 13", state: "FUTURE" },
      ],
    });
  });

  it("returns no sprints for a tracker without them", async () => {
    getAdapter.mockResolvedValue({});

    const response = await call("7", "?projectKey=PROJ");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sprints: [] });
  });

  it("surfaces a tracker failure as a 500", async () => {
    getAdapter.mockResolvedValue({
      getExternalMilestones: vi
        .fn()
        .mockRejectedValue(new Error("Jira API error (403)")),
    });

    const response = await call("7", "?projectKey=PROJ");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Jira API error (403)",
    });
  });
});
