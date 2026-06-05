// @vitest-environment node
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

const SECRET = "test-secret-key-at-least-32-chars-long";

vi.mock("~/lib/valkey", () => ({ default: null })); // RelayState via signed token

vi.mock("~/server/db", () => ({
  db: {
    samlConfiguration: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    account: { upsert: vi.fn() },
    roles: { findFirst: vi.fn() },
  },
}));

const { validateSAMLResponse } = vi.hoisted(() => ({
  validateSAMLResponse: vi.fn(),
}));
vi.mock("~/server/saml-provider", () => ({
  createSAMLClient: vi.fn(async () => ({})),
  validateSAMLResponse,
}));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: { createUserRegistrationNotification: vi.fn() },
}));
vi.mock("~/lib/utils/email-domain-validation", () => ({
  isEmailDomainAllowed: vi.fn(async () => true),
}));

// Override only the assertion replay guard; everything else stays real.
const { registerSamlAssertion } = vi.hoisted(() => ({
  registerSamlAssertion: vi.fn(async () => true),
}));
vi.mock("~/lib/auth-security", async (importActual) => {
  const actual = await importActual<typeof import("~/lib/auth-security")>();
  return { ...actual, registerSamlAssertion };
});

import { db } from "~/server/db";
import { POST } from "./route";

function makeReq(
  relayState: string | null,
  samlResponse: string | null = "<saml/>"
) {
  const fd = new FormData();
  if (samlResponse) fd.set("SAMLResponse", samlResponse);
  if (relayState) fd.set("RelayState", relayState);
  return {
    headers: new Headers(),
    formData: async () => fd,
    url: "https://cint-prod-pod:3000/api/auth/callback/saml",
  } as any;
}

// A RelayState as the init route would mint it without Valkey (signed token).
function relayFor(providerId: string, callbackUrl = "/dash") {
  return jwt.sign({ providerId, callbackUrl }, SECRET, { expiresIn: "15m" });
}

describe("POST /api/auth/callback/saml — ACS validator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.samlConfiguration.findMany as any).mockResolvedValue([]);
  });

  it("returns 400 when there is no RelayState and no enabled config validates it", async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it("recovers the provider from RelayState and hands off to /api/auth/saml/complete (Bug 3)", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue({
      id: "cfg",
      entryPoint: "e",
      cert: "c",
      issuer: "i",
      attributeMapping: {},
      autoProvisionUsers: false,
      provider: { name: "okta", enabled: true },
    });
    validateSAMLResponse.mockResolvedValue({
      email: "bob@example.com",
      nameID: "bob",
    });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_7",
      email: "bob@example.com",
      name: "Bob",
      authMethod: "SSO",
      externalId: "bob",
    });
    (db.account.upsert as any).mockResolvedValue({});

    const res = await POST(makeReq(relayFor("ssoprovider_9")));

    // Bug 2: looked up by the providerId carried in RelayState.
    expect(db.samlConfiguration.findUnique).toHaveBeenCalledWith({
      where: { providerId: "ssoprovider_9" },
      include: { provider: true },
    });

    // Bug 3: hands off to the real session-minting route on the public origin,
    // NOT the dead /api/auth/callback/saml?token= path that hit NextAuth.
    const location = res.headers.get("location")!;
    expect(
      location.startsWith(
        "https://app.example.com/api/auth/saml/complete?token="
      )
    ).toBe(true);
    expect(location).not.toContain("/api/auth/callback/saml?token=");
  });

  it("rejects a replayed assertion with 400 (single-use)", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue({
      id: "cfg",
      entryPoint: "e",
      cert: "c",
      issuer: "i",
      attributeMapping: {},
      autoProvisionUsers: false,
      provider: { name: "okta", enabled: true },
    });
    validateSAMLResponse.mockResolvedValue({
      email: "bob@example.com",
      nameID: "bob",
    });
    registerSamlAssertion.mockResolvedValueOnce(false); // already seen

    const res = await POST(makeReq(relayFor("ssoprovider_9")));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already been used/i);
  });

  it("returns 404 when the provider in RelayState is unknown", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(null);
    const res = await POST(makeReq(relayFor("nope")));
    expect(res.status).toBe(404);
  });

  it("supports IdP-initiated login (no RelayState) via the config that validates", async () => {
    (db.samlConfiguration.findMany as any).mockResolvedValue([
      {
        id: "cfg",
        entryPoint: "e",
        cert: "c",
        issuer: "i",
        attributeMapping: {},
        autoProvisionUsers: false,
        provider: { name: "okta", enabled: true },
      },
    ]);
    validateSAMLResponse.mockResolvedValue({
      email: "carol@example.com",
      nameID: "carol",
    });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_8",
      email: "carol@example.com",
      name: "Carol",
      authMethod: "SSO",
      externalId: "carol",
    });
    (db.account.upsert as any).mockResolvedValue({});

    const res = await POST(makeReq(null)); // no RelayState = IdP-initiated

    // Picked the config by validating the assertion (findMany over enabled
    // providers), not by a RelayState-carried id.
    expect(db.samlConfiguration.findMany).toHaveBeenCalled();
    expect(db.samlConfiguration.findUnique).not.toHaveBeenCalled();

    const location = res.headers.get("location")!;
    expect(
      location.startsWith(
        "https://app.example.com/api/auth/saml/complete?token="
      )
    ).toBe(true);
    // Post-login destination defaults to /.
    expect(location).toContain("callbackUrl=%2F");
  });
});
