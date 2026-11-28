// @vitest-environment node
import jwt from "jsonwebtoken";
import { decode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSignInToken } from "~/lib/auth/signInTokens";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

const SECRET = "test-secret-key-at-least-32-chars-long";

vi.mock("~/server/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    registrationSettings: { findFirst: vi.fn() },
  },
}));

import { db } from "~/server/db";
import { GET } from "./route";

const user = {
  id: "user_42",
  email: "alice@example.com",
  name: "Alice",
  access: "USER",
  isApi: false,
  passwordChangedAt: null,
  mustChangePassword: false,
  twoFactorEnabled: false,
};

function makeReq(token: string, callbackUrl = "/dashboard") {
  return {
    nextUrl: { searchParams: new URLSearchParams({ token, callbackUrl }) },
    headers: new Headers(),
    url: "https://cint-prod-pod-xyz:3000/api/auth/saml/complete",
  } as any;
}

function tempToken() {
  return signSignInToken(
    "saml-complete",
    { userId: user.id, provider: "saml-okta", email: user.email },
    { expiresIn: "5m" }
  );
}

describe("GET /api/auth/saml/complete — post-Okta session handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.user.findUnique as any).mockResolvedValue(user);
    (db.registrationSettings.findFirst as any).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mints a session cookie that NextAuth can decode (sub = user id)", async () => {
    const res = await GET(makeReq(tempToken()));

    // Redirects to the destination on the public origin (not the pod host).
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/dashboard"
    );

    // The session cookie it set must be a valid NextAuth v4 JWT — decode it the
    // exact way NextAuth would on the next request.
    const sessionCookie = res.cookies.get("next-auth.session-token");
    expect(sessionCookie?.value).toBeTruthy();

    const decoded = await decode({
      token: sessionCookie!.value,
      secret: SECRET,
    });
    expect(decoded?.sub).toBe(user.id);
    expect(decoded?.email).toBe(user.email);
    // The token carries access on the first request so middleware (which only
    // decodes, never runs the jwt callback) sees it without a session refresh.
    expect(decoded?.access).toBe("USER");
  });

  it("sets the __Secure- cookie name in production (matches NextAuth on https)", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const res = await GET(makeReq(tempToken()));

    expect(
      res.cookies.get("__Secure-next-auth.session-token")?.value
    ).toBeTruthy();
  });

  it("stamps 2FA-required when force2FAAllLogins is on and the user has 2FA", async () => {
    (db.registrationSettings.findFirst as any).mockResolvedValue({
      force2FAAllLogins: true,
    });
    (db.user.findUnique as any).mockResolvedValue({
      ...user,
      twoFactorEnabled: true,
    });

    const res = await GET(makeReq(tempToken()));

    const decoded = await decode({
      token: res.cookies.get("next-auth.session-token")!.value,
      secret: SECRET,
    });
    expect(decoded?.twoFactorRequired).toBe(true);
    expect(decoded?.twoFactorVerified).toBe(false);
  });

  it("stamps 2FA-setup-required when force2FA is on but the user has no 2FA", async () => {
    (db.registrationSettings.findFirst as any).mockResolvedValue({
      force2FAAllLogins: true,
    });
    // user.twoFactorEnabled is false by default

    const res = await GET(makeReq(tempToken()));

    const decoded = await decode({
      token: res.cookies.get("next-auth.session-token")!.value,
      secret: SECRET,
    });
    expect(decoded?.twoFactorSetupRequired).toBe(true);
  });

  it.each([
    ["a pending two-factor token", "two-factor-pending"],
    ["a two-factor setup token", "two-factor-setup"],
  ] as const)("refuses %s from a password sign-in", async (_label, purpose) => {
    const token = signSignInToken(
      purpose,
      { userId: user.id, email: user.email },
      { expiresIn: "5m" }
    );

    const res = await GET(makeReq(token));

    expect(res.status).toBe(401);
    expect(res.cookies.get("next-auth.session-token")).toBeUndefined();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a signed token that names no purpose", async () => {
    const token = jwt.sign(
      { userId: user.id, provider: "saml-okta", email: user.email },
      SECRET,
      { expiresIn: "5m" }
    );

    const res = await GET(makeReq(token));

    expect(res.status).toBe(401);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("rejects an invalid/expired token with 401", async () => {
    const res = await GET(makeReq("not-a-valid-jwt"));
    expect(res.status).toBe(401);
  });
});
