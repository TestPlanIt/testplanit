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

  it("redirects to the returnUrl stored with the OAuth state, with success appended", async () => {
    verifyOAuthStateMock.mockResolvedValue({
      valid: true,
      userId: "user-1",
      returnUrl: "/integrations/auth-complete",
    });

    const response = await GET(buildGet("?code=abc&state=xyz"), params);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/integrations/auth-complete");
    expect(location).toContain("success=connected");
  });

  it("skips the integration status flip when the integration is already connected", async () => {
    // A regular project member re-authorizing: Integration updates are
    // ADMIN-only, so the flip must not even be attempted.
    integrationFindManyMock.mockResolvedValue([
      {
        id: 18,
        provider: "GITEA",
        status: "ACTIVE",
        settings: { connected: true },
      },
    ]);

    const response = await GET(buildGet("?code=abc&state=xyz"), params);

    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location") ?? "").toContain(
      "success=connected"
    );
    expect(integrationUpdateMock).not.toHaveBeenCalled();
    expect(storeUserAuthMock).toHaveBeenCalled();
  });

  it("still succeeds when the status flip is denied by the access policy", async () => {
    // First-connect shape but the caller lacks Integration update rights: the
    // token exchange already succeeded, so the flow must not turn a policy
    // denial into an error redirect.
    integrationUpdateMock.mockRejectedValue(
      new Error("denied by policy: integration entities failed 'update' check")
    );

    const response = await GET(buildGet("?code=abc&state=xyz"), params);

    expect([302, 307]).toContain(response.status);
    expect(response.headers.get("location") ?? "").toContain(
      "success=connected"
    );
    expect(storeUserAuthMock).toHaveBeenCalled();
  });

  it("redirects invalid state to the auth-complete page every user can view", async () => {
    verifyOAuthStateMock.mockResolvedValue({ valid: false });

    const response = await GET(buildGet("?code=abc&state=xyz"), params);

    expect([302, 307]).toContain(response.status);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/integrations/auth-complete");
    expect(location).toContain("invalid_state");
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
