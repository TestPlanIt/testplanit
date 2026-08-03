import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const integrationFindUniqueMock = vi.fn();
const userIntegrationAuthFindFirstMock = vi.fn();
vi.mock("@/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    integration: { findUnique: integrationFindUniqueMock },
    userIntegrationAuth: { findFirst: userIntegrationAuthFindFirstMock },
  })),
}));

import { getServerSession } from "next-auth";

import { GET } from "./route";

const mockSession = { user: { id: "user-1" } };

const buildGet = () =>
  new NextRequest("http://localhost/api/integrations/1/auth/check");

const params = { params: Promise.resolve({ id: "1" }) };

describe("GET /api/integrations/[id]/auth/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(mockSession);
  });

  it("returns 401 when there is no session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const response = await GET(buildGet(), params);
    expect(response.status).toBe(401);
  });

  it("returns 404 when the integration is not found", async () => {
    integrationFindUniqueMock.mockResolvedValue(null);
    const response = await GET(buildGet(), params);
    expect(response.status).toBe(404);
  });

  it("treats PAT integrations as authenticated at the integration level", async () => {
    integrationFindUniqueMock.mockResolvedValue({
      id: 1,
      provider: "GITHUB",
      authType: "PERSONAL_ACCESS_TOKEN",
    });
    const response = await GET(buildGet(), params);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.authenticated).toBe(true);
    expect(userIntegrationAuthFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 401 with an authUrl when the user has not authorized an OAuth integration", async () => {
    integrationFindUniqueMock.mockResolvedValue({
      id: 1,
      provider: "GITLAB",
      authType: "OAUTH2",
    });
    userIntegrationAuthFindFirstMock.mockResolvedValue(null);

    const response = await GET(buildGet(), params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.authUrl).toBe(
      "/api/integrations/oauth/gitlab/auth?integrationId=1&returnUrl=%2Fintegrations%2Fauth-complete"
    );
  });

  it("treats an expired token as authenticated when a refresh token exists", async () => {
    integrationFindUniqueMock.mockResolvedValue({
      id: 1,
      provider: "GITLAB",
      authType: "OAUTH2",
    });
    userIntegrationAuthFindFirstMock.mockResolvedValue({
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshToken: "encrypted-refresh",
    });

    const response = await GET(buildGet(), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.authenticated).toBe(true);
  });

  it("returns 401 with an authUrl when an expired token has no refresh token", async () => {
    integrationFindUniqueMock.mockResolvedValue({
      id: 1,
      provider: "GITEA",
      authType: "OAUTH2",
    });
    userIntegrationAuthFindFirstMock.mockResolvedValue({
      tokenExpiresAt: new Date(Date.now() - 1000),
      refreshToken: null,
    });

    const response = await GET(buildGet(), params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Token expired");
    expect(data.authUrl).toBe(
      "/api/integrations/oauth/gitea/auth?integrationId=1&returnUrl=%2Fintegrations%2Fauth-complete"
    );
  });

  it("returns authenticated for a valid, unexpired OAuth token", async () => {
    integrationFindUniqueMock.mockResolvedValue({
      id: 1,
      provider: "JIRA",
      authType: "OAUTH2",
    });
    userIntegrationAuthFindFirstMock.mockResolvedValue({
      tokenExpiresAt: new Date(Date.now() + 3600_000),
      refreshToken: "encrypted-refresh",
    });

    const response = await GET(buildGet(), params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.authenticated).toBe(true);
  });
});
