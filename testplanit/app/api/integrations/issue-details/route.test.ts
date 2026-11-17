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
  },
}));

vi.mock("@/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock("@/lib/integrations/services/SyncService", () => ({
  syncService: {
    _resolveGitHubIssueIdForSync: vi.fn(),
  },
}));

import { baseDb } from "@/lib/db";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import { syncService } from "@/lib/integrations/services/SyncService";
import { getServerSession } from "next-auth/next";

import { GET } from "./route";

const createRequest = (query: Record<string, string>): NextRequest => {
  const url = new URL("http://localhost/api/integrations/issue-details");
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString());
};

const findUnique = baseDb.integration.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const resolveGitHubIssueId =
  syncService._resolveGitHubIssueIdForSync as unknown as ReturnType<
    typeof vi.fn
  >;

const githubIssue = {
  id: "7",
  key: "#7",
  title: "Crash on upload",
  description: "Steps",
  status: "open",
  assignees: [{ id: "ada", name: "ada" }],
  labels: ["bug"],
  milestone: { id: "3", name: "v1.2", state: "open" },
  commentCount: 2,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  url: "https://github.com/acme/app/issues/7",
};

let getIssue: ReturnType<typeof vi.fn>;

describe("GET /api/integrations/issue-details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    (getServerSession as any).mockResolvedValue({ user: { id: "user-1" } });
    getIssue = vi.fn().mockResolvedValue(githubIssue);
    (IntegrationManager.getInstance as any).mockReturnValue({
      getAdapter: vi.fn().mockResolvedValue({ getIssue }),
    });
    findUnique.mockResolvedValue({ id: 3, provider: "GITHUB" });
    resolveGitHubIssueId.mockResolvedValue("acme/app#7");
  });

  it("rejects an anonymous request", async () => {
    (getServerSession as any).mockResolvedValue(null);

    const response = await GET(
      createRequest({ issueKey: "#7", integrationId: "3" })
    );

    expect(response.status).toBe(401);
    expect(getIssue).not.toHaveBeenCalled();
  });

  it("rejects a request without an issue key or integration", async () => {
    expect((await GET(createRequest({ issueKey: "#7" }))).status).toBe(400);
    expect(
      (await GET(createRequest({ issueKey: "#7", integrationId: "x" }))).status
    ).toBe(400);
  });

  it("returns 404 for an integration that is missing or inactive", async () => {
    findUnique.mockResolvedValue(null);

    const response = await GET(
      createRequest({ issueKey: "#7", integrationId: "3" })
    );

    expect(response.status).toBe(404);
  });

  it("resolves a bare GitHub key to its repository before asking the tracker", async () => {
    const response = await GET(
      createRequest({ issueKey: "#7", integrationId: "3" })
    );

    expect(resolveGitHubIssueId).toHaveBeenCalledWith(baseDb, 3, "#7");
    expect(getIssue).toHaveBeenCalledWith("acme/app#7");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      key: "#7",
      url: "https://github.com/acme/app/issues/7",
      summary: "Crash on upload",
      status: { name: "open", color: "blue" },
      priority: null,
      assignees: [{ displayName: "ada" }],
      labels: ["bug"],
      milestone: { name: "v1.2", state: "open" },
      commentCount: 2,
      updated: "2026-10-02T00:00:00.000Z",
    });
  });

  it("asks the tracker with the key as given when the repository cannot be resolved", async () => {
    resolveGitHubIssueId.mockRejectedValue(new Error("no stored issue"));

    await GET(createRequest({ issueKey: "acme/app#7", integrationId: "3" }));

    expect(getIssue).toHaveBeenCalledWith("acme/app#7");
  });

  it("passes a Jira key straight through", async () => {
    findUnique.mockResolvedValue({ id: 9, provider: "JIRA" });
    getIssue.mockResolvedValue({
      ...githubIssue,
      key: "PROJ-12",
      status: "Done",
      priority: "High",
      issueType: { id: "1", name: "Bug" },
    });

    const response = await GET(
      createRequest({ issueKey: "PROJ-12", integrationId: "9" })
    );

    expect(resolveGitHubIssueId).not.toHaveBeenCalled();
    expect(getIssue).toHaveBeenCalledWith("PROJ-12");
    expect(await response.json()).toMatchObject({
      key: "PROJ-12",
      status: { name: "Done", color: "green" },
      priority: { name: "High" },
      issueType: { name: "Bug" },
    });
  });

  it("maps a tracker authentication failure to 401", async () => {
    getIssue.mockRejectedValue(new Error("GitHub API error: 401"));

    const response = await GET(
      createRequest({ issueKey: "#7", integrationId: "3" })
    );

    expect(response.status).toBe(401);
  });
});
