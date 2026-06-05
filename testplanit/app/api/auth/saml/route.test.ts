// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

// No Valkey in unit tests → RelayState falls back to a signed token.
vi.mock("~/lib/valkey", () => ({ default: null }));

vi.mock("~/server/db", () => ({
  db: { samlConfiguration: { findUnique: vi.fn() } },
}));

const getAuthorizeUrlAsync = vi.fn();
vi.mock("~/server/saml-provider", () => ({
  createSAMLClient: vi.fn(async () => ({ getAuthorizeUrlAsync })),
}));

import { db } from "~/server/db";
import { GET } from "./route";

function makeReq(provider: string | null, callbackUrl = "/dash") {
  const sp = new URLSearchParams();
  if (provider) sp.set("provider", provider);
  sp.set("callbackUrl", callbackUrl);
  return {
    nextUrl: { searchParams: sp },
    headers: new Headers(),
    url: "https://cint-prod-pod:3000/api/auth/saml",
  } as any;
}

const enabledConfig = {
  id: "samlcfg_1",
  entryPoint: "https://okta.example.com/sso",
  cert: "CERT",
  issuer: "issuer",
  provider: { name: "okta", enabled: true },
};

describe("GET /api/auth/saml — Bug 2: lookup by providerId; RelayState wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthorizeUrlAsync.mockResolvedValue(
      "https://okta.example.com/sso?SAMLRequest=abc&RelayState=xyz"
    );
  });

  it("looks up SamlConfiguration by providerId (the SsoProvider id), not its own id", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(enabledConfig);

    await GET(makeReq("ssoprovider_123"));

    expect(db.samlConfiguration.findUnique).toHaveBeenCalledWith({
      where: { providerId: "ssoprovider_123" },
      include: { provider: true },
    });
  });

  it("returns 404 when no config exists for the provider", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(null);
    const res = await GET(makeReq("missing"));
    expect(res.status).toBe(404);
  });

  it("passes a non-empty RelayState to the AuthnRequest and redirects to the IdP", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(enabledConfig);

    const res = await GET(makeReq("ssoprovider_123"));

    const [relayState, host] = getAuthorizeUrlAsync.mock.calls[0];
    expect(typeof relayState).toBe("string");
    expect(relayState.length).toBeGreaterThan(0);
    // Host is derived from NEXTAUTH_URL, never the pod.
    expect(host).toBe("app.example.com");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://okta.example.com/sso?SAMLRequest=abc&RelayState=xyz"
    );
  });
});
