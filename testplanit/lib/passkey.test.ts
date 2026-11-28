// @vitest-environment node
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret-key-at-least-32-chars-long";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
  delete process.env.APP_URL;
});

const {
  mockCheckRateLimit,
  mockAuditAuthEvent,
  mockIsForceSsoEnabled,
  mockVerifyAuthentication,
  mockVerifyRegistration,
  mockGenerateRegistrationOptions,
  mockGenerateAuthenticationOptions,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockAuditAuthEvent: vi.fn(),
  mockIsForceSsoEnabled: vi.fn(),
  mockVerifyAuthentication: vi.fn(),
  mockVerifyRegistration: vi.fn(),
  mockGenerateRegistrationOptions: vi.fn(),
  mockGenerateAuthenticationOptions: vi.fn(),
}));

// No Valkey: one-time keys are tracked in this process.
vi.mock("~/lib/valkey", () => ({ default: null }));

vi.mock("~/lib/auth-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth-security")>()),
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: mockAuditAuthEvent,
}));

vi.mock("~/lib/utils/force-sso", () => ({
  isForceSsoEnabled: mockIsForceSsoEnabled,
}));

vi.mock("~/lib/two-factor", () => ({ APP_NAME: "TestPlanIt" }));

vi.mock("@simplewebauthn/server", () => ({
  verifyAuthenticationResponse: mockVerifyAuthentication,
  verifyRegistrationResponse: mockVerifyRegistration,
  generateRegistrationOptions: mockGenerateRegistrationOptions,
  generateAuthenticationOptions: mockGenerateAuthenticationOptions,
}));

import {
  authorizePasskey,
  buildPasskeyAuthenticationOptions,
  buildPasskeyRegistrationOptions,
  canUsePasskeys,
  completePasskeyRegistration,
  consumePasskeyChallengeToken,
  createPasskeyChallengeToken,
  getPasskeyAccountLabel,
  getPasskeyAvailability,
  getPasskeyRelyingParty,
  getPasskeyUserHandle,
  isPasskeyOrigin,
  PASSKEY_ERRORS,
  PASSKEY_MAX_PER_USER,
  type PasskeyDb,
} from "./passkey";

const USER_ID = "user-1";
const CREDENTIAL_ID = "Y3JlZGVudGlhbC0x";
const PUBLIC_KEY = Buffer.from("public-key-bytes").toString("base64url");

const activeUser = {
  id: USER_ID,
  email: "user@example.com",
  name: "User One",
  isActive: true,
  isDeleted: false,
  authMethod: "INTERNAL",
  emailVerified: new Date("2026-01-01T00:00:00Z"),
};

// Whatever account id the device was given when the passkey was created. Not
// derived here on purpose: sign-in compares against the stored value.
const STORED_HANDLE = "c3RvcmVkLWhhbmRsZS0x";

const storedPasskey = {
  id: "passkey-1",
  userId: USER_ID,
  credentialId: CREDENTIAL_ID,
  userHandle: STORED_HANDLE,
  publicKey: PUBLIC_KEY,
  counter: BigInt(4),
  transports: ["internal"],
};

const fakeDb = {
  passkey: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn(), update: vi.fn() },
  registrationSettings: { findFirst: vi.fn() },
};
const db = fakeDb as unknown as PasskeyDb;

function assertionFor(
  userHandle = STORED_HANDLE,
  credentialId = CREDENTIAL_ID
) {
  return JSON.stringify({
    id: credentialId,
    rawId: credentialId,
    type: "public-key",
    response: {
      clientDataJSON: "Y2xpZW50",
      authenticatorData: "YXV0aA",
      signature: "c2ln",
      userHandle,
    },
    clientExtensionResults: {},
  });
}

function signInCredentials(overrides: Record<string, string> = {}) {
  return {
    response: assertionFor(),
    challengeToken: createPasskeyChallengeToken("authenticate", "challenge-1"),
    ...overrides,
  };
}

async function expectRefusal(
  promise: Promise<unknown>,
  error: string,
  reason?: string
) {
  await expect(promise).rejects.toThrow(error);
  if (reason) {
    const failures = mockAuditAuthEvent.mock.calls
      .filter(([action]) => action === "LOGIN_FAILED")
      .map(([, , , metadata]) => metadata);
    expect(failures).toContainEqual({ provider: "passkey", reason });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://app.example.com";
  mockCheckRateLimit.mockResolvedValue(true);
  mockAuditAuthEvent.mockResolvedValue(undefined);
  mockIsForceSsoEnabled.mockResolvedValue(false);
  fakeDb.registrationSettings.findFirst.mockResolvedValue({
    allowPasskeys: true,
  });
  fakeDb.passkey.findUnique.mockResolvedValue(storedPasskey);
  fakeDb.passkey.update.mockResolvedValue({});
  fakeDb.user.findUnique.mockResolvedValue(activeUser);
  mockVerifyAuthentication.mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 5, credentialBackedUp: true },
  });
});

describe("getPasskeyRelyingParty", () => {
  it("uses the host of an HTTPS install", () => {
    expect(
      getPasskeyRelyingParty({ NEXTAUTH_URL: "https://tests.example.com" })
    ).toEqual({
      rpID: "tests.example.com",
      origin: "https://tests.example.com",
      eligible: true,
    });
  });

  it("allows localhost over plain HTTP", () => {
    expect(
      getPasskeyRelyingParty({ NEXTAUTH_URL: "http://localhost:3000" })
    ).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3000",
      eligible: true,
    });
  });

  it("leaves the path prefix out of the origin on a subpath install", () => {
    expect(
      getPasskeyRelyingParty({
        NEXTAUTH_URL: "https://example.com/testplanit/api/auth",
      })
    ).toEqual({
      rpID: "example.com",
      origin: "https://example.com",
      eligible: true,
    });
  });

  it.each([
    ["a plain-HTTP hostname", "http://testplanit.internal"],
    ["an IPv4 address over HTTP", "http://192.168.1.5:3000"],
    ["an IPv4 address over HTTPS", "https://10.0.0.1"],
    ["an IPv6 address over HTTPS", "https://[::1]:3000"],
  ])("is not eligible for %s", (_label, url) => {
    expect(getPasskeyRelyingParty({ NEXTAUTH_URL: url }).eligible).toBe(false);
  });
});

describe("getPasskeyAvailability", () => {
  it("is available by default, including with no settings row", async () => {
    fakeDb.registrationSettings.findFirst.mockResolvedValue(null);
    expect(await getPasskeyAvailability(db)).toEqual({ available: true });
  });

  it("is off when an administrator switched passkeys off", async () => {
    fakeDb.registrationSettings.findFirst.mockResolvedValue({
      allowPasskeys: false,
    });
    expect(await getPasskeyAvailability(db)).toEqual({
      available: false,
      reason: "disabled",
    });
  });

  it("is off while Force SSO is on", async () => {
    mockIsForceSsoEnabled.mockResolvedValue(true);
    expect(await getPasskeyAvailability(db)).toEqual({
      available: false,
      reason: "force_sso",
    });
  });

  it("is off when the install's address cannot host passkeys", async () => {
    process.env.NEXTAUTH_URL = "http://192.168.1.5:3000";
    expect(await getPasskeyAvailability(db)).toEqual({
      available: false,
      reason: "ineligible_host",
    });
  });
});

describe("isPasskeyOrigin", () => {
  it("accepts a request from the configured address", () => {
    expect(isPasskeyOrigin("https://app.example.com")).toBe(true);
  });

  it.each([
    ["another port", "https://app.example.com:8443"],
    ["another scheme", "http://app.example.com"],
    ["another host", "https://other.example.com"],
  ])("refuses a request from %s and says why in the log", (_label, origin) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isPasskeyOrigin(origin)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.any(String), {
      expectedOrigin: "https://app.example.com",
      requestOrigin: origin,
    });
    warn.mockRestore();
  });

  it("does not judge a request that carries no origin", () => {
    expect(isPasskeyOrigin(null)).toBe(true);
    expect(isPasskeyOrigin(undefined)).toBe(true);
  });
});

describe("getPasskeyUserHandle", () => {
  it("is stable for one user on one install", () => {
    expect(getPasskeyUserHandle("user-1", "/testplanit")).toBe(
      getPasskeyUserHandle("user-1", "/testplanit")
    );
  });

  it("differs between two installs on one host, even for the same user id", () => {
    const production = getPasskeyUserHandle("user-1", "/testplanit");
    const staging = getPasskeyUserHandle("user-1", "/testplanit-staging");
    const root = getPasskeyUserHandle("user-1", "");

    expect(new Set([production, staging, root]).size).toBe(3);
  });

  it("differs between users on one install", () => {
    expect(getPasskeyUserHandle("user-1", "/testplanit")).not.toBe(
      getPasskeyUserHandle("user-2", "/testplanit")
    );
  });

  it("fits the 64 bytes a user handle may hold and says nothing about the user", () => {
    const handle = getPasskeyUserHandle("user-1", "/a/very/long/path/prefix");

    expect(handle).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(handle, "base64url")).toHaveLength(32);
    expect(Buffer.from(handle, "base64url").toString("utf8")).not.toContain(
      "user-1"
    );
  });
});

describe("getPasskeyAccountLabel", () => {
  it("is the email on an install at the root", () => {
    expect(getPasskeyAccountLabel("pat@example.com", "")).toBe(
      "pat@example.com"
    );
  });

  it("names the path prefix on a subfolder install", () => {
    expect(getPasskeyAccountLabel("pat@example.com", "/testplanit")).toBe(
      "pat@example.com (/testplanit)"
    );
  });
});

describe("canUsePasskeys", () => {
  it("allows accounts with a password of their own", () => {
    expect(canUsePasskeys("INTERNAL")).toBe(true);
    expect(canUsePasskeys("BOTH")).toBe(true);
  });

  it("refuses accounts managed by an identity provider", () => {
    expect(canUsePasskeys("SSO")).toBe(false);
    expect(canUsePasskeys("SCIM")).toBe(false);
    expect(canUsePasskeys(null)).toBe(false);
  });
});

describe("challenge tokens", () => {
  it("returns the challenge once and refuses a second use", async () => {
    const token = createPasskeyChallengeToken("authenticate", "challenge-a");
    expect(await consumePasskeyChallengeToken(token, "authenticate")).toBe(
      "challenge-a"
    );
    expect(
      await consumePasskeyChallengeToken(token, "authenticate")
    ).toBeNull();
  });

  it("refuses a token issued for the other ceremony", async () => {
    const token = createPasskeyChallengeToken("authenticate", "challenge-b");
    expect(
      await consumePasskeyChallengeToken(token, "register", USER_ID)
    ).toBeNull();
  });

  it("binds a registration token to the user it was issued to", async () => {
    const token = createPasskeyChallengeToken(
      "register",
      "challenge-c",
      USER_ID
    );
    expect(
      await consumePasskeyChallengeToken(token, "register", "someone-else")
    ).toBeNull();
    expect(await consumePasskeyChallengeToken(token, "register")).toBeNull();
    expect(await consumePasskeyChallengeToken(token, "register", USER_ID)).toBe(
      "challenge-c"
    );
  });

  it("refuses a token signed with the app secret itself", async () => {
    // The shape of the other short-lived tokens the app signs.
    const foreign = jwt.sign({ challenge: "challenge-d" }, SECRET, {
      audience: "passkey:authenticate",
      expiresIn: 300,
      jwtid: "foreign-jti",
    });
    expect(
      await consumePasskeyChallengeToken(foreign, "authenticate")
    ).toBeNull();
  });

  it("refuses a missing or malformed token", async () => {
    expect(await consumePasskeyChallengeToken(null, "authenticate")).toBeNull();
    expect(
      await consumePasskeyChallengeToken("not-a-token", "authenticate")
    ).toBeNull();
  });
});

describe("authorizePasskey", () => {
  const authorize = authorizePasskey(db);

  it("signs the user in and records the use", async () => {
    await expect(authorize(signInCredentials())).resolves.toEqual({
      id: USER_ID,
      email: "user@example.com",
      name: "User One",
    });

    expect(mockVerifyAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: "challenge-1",
        expectedOrigin: "https://app.example.com",
        expectedRPID: "app.example.com",
        requireUserVerification: true,
        credential: expect.objectContaining({
          id: CREDENTIAL_ID,
          counter: 4,
          transports: ["internal"],
        }),
      })
    );
    expect(fakeDb.passkey.update).toHaveBeenCalledWith({
      where: { id: "passkey-1" },
      data: {
        counter: BigInt(5),
        lastUsedAt: expect.any(Date),
        backedUp: true,
      },
    });
    expect(mockAuditAuthEvent).toHaveBeenCalledWith(
      "LOGIN",
      USER_ID,
      "user@example.com",
      { provider: "passkey" },
      "User One"
    );
  });

  it("never reads or advances the password lockout", async () => {
    await authorize(signInCredentials());
    const userSelect = fakeDb.user.findUnique.mock.calls[0][0].select;
    expect(userSelect).not.toHaveProperty("lockedUntil");
    expect(userSelect).not.toHaveProperty("failedLoginAttempts");
    expect(fakeDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses when the caller is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.rate_limited
    );
    expect(fakeDb.passkey.findUnique).not.toHaveBeenCalled();
  });

  it("refuses while passkeys are switched off", async () => {
    fakeDb.registrationSettings.findFirst.mockResolvedValue({
      allowPasskeys: false,
    });
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.unavailable,
      "passkey_disabled"
    );
  });

  it("refuses while Force SSO is on", async () => {
    mockIsForceSsoEnabled.mockResolvedValue(true);
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.unavailable,
      "passkey_force_sso"
    );
  });

  it("refuses a malformed answer", async () => {
    await expectRefusal(
      authorize(signInCredentials({ response: "{}" })),
      PASSKEY_ERRORS.failed,
      "passkey_malformed"
    );
  });

  it("refuses an answer with no user handle", async () => {
    const withoutHandle = JSON.parse(assertionFor());
    delete withoutHandle.response.userHandle;
    await expectRefusal(
      authorize(signInCredentials({ response: JSON.stringify(withoutHandle) })),
      PASSKEY_ERRORS.failed,
      "passkey_malformed"
    );
  });

  it("refuses a challenge that was already used", async () => {
    const credentials = signInCredentials();
    await authorize(credentials);
    await expectRefusal(
      authorize(credentials),
      PASSKEY_ERRORS.failed,
      "passkey_challenge_invalid"
    );
  });

  it("refuses a credential it does not know", async () => {
    fakeDb.passkey.findUnique.mockResolvedValue(null);
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.failed,
      "passkey_unknown_credential"
    );
  });

  it("refuses when the device hands back another account id than the one stored", async () => {
    await expectRefusal(
      authorize(
        signInCredentials({ response: assertionFor("YW5vdGhlci1oYW5kbGU") })
      ),
      PASSKEY_ERRORS.failed,
      "passkey_user_handle_mismatch"
    );
    expect(mockVerifyAuthentication).not.toHaveBeenCalled();
  });

  it("accepts a passkey whose stored account id predates the current scheme", async () => {
    // Stored as the user's id itself, as the first passkeys were.
    const legacyHandle = Buffer.from(USER_ID, "utf8").toString("base64url");
    expect(legacyHandle).not.toBe(getPasskeyUserHandle(USER_ID));
    fakeDb.passkey.findUnique.mockResolvedValue({
      ...storedPasskey,
      userHandle: legacyHandle,
    });

    await expect(
      authorize(signInCredentials({ response: assertionFor(legacyHandle) }))
    ).resolves.toMatchObject({ id: USER_ID });
  });

  it("refuses a signature that does not verify, before looking at the account", async () => {
    mockVerifyAuthentication.mockRejectedValue(new Error("bad signature"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.failed,
      "passkey_verification_failed"
    );
    expect(fakeDb.user.findUnique).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("sign-in"),
      expect.objectContaining({ expectedOrigin: "https://app.example.com" })
    );
    warn.mockRestore();
  });

  it("refuses when the library reports the answer unverified", async () => {
    mockVerifyAuthentication.mockResolvedValue({ verified: false });
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.failed,
      "passkey_verification_failed"
    );
  });

  it.each([
    ["an inactive account", { isActive: false }, "user_inactive"],
    ["a deleted account", { isDeleted: true }, "user_inactive"],
    ["an SSO-only account", { authMethod: "SSO" }, "passkey_auth_method"],
    ["a SCIM-managed account", { authMethod: "SCIM" }, "passkey_auth_method"],
    ["an unverified email", { emailVerified: null }, "email_not_verified"],
  ])("refuses %s", async (_label, overrides, reason) => {
    fakeDb.user.findUnique.mockResolvedValue({ ...activeUser, ...overrides });
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.failed,
      reason
    );
    expect(fakeDb.passkey.update).not.toHaveBeenCalled();
  });

  it("refuses when the account no longer exists", async () => {
    fakeDb.user.findUnique.mockResolvedValue(null);
    await expectRefusal(
      authorize(signInCredentials()),
      PASSKEY_ERRORS.failed,
      "user_not_found"
    );
  });
});

describe("buildPasskeyAuthenticationOptions", () => {
  it("asks for user verification and names no credentials", async () => {
    mockGenerateAuthenticationOptions.mockResolvedValue({
      challenge: "challenge-e",
    });
    const result = await buildPasskeyAuthenticationOptions();

    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: "app.example.com",
      userVerification: "required",
    });
    expect(
      await consumePasskeyChallengeToken(result.challengeToken, "authenticate")
    ).toBe("challenge-e");
  });
});

describe("buildPasskeyRegistrationOptions", () => {
  const user = { id: USER_ID, email: "user@example.com", name: "User One" };

  it("requires a discoverable, user-verified key and excludes existing ones", async () => {
    fakeDb.passkey.findMany.mockResolvedValue([
      { credentialId: CREDENTIAL_ID, transports: ["internal"] },
    ]);
    mockGenerateRegistrationOptions.mockResolvedValue({
      challenge: "challenge-f",
    });

    const result = await buildPasskeyRegistrationOptions(db, user);
    expect(result.ok).toBe(true);

    const options = mockGenerateRegistrationOptions.mock.calls[0][0];
    expect(options).toMatchObject({
      rpName: "TestPlanIt",
      rpID: "app.example.com",
      userName: "user@example.com",
      attestationType: "none",
      excludeCredentials: [{ id: CREDENTIAL_ID, transports: ["internal"] }],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      supportedAlgorithmIDs: [-8, -7, -257],
    });
    expect(Buffer.from(options.userID).toString("base64url")).toBe(
      getPasskeyUserHandle(USER_ID)
    );

    if (result.ok) {
      expect(
        await consumePasskeyChallengeToken(
          result.challengeToken,
          "register",
          USER_ID
        )
      ).toBe("challenge-f");
    }
  });

  it("refuses once the account holds the maximum", async () => {
    fakeDb.passkey.findMany.mockResolvedValue(
      Array.from({ length: PASSKEY_MAX_PER_USER }, (_, index) => ({
        credentialId: `credential-${index}`,
        transports: [],
      }))
    );
    expect(await buildPasskeyRegistrationOptions(db, user)).toEqual({
      ok: false,
      reason: "limit_reached",
    });
    expect(mockGenerateRegistrationOptions).not.toHaveBeenCalled();
  });
});

describe("completePasskeyRegistration", () => {
  const registrationResponse = {
    id: "bmV3LWNyZWRlbnRpYWw",
    rawId: "bmV3LWNyZWRlbnRpYWw",
    type: "public-key",
    response: {
      clientDataJSON: "Y2xpZW50",
      attestationObject: "YXR0ZXN0",
      transports: ["internal", "hybrid", "not-a-transport"],
    },
    clientExtensionResults: {},
  };

  function register(overrides: Record<string, unknown> = {}) {
    return completePasskeyRegistration(db, {
      userId: USER_ID,
      response: registrationResponse,
      challengeToken: createPasskeyChallengeToken(
        "register",
        "challenge-g",
        USER_ID
      ),
      name: "MacBook",
      ...overrides,
    });
  }

  beforeEach(() => {
    fakeDb.passkey.findUnique.mockResolvedValue(null);
    fakeDb.passkey.count.mockResolvedValue(0);
    fakeDb.passkey.create.mockResolvedValue({
      id: "passkey-2",
      name: "MacBook",
      createdAt: new Date("2026-11-27T00:00:00Z"),
      lastUsedAt: null,
    });
    mockVerifyRegistration.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "bmV3LWNyZWRlbnRpYWw",
          publicKey: new Uint8Array(Buffer.from("public-key-bytes")),
          counter: 0,
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        aaguid: "00000000-0000-0000-0000-000000000000",
      },
    });
  });

  it("stores the verified key", async () => {
    const result = await register();

    expect(result).toEqual({
      ok: true,
      passkey: expect.objectContaining({ id: "passkey-2", name: "MacBook" }),
    });
    expect(mockVerifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: "challenge-g",
        expectedOrigin: "https://app.example.com",
        expectedRPID: "app.example.com",
        requireUserVerification: true,
        supportedAlgorithmIDs: [-8, -7, -257],
      })
    );
    expect(fakeDb.passkey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: USER_ID,
          credentialId: "bmV3LWNyZWRlbnRpYWw",
          userHandle: getPasskeyUserHandle(USER_ID),
          publicKey: PUBLIC_KEY,
          counter: BigInt(0),
          transports: ["internal", "hybrid"],
          deviceType: "multiDevice",
          backedUp: true,
          aaguid: "00000000-0000-0000-0000-000000000000",
          name: "MacBook",
        },
      })
    );
  });

  it("refuses a challenge issued to another user", async () => {
    const result = await register({
      challengeToken: createPasskeyChallengeToken(
        "register",
        "challenge-h",
        "someone-else"
      ),
    });
    expect(result).toEqual({ ok: false, reason: "challenge_invalid" });
    expect(mockVerifyRegistration).not.toHaveBeenCalled();
  });

  it("refuses a malformed answer without spending the challenge", async () => {
    const challengeToken = createPasskeyChallengeToken(
      "register",
      "challenge-i",
      USER_ID
    );
    expect(await register({ response: { id: "x" }, challengeToken })).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(
      await consumePasskeyChallengeToken(challengeToken, "register", USER_ID)
    ).toBe("challenge-i");
  });

  it("refuses an answer that does not verify", async () => {
    mockVerifyRegistration.mockRejectedValue(new Error("origin mismatch"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await register()).toEqual({
      ok: false,
      reason: "verification_failed",
    });
    expect(fakeDb.passkey.create).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("refuses a key that is already registered", async () => {
    fakeDb.passkey.findUnique.mockResolvedValue({ id: "passkey-1" });
    expect(await register()).toEqual({ ok: false, reason: "duplicate" });
    expect(fakeDb.passkey.create).not.toHaveBeenCalled();
  });

  it("re-checks the limit before storing", async () => {
    fakeDb.passkey.count.mockResolvedValue(PASSKEY_MAX_PER_USER);
    expect(await register()).toEqual({ ok: false, reason: "limit_reached" });
    expect(fakeDb.passkey.create).not.toHaveBeenCalled();
  });
});
