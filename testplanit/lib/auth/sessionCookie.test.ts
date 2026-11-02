// @vitest-environment node
import { decode, encode } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reissueSessionCookie, sessionCookieName } from "./sessionCookie";

const SECRET = "test-secret-key-at-least-32-chars-long";
const ORIGINAL_ENV = { ...process.env };

async function makeRequest(claims: Record<string, unknown> | null) {
  const headers: Record<string, string> = {};
  if (claims) {
    const raw = await encode({ token: claims, secret: SECRET });
    headers.cookie = `${sessionCookieName()}=${raw}`;
  }
  return new NextRequest("http://localhost/api/users/u1/change-password", {
    method: "POST",
    headers,
  });
}

function setCookieFor(response: NextResponse, name: string) {
  return response.cookies.get(name);
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = SECRET;
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  delete process.env.VERCEL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("reissueSessionCookie", () => {
  it("re-encodes the caller's JWT with the patch applied and keeps the other claims", async () => {
    const request = await makeRequest({
      sub: "u1",
      access: "USER",
      isApi: false,
      passwordChangedAt: null,
      mustChangePassword: true,
    });
    const response = NextResponse.json({ ok: true });

    const changedAt = "2026-11-02T10:00:00.000Z";
    const reissued = await reissueSessionCookie(request, response, {
      passwordChangedAt: changedAt,
      mustChangePassword: false,
    });

    expect(reissued).toBe(true);
    const cookie = setCookieFor(response, "next-auth.session-token");
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.secure).toBeFalsy();

    const claims = await decode({ token: cookie!.value, secret: SECRET });
    expect(claims?.sub).toBe("u1");
    expect(claims?.access).toBe("USER");
    expect(claims?.passwordChangedAt).toBe(changedAt);
    expect(claims?.mustChangePassword).toBe(false);
  });

  it("uses the __Secure- cookie name and secure flag when NEXTAUTH_URL is https", async () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    expect(sessionCookieName()).toBe("__Secure-next-auth.session-token");

    const request = await makeRequest({ sub: "u1", passwordChangedAt: null });
    const response = NextResponse.json({ ok: true });

    expect(
      await reissueSessionCookie(request, response, {
        passwordChangedAt: "2026-11-02T10:00:00.000Z",
      })
    ).toBe(true);

    expect(setCookieFor(response, "next-auth.session-token")).toBeUndefined();
    const cookie = setCookieFor(response, "__Secure-next-auth.session-token");
    expect(cookie?.secure).toBe(true);
  });

  it("returns false and sets nothing when the request carries no session cookie", async () => {
    const request = await makeRequest(null);
    const response = NextResponse.json({ ok: true });

    expect(
      await reissueSessionCookie(request, response, {
        passwordChangedAt: "2026-11-02T10:00:00.000Z",
      })
    ).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns false when NEXTAUTH_SECRET is unset", async () => {
    const request = await makeRequest({ sub: "u1" });
    delete process.env.NEXTAUTH_SECRET;
    const response = NextResponse.json({ ok: true });

    expect(
      await reissueSessionCookie(request, response, {
        passwordChangedAt: "2026-11-02T10:00:00.000Z",
      })
    ).toBe(false);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
