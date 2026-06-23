import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Shared mock fns (hoisted so the vi.mock factories can reference them).
const {
  getServerSessionMock,
  getEnhancedDbMock,
  integrationFindManyMock,
  integrationUpdateMock,
  verifyOAuthStateMock,
  storeUserAuthMock,
  cleanupOAuthStateMock,
  getAdapterMock,
  clearAdapterMock,
  exchangeCodeForTokensMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getEnhancedDbMock: vi.fn(),
  integrationFindManyMock: vi.fn(),
  integrationUpdateMock: vi.fn(),
  verifyOAuthStateMock: vi.fn(),
  storeUserAuthMock: vi.fn(),
  cleanupOAuthStateMock: vi.fn(),
  getAdapterMock: vi.fn(),
  clearAdapterMock: vi.fn(),
  exchangeCodeForTokensMock: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/auth/utils", () => ({ getEnhancedDb: getEnhancedDbMock }));
vi.mock("~/lib/integrations/AuthenticationService", () => ({
  AuthenticationService: {
    verifyOAuthState: verifyOAuthStateMock,
    storeUserAuth: storeUserAuthMock,
    cleanupOAuthState: cleanupOAuthStateMock,
  },
}));
vi.mock("~/lib/integrations/IntegrationManager", () => ({
  IntegrationManager: {
    getInstance: () => ({
      getAdapter: getAdapterMock,
      clearAdapter: clearAdapterMock,
    }),
  },
}));

import { GET } from "./route";

const buildGet = (query: string) =>
  new NextRequest(
    `http://localhost:3000/api/integrations/oauth/gitea/callback${query}`
  );
const params = { params: Promise.resolve({ type: "gitea" }) };

describe("GET /api/integrations/oauth/[type]/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    getEnhancedDbMock.mockResolvedValue({
      integration: {
        findMany: integrationFindManyMock,
        update: integrationUpdateMock,
      },
    });
    integrationFindManyMock.mockResolvedValue([
      { id: 18, provider: "GITEA", settings: {} },
    ]);
    integrationUpdateMock.mockResolvedValue({});
    verifyOAuthStateMock.mockResolvedValue({ valid: true, userId: "user-1" });
    storeUserAuthMock.mockResolvedValue(undefined);
    cleanupOAuthStateMock.mockResolvedValue(undefined);
    exchangeCodeForTokensMock.mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000),
    });
    getAdapterMock.mockResolvedValue({
      exchangeCodeForTokens: exchangeCodeForTokensMock,
    });
  });

  it("redirects to an absolute success URL and stores the token on the happy path", async () => {
    const response = await GET(buildGet("?code=abc&state=xyz"), params);

    // Must be a redirect (NextResponse.redirect → 307), never a 500.
    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("http")).toBe(true);
    expect(location).toContain("success=connected");

    expect(storeUserAuthMock).toHaveBeenCalledWith("user-1", 18, {
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: expect.any(Date),
    });
    // Stale (pre-token) adapter is evicted so later requests rebuild with the token.
    expect(clearAdapterMock).toHaveBeenCalledWith("18");
  });

  it("redirects to an absolute error URL when oauth params are missing", async () => {
    const response = await GET(buildGet(""), params);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("http")).toBe(true);
    expect(location).toContain("missing_oauth_params");
  });

  it("redirects (not 500) to an absolute error URL when token exchange fails", async () => {
    exchangeCodeForTokensMock.mockRejectedValue(
      new Error("token endpoint 500")
    );

    const response = await GET(buildGet("?code=abc&state=xyz"), params);

    // The bug this guards: a relative redirect in the catch block threw and
    // produced a 500. It must be an absolute redirect instead.
    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("http")).toBe(true);
    expect(location).toContain("oauth_callback_failed");
  });

  it("builds the redirect from NEXTAUTH_URL, not the (internal) request host", async () => {
    // Behind the k8s ingress the request arrives with the pod hostname; the
    // post-auth redirect must use the public app URL or the browser lands on
    // a connection error after a successful authorization.
    vi.stubEnv("NEXTAUTH_URL", "https://demo.testplanit.com");
    const req = new NextRequest(
      "http://demo-prod-abc123/api/integrations/oauth/gitea/callback?code=abc&state=xyz"
    );

    const response = await GET(req, params);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("https://demo.testplanit.com/")).toBe(true);
    expect(location).not.toContain("demo-prod-abc123");
    expect(location).toContain("success=connected");

    vi.unstubAllEnvs();
  });
});
