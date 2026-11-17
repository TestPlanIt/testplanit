import { describe, expect, it } from "vitest";
import {
  authCookies,
  clientCookie,
  secureAuthCookiesEnabled,
} from "./cookieScope";

describe("authCookies", () => {
  it("leaves next-auth's defaults alone at the root", () => {
    expect(authCookies(true, "")).toBeUndefined();
    expect(authCookies(false, "")).toBeUndefined();
  });

  it("scopes every cookie to the prefix and keeps the default names", () => {
    const cookies = authCookies(false, "/testplanit")!;
    const entries = Object.entries(cookies);
    expect(entries).toHaveLength(6);
    for (const [, cookie] of entries) {
      expect(cookie!.options.path).toBe("/testplanit");
      expect(cookie!.options.sameSite).toBe("lax");
      expect(cookie!.options.secure).toBe(false);
      expect(cookie!.options.httpOnly).toBe(true);
    }
    expect(cookies.sessionToken!.name).toBe("next-auth.session-token");
    expect(cookies.csrfToken!.name).toBe("next-auth.csrf-token");
    expect(cookies.pkceCodeVerifier!.options.maxAge).toBe(900);
    expect(cookies.state!.options.maxAge).toBe(900);
  });

  it("uses __Secure- names over https, never __Host- (which requires path /)", () => {
    const cookies = authCookies(true, "/testplanit")!;
    expect(cookies.sessionToken!.name).toBe("__Secure-next-auth.session-token");
    expect(cookies.csrfToken!.name).toBe("__Secure-next-auth.csrf-token");
    expect(cookies.callbackUrl!.name).toBe("__Secure-next-auth.callback-url");
    for (const cookie of Object.values(cookies)) {
      expect(cookie!.name.startsWith("__Host-")).toBe(false);
      expect(cookie!.options.secure).toBe(true);
      expect(cookie!.options.path).toBe("/testplanit");
    }
  });
});

describe("secureAuthCookiesEnabled", () => {
  it("follows the scheme of NEXTAUTH_URL, like next-auth", () => {
    expect(secureAuthCookiesEnabled({ NEXTAUTH_URL: "https://x.test" })).toBe(
      true
    );
    expect(secureAuthCookiesEnabled({ NEXTAUTH_URL: "http://localhost" })).toBe(
      false
    );
    expect(secureAuthCookiesEnabled({})).toBe(false);
    expect(secureAuthCookiesEnabled({ VERCEL: "1" })).toBe(true);
  });
});

describe("clientCookie", () => {
  it("writes the install's cookie path and keeps extra attributes", () => {
    // COOKIE_PATH is "/" under test.
    expect(clientCookie("NEXT_LOCALE", "en-US", ["max-age=31536000"])).toBe(
      "NEXT_LOCALE=en-US;path=/;max-age=31536000"
    );
  });
});
