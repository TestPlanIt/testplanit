import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Shared mock fns (hoisted so the vi.mock factories can reference them).
const {
  getServerSessionMock,
  getEnhancedDbMock,
  integrationFindUniqueMock,
  generateStateMock,
  storeOAuthStateMock,
  getAdapterMock,
  getAuthorizationUrlMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getEnhancedDbMock: vi.fn(),
  integrationFindUniqueMock: vi.fn(),
  generateStateMock: vi.fn(),
  storeOAuthStateMock: vi.fn(),
  getAdapterMock: vi.fn(),
  getAuthorizationUrlMock: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/utils", () => ({ getEnhancedDb: getEnhancedDbMock }));
vi.mock("~/lib/integrations/AuthenticationService", () => ({
  AuthenticationService: {
    generateState: generateStateMock,
    storeOAuthState: storeOAuthStateMock,
  },
}));
vi.mock("~/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: () => ({ getAdapter: getAdapterMock }),
  },
}));

import { GET } from "./route";

const buildGet = (query: string) =>
  new NextRequest(
    `http://localhost:3000/api/integrations/oauth/jira/auth${query}`
  );
const params = { params: Promise.resolve({ type: "jira" }) };

describe("GET /api/integrations/oauth/[type]/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    getEnhancedDbMock.mockResolvedValue({
      integration: { findUnique: integrationFindUniqueMock },
    });
    // The integration is INACTIVE — the exact state an OAuth integration is in
    // before its first authorization, and the state that previously made
    // getAdapter throw "Integration is not active" → a 500 on this route.
    integrationFindUniqueMock.mockResolvedValue({
      id: 2,
      provider: "JIRA",
      status: "INACTIVE",
      authType: "OAUTH2",
    });
    generateStateMock.mockReturnValue("state-123");
    storeOAuthStateMock.mockResolvedValue(undefined);
    getAuthorizationUrlMock.mockReturnValue(
      "https://auth.atlassian.com/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp%2Fapi%2Fintegrations%2Foauth%2Fjira%2Fcallback&state=state-123&response_type=code"
    );
    getAdapterMock.mockResolvedValue({
      supportsOAuth: true,
      getAuthorizationUrl: getAuthorizationUrlMock,
    });
  });

  it("redirects an INACTIVE OAuth integration to the provider authorize URL (no 500 deadlock)", async () => {
    const response = await GET(buildGet("?integrationId=2"), params);

    // Must be a redirect to the provider, never a 500. Before the fix,
    // getAdapter threw on the inactive integration and this route 500'd.
    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location") ?? "").toContain(
      "https://auth.atlassian.com/authorize"
    );
  });

  it("builds the adapter with allowInactive so the active-check doesn't block setup", async () => {
    await GET(buildGet("?integrationId=2"), params);

    // The wiring that breaks the deadlock: the route must ask getAdapter to
    // allow an inactive integration during the authorization handshake.
    expect(getAdapterMock).toHaveBeenCalledWith(
      "2",
      undefined,
      undefined,
      expect.objectContaining({ allowInactive: true })
    );
    expect(storeOAuthStateMock).toHaveBeenCalledWith("user-1", 2, "state-123");
  });

  it("returns 400 when integrationId is missing", async () => {
    const response = await GET(buildGet(""), params);
    expect(response.status).toBe(400);
  });
});
