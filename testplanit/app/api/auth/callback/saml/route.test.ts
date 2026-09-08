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
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
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
    (db.user.findFirst as any).mockResolvedValue(null);
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

    // Bug 5: status MUST be 303 (See Other), not the NextResponse.redirect()
    // default of 307. The IdP POSTs the assertion here; 307 preserves the
    // method, so the browser would re-POST to /complete (which only exports
    // GET) and get 405. 303 forces the follow-up to be a GET.
    expect(res.status).toBe(303);
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

  it("Bug 6: stamps emailVerified on existing users so they bypass the verify-email gate", async () => {
    // A pre-existing user whose emailVerified is null was getting trapped in
    // the verify-email flow even after a successful SAML assertion. The IdP
    // already proved control of the email, so the gate is redundant.
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
      email: "dave@example.com",
      nameID: "dave",
    });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_unverified",
      email: "dave@example.com",
      name: "Dave",
      authMethod: "SSO",
      externalId: "dave",
      emailVerified: null,
    });
    (db.user.update as any).mockResolvedValue({});
    (db.account.upsert as any).mockResolvedValue({});

    await POST(makeReq(relayFor("ssoprovider_x")));

    expect(db.user.update).toHaveBeenCalled();
    const updateArgs = (db.user.update as any).mock.calls[0][0];
    expect(updateArgs.data.emailVerified).toBeInstanceOf(Date);
  });

  it("Bug 6: leaves emailVerified alone for already-verified users", async () => {
    const verifiedAt = new Date("2024-01-01");
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
      email: "eve@example.com",
      nameID: "eve",
    });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_verified",
      email: "eve@example.com",
      name: "Eve",
      authMethod: "SSO",
      externalId: "eve",
      emailVerified: verifiedAt,
    });
    (db.account.upsert as any).mockResolvedValue({});

    await POST(makeReq(relayFor("ssoprovider_y")));

    // No update call (or, if there is one for other reasons, emailVerified
    // must not be in it).
    const updateCalls = (db.user.update as any).mock.calls;
    for (const [args] of updateCalls) {
      expect(args.data.emailVerified).toBeUndefined();
    }
  });
});

describe("POST /api/auth/callback/saml — email resolution & guard ordering", () => {
  const cfg = (attributeMapping: any, autoProvisionUsers = false) => ({
    id: "cfg",
    entryPoint: "e",
    cert: "c",
    issuer: "i",
    attributeMapping,
    autoProvisionUsers,
    defaultAccess: "USER",
    provider: { name: "okta", enabled: true },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (db.samlConfiguration.findMany as any).mockResolvedValue([]);
    (db.user.findFirst as any).mockResolvedValue(null);
  });

  it("matches an existing user case-insensitively when the IdP asserts a different casing", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(cfg({}, true));
    // IdP asserts TestAccount@example.com; the stored user is all-lowercase.
    validateSAMLResponse.mockResolvedValue({
      nameID: "TestAccount@example.com",
    });
    (db.user.findUnique as any).mockResolvedValue(null); // exact match misses
    (db.user.findFirst as any).mockResolvedValue({
      id: "user_t",
      email: "testaccount@example.com",
      name: "Test Account",
      authMethod: "SSO",
      externalId: "TestAccount@example.com",
      emailVerified: new Date(),
    });
    (db.account.upsert as any).mockResolvedValue({});

    const res = await POST(makeReq(relayFor("ssoprovider_t")));

    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "TestAccount@example.com", mode: "insensitive" },
      },
    });
    // Matched the existing account: no re-provisioning, session handoff issued.
    expect(db.user.create).not.toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(
      "/api/auth/saml/complete?token="
    );
  });

  it("resolves the email from the NameID when there is no email attribute (empty mapping)", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(cfg({}));
    // IdP sends the email in the NameID, no email attribute statement.
    validateSAMLResponse.mockResolvedValue({ nameID: "dave@example.com" });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_d",
      email: "dave@example.com",
      name: "Dave",
      authMethod: "SSO",
      externalId: "dave@example.com",
    });
    (db.user.update as any).mockResolvedValue({});
    (db.account.upsert as any).mockResolvedValue({});

    const res = await POST(makeReq(relayFor("ssoprovider_d")));

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "dave@example.com" },
    });
    // No 500/TypeError: it proceeds to the session-minting handoff.
    expect(res.status).not.toBe(500);
    expect(res.headers.get("location")).toContain(
      "/api/auth/saml/complete?token="
    );
  });

  it("returns a clean 400 (not a 500) when no email is present anywhere", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(cfg({}));
    // No email attribute and a non-email NameID.
    validateSAMLResponse.mockResolvedValue({ nameID: "not-an-email" });

    const res = await POST(makeReq(relayFor("ssoprovider_x")));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email not found/i);
    // The guard runs before any use of email (no lookup, no name .split crash).
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("prefers an explicit email attribute over the NameID", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(cfg({}));
    validateSAMLResponse.mockResolvedValue({
      email: "erin@example.com",
      nameID: "other@example.com",
    });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_e",
      email: "erin@example.com",
      name: "Erin",
      authMethod: "SSO",
      externalId: "other@example.com",
    });
    (db.user.update as any).mockResolvedValue({});
    (db.account.upsert as any).mockResolvedValue({});

    await POST(makeReq(relayFor("ssoprovider_e")));

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "erin@example.com" },
    });
  });

  it("honors a custom attributeMapping.email key", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(
      cfg({ email: "mail" })
    );
    validateSAMLResponse.mockResolvedValue({
      mail: "frank@example.com",
      nameID: "frank",
    });
    (db.user.findUnique as any).mockResolvedValue({
      id: "user_f",
      email: "frank@example.com",
      name: "Frank",
      authMethod: "SSO",
      externalId: "frank",
    });
    (db.user.update as any).mockResolvedValue({});
    (db.account.upsert as any).mockResolvedValue({});

    await POST(makeReq(relayFor("ssoprovider_f")));

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "frank@example.com" },
    });
  });

  it("derives the name from the email local-part when no name attributes are present", async () => {
    (db.samlConfiguration.findUnique as any).mockResolvedValue(cfg({}, true));
    validateSAMLResponse.mockResolvedValue({ nameID: "gina@example.com" });
    (db.user.findUnique as any).mockResolvedValue(null); // new user → provision
    (db.roles.findFirst as any).mockResolvedValue({ id: "role_1" });
    (db.user.create as any).mockResolvedValue({
      id: "user_g",
      email: "gina@example.com",
    });
    (db.account.upsert as any).mockResolvedValue({});

    const res = await POST(makeReq(relayFor("ssoprovider_g")));

    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "gina@example.com",
          name: "gina",
        }),
      })
    );
    expect(res.status).not.toBe(500);
  });
});
