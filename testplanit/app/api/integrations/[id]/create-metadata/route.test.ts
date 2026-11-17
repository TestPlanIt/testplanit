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
    projectIntegration: { findFirst: vi.fn() },
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

const metadata = {
  labels: [{ id: "bug", name: "bug", color: "d73a4a" }],
  milestones: [{ id: "4", title: "v1.2", state: "open", dueOn: null }],
  assignees: [{ id: "alice", name: "alice" }],
  issueTypes: [],
};

function call(id: string, query = "") {
  const request = new NextRequest(
    `http://localhost/api/integrations/${id}/create-metadata${query}`
  );
  return GET(request, { params: Promise.resolve({ id }) });
}

describe("GET /api/integrations/[id]/create-metadata", () => {
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

    const response = await call("7", "?projectKey=o/r");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("answers 404 when the integration is missing or inactive", async () => {
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue(null);

    const response = await call("7", "?projectKey=o/r");

    expect(response.status).toBe(404);
  });

  it("returns the adapter's lists for the requested project", async () => {
    const getCreateIssueMetadata = vi.fn().mockResolvedValue(metadata);
    getAdapter.mockResolvedValue({ getCreateIssueMetadata });

    const response = await call("7", "?projectKey=testowner%2Ftestrepo");

    expect(response.status).toBe(200);
    expect(getCreateIssueMetadata).toHaveBeenCalledWith("testowner/testrepo");
    await expect(response.json()).resolves.toEqual(metadata);
  });

  it("returns empty lists for a tracker that offers none", async () => {
    getAdapter.mockResolvedValue({});

    const response = await call("7", "?projectKey=KEY");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      labels: [],
      milestones: [],
      assignees: [],
      issueTypes: [],
    });
  });

  it("falls back to the project's saved key when none is given", async () => {
    vi.mocked(baseDb.projectIntegration.findFirst).mockResolvedValue({
      config: { externalProjectKey: "saved/repo" },
    } as any);
    const getCreateIssueMetadata = vi.fn().mockResolvedValue(metadata);
    getAdapter.mockResolvedValue({ getCreateIssueMetadata });

    const response = await call("7");

    expect(response.status).toBe(200);
    expect(getCreateIssueMetadata).toHaveBeenCalledWith("saved/repo");
  });

  it("requires the user's own token on an OAuth integration", async () => {
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue({
      id: 7,
      authType: "OAUTH2",
    } as any);
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue(null);

    const response = await call("7", "?projectKey=o/r");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("builds the adapter with the user's token on an OAuth integration", async () => {
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue({
      id: 7,
      authType: "OAUTH2",
    } as any);
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue({
      id: "auth-1",
    } as any);
    getAdapter.mockResolvedValue({
      getCreateIssueMetadata: vi.fn().mockResolvedValue(metadata),
    });

    await call("7", "?projectKey=o/r");

    expect(getAdapter).toHaveBeenCalledWith("7", undefined, "user-1");
  });
});
