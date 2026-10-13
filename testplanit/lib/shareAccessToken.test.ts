import { afterEach, describe, expect, it } from "vitest";
import {
  createShareAccessToken,
  SHARE_ACCESS_TOKEN_TTL_SECONDS,
  verifyShareAccessToken,
} from "./shareAccessToken";

const HASH = "$2b$10$hashvalue";
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

describe("share access tokens", () => {
  const original = process.env.NEXTAUTH_SECRET;
  afterEach(() => {
    process.env.NEXTAUTH_SECRET = original;
  });

  it("verifies a token for the share and password it was issued for", () => {
    const token = createShareAccessToken("key-1", HASH, NOW);
    expect(verifyShareAccessToken(token, "key-1", HASH, NOW)).toBe(true);
  });

  it("rejects the shareKey itself", () => {
    expect(verifyShareAccessToken("key-1", "key-1", HASH, NOW)).toBe(false);
  });

  it("rejects a token for another share", () => {
    const token = createShareAccessToken("key-2", HASH, NOW);
    expect(verifyShareAccessToken(token, "key-1", HASH, NOW)).toBe(false);
  });

  it("rejects every earlier token once the password changes", () => {
    const token = createShareAccessToken("key-1", HASH, NOW);
    expect(verifyShareAccessToken(token, "key-1", "$2b$10$newhash", NOW)).toBe(
      false
    );
  });

  it("expires after the TTL", () => {
    const token = createShareAccessToken("key-1", HASH, NOW);
    const later = NOW + SHARE_ACCESS_TOKEN_TTL_SECONDS * 1000;
    expect(verifyShareAccessToken(token, "key-1", HASH, later - 1000)).toBe(
      true
    );
    expect(verifyShareAccessToken(token, "key-1", HASH, later)).toBe(false);
  });

  it("rejects a token with a pushed-out expiry", () => {
    const token = createShareAccessToken("key-1", HASH, NOW);
    const [, signature] = token.split(".");
    const forged = `${Math.floor(NOW / 1000) + 999999}.${signature}`;
    expect(verifyShareAccessToken(forged, "key-1", HASH, NOW)).toBe(false);
  });

  it("rejects a token signed with another secret", () => {
    process.env.NEXTAUTH_SECRET = "secret-a";
    const token = createShareAccessToken("key-1", HASH, NOW);
    process.env.NEXTAUTH_SECRET = "secret-b";
    expect(verifyShareAccessToken(token, "key-1", HASH, NOW)).toBe(false);
  });

  it.each([null, undefined, "", "abc", "1.2.3", "x.sig"])(
    "rejects malformed token %j",
    (token) => {
      expect(verifyShareAccessToken(token, "key-1", HASH, NOW)).toBe(false);
    }
  );

  it("rejects when the link has no password hash", () => {
    const token = createShareAccessToken("key-1", HASH, NOW);
    expect(verifyShareAccessToken(token, "key-1", null, NOW)).toBe(false);
  });
});
