// @vitest-environment node
import jwt from "jsonwebtoken";
import { decode } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

const SECRET = "test-secret-key-at-least-32-chars-long";

// Capture every cookie the route sets so we can decode the session token.
const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    get: (name: string) => cookieJar.get(name),
    delete: (name: string) => cookieJar.delete(name),
  })),
}));

vi.mock("~/server/db", () => ({
  db: { user: { findUnique: vi.fn() } },
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
};

function makeReq(token: string, callbackUrl = "/dashboard") {
  return {
    nextUrl: { searchParams: new URLSearchParams({ token, callbackUrl }) },
    headers: new Headers(),
    url: "https://cint-prod-pod-xyz:3000/api/auth/saml/complete",
  } as any;
}

function tempToken() {
  return jwt.sign(
    { userId: user.id, provider: "saml-okta", email: user.email },
    SECRET,
    { expiresIn: "5m" }
  );
}

describe("GET /api/auth/saml/complete — post-Okta session handoff", () => {
  beforeEach(() => {
    cookieJar.clear();
    vi.clearAllMocks();
    (db.user.findUnique as any).mockResolvedValue(user);
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
    const sessionCookie = cookieJar.get("next-auth.session-token");
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

    await GET(makeReq(tempToken()));

    expect(
      cookieJar.get("__Secure-next-auth.session-token")?.value
    ).toBeTruthy();
  });

  it("rejects an invalid/expired token with 401", async () => {
    const res = await GET(makeReq("not-a-valid-jwt"));
    expect(res.status).toBe(401);
  });
});
