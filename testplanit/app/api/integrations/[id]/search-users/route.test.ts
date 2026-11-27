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
import { RefreshTokenRevokedError } from "~/lib/integrations/errors";

import { GET } from "./route";

function call(id: string, query = "?query=al&projectKey=PROJ") {
  const request = new NextRequest(
    `http://localhost/api/integrations/${id}/search-users${query}`
  );
  return GET(request, { params: Promise.resolve({ id }) });
}

const users = [{ accountId: "a1", displayName: "Alice" }];

describe("GET /api/integrations/[id]/search-users", () => {
  const getAdapter = vi.fn();
  const searchUsers = vi.fn();

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
    searchUsers.mockResolvedValue({ users, total: 1 });
    getAdapter.mockResolvedValue({ searchUsers });
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await call("7");

    expect(response.status).toBe(401);
    expect(getAdapter).not.toHaveBeenCalled();
  });

  it("searches on the integration's stored credentials without looking up user auth", async () => {
    const response = await call("7");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ users, total: 1 });
    expect(searchUsers).toHaveBeenCalledWith("al", "PROJ", 0, 50);
    expect(baseDb.userIntegrationAuth.findFirst).not.toHaveBeenCalled();
    expect(getAdapter).toHaveBeenCalledWith("7", undefined, undefined);
  });

  it("searches with the caller's own authorization on an OAuth integration", async () => {
    useIntegration("OAUTH2");
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue({
      id: "auth-1",
    } as any);

    const response = await call("7");

    expect(response.status).toBe(200);
    expect(baseDb.userIntegrationAuth.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1", integrationId: 7, isActive: true },
      select: { id: true },
    });
    expect(getAdapter).toHaveBeenCalledWith("7", undefined, "user-1");
  });

  it("borrows the integration's authorization for an OAuth caller who has none", async () => {
    useIntegration("OAUTH2");
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue(null);

    const response = await call("7");

    expect(response.status).toBe(200);
    expect(getAdapter).toHaveBeenCalledWith("7", undefined, undefined);
  });

  it("prompts the caller to reconnect when their own OAuth authorization is dead", async () => {
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

  it("does not prompt a borrowing caller to reconnect an authorization that is not theirs", async () => {
    useIntegration("OAUTH2");
    vi.mocked(baseDb.userIntegrationAuth.findFirst).mockResolvedValue(null);
    getAdapter.mockRejectedValue(
      new RefreshTokenRevokedError("JIRA", "refresh_token is invalid")
    );

    const response = await call("7");
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.requiresAuth).toBeUndefined();
  });
});
