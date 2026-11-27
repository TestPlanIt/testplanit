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
import { RefreshTokenRevokedError } from "~/lib/integrations/errors";

import { GET } from "./route";

function call(id: string, query = "?projectKey=PROJ") {
  const request = new NextRequest(
    `http://localhost/api/integrations/${id}/issue-types${query}`
  );
  return GET(request, { params: Promise.resolve({ id }) });
}

const issueTypes = [{ id: "10001", name: "Bug" }];

describe("GET /api/integrations/[id]/issue-types", () => {
  const getAdapter = vi.fn();

  const useIntegration = (authType: string) =>
    vi.mocked(baseDb.integration.findUnique).mockResolvedValue({
      id: 7,
      provider: "JIRA",
      authType,
    } as any);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    useIntegration("API_KEY");
    vi.mocked(IntegrationManager.getInstance).mockReturnValue({
      getAdapter,
    } as any);
    getAdapter.mockResolvedValue({
      getIssueTypes: vi.fn().mockResolvedValue(issueTypes),
    });
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await call("7");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("returns the tracker's issue types on the integration's stored credentials", async () => {
    const response = await call("7");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ issueTypes });
    expect(getAdapter).toHaveBeenCalledWith("7", undefined, undefined);
  });

  it("requires the user's own token on an OAuth integration", async () => {
    useIntegration("OAUTH2");
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue(null);

    const response = await call("7");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("builds the adapter with the user's token on an OAuth integration", async () => {
    useIntegration("OAUTH2");
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue({
      id: "auth-1",
    } as any);

    const response = await call("7");

    expect(response.status).toBe(200);
    expect(getAdapter).toHaveBeenCalledWith("7", undefined, "user-1");
  });

  it("prompts the user to reconnect when their OAuth authorization is dead", async () => {
    useIntegration("OAUTH2");
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue({
      id: "auth-1",
    } as any);
    getAdapter.mockRejectedValue(
      new RefreshTokenRevokedError("JIRA", "refresh_token is invalid")
    );

    const response = await call("7");
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.requiresAuth).toBe(true);
    expect(data.authUrl).toBe(
      "/api/integrations/oauth/jira/auth?integrationId=7&returnUrl=%2Fintegrations%2Fauth-complete"
    );
  });

  it("answers 500 for any other tracker failure", async () => {
    getAdapter.mockResolvedValue({
      getIssueTypes: vi.fn().mockRejectedValue(new Error("boom")),
    });

    const response = await call("7");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch issue types",
    });
  });
});
