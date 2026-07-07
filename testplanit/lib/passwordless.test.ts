// @vitest-environment node
/**
 * Unit tests for the device-bound magic-link + OTP service
 * (lib/passwordless.ts), covering the security-critical acceptance criteria:
 *
 *   - secrets: entropy/alphabet, hash-only storage, constant-time matching
 *   - consumption is single-shot and atomic (concurrency: exactly one winner)
 *   - expiry enforced at every step
 *   - code brute force locks the pending row after MAX attempts
 *   - the emailed link's inspection path is read-only (scanner safety)
 *   - authorizePasswordlessComplete requires the verifier cookie and returns
 *     the same user object shape as the existing flows
 */
import { createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
});

const auditAuthEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("~/lib/services/auditLog", () => ({ auditAuthEvent }));

import {
  PASSWORDLESS_CODE_ALPHABET,
  PASSWORDLESS_MAX_CODE_ATTEMPTS,
  authorizePasswordlessComplete,
  consumePendingAuth,
  createPendingAuth,
  decodeVerifierCookie,
  encodeVerifierCookie,
  formatPasswordlessCode,
  generatePasswordlessCode,
  generatePasswordlessSecret,
  getVerifierCookieName,
  hashPasswordlessSecret,
  inspectPendingAuthLink,
  isValidPasswordlessCodeFormat,
  normalizePasswordlessCode,
  parseVerifierFromCookieHeader,
  passwordlessCodeMatches,
  passwordlessSecretMatches,
  validateNextAuthCsrf,
} from "./passwordless";

/**
 * In-memory PendingAuth store implementing the exact Prisma call shapes the
 * service uses. updateMany applies its WHERE guard row-by-row, so the
 * conditional-consume semantics (exactly one racing winner) are faithfully
 * reproduced.
 */
function makeFakeDb() {
  const rows = new Map<string, any>();
  let seq = 0;

  const matches = (row: any, where: any): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.email !== undefined && row.email !== where.email) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (
      where.expiresAt?.gt !== undefined &&
      !(row.expiresAt > where.expiresAt.gt)
    )
      return false;
    if (
      where.expiresAt?.lt !== undefined &&
      !(row.expiresAt < where.expiresAt.lt)
    )
      return false;
    return true;
  };

  const applyData = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as any)) {
        row[key] += (value as any).increment;
      } else {
        row[key] = value;
      }
    }
  };

  const pendingAuth = {
    create: vi.fn(async ({ data }: any) => {
      const row = {
        id: `pa_${++seq}`,
        status: "PENDING",
        attempts: 0,
        callbackUrl: null,
        requestIp: null,
        requestUserAgent: null,
        createdAt: new Date(),
        consumedAt: null,
        ...data,
      };
      rows.set(row.id, row);
      return { ...row };
    }),
    findUnique: vi.fn(async ({ where }: any) => {
      const row = rows.get(where.id);
      return row ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data, select }: any) => {
      const row = rows.get(where.id);
      if (!row) throw new Error("Record not found");
      applyData(row, data);
      if (select?.attempts) return { attempts: row.attempts };
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows.values()) {
        if (!matches(row, where)) continue;
        applyData(row, data);
        count++;
      }
      return { count };
    }),
    deleteMany: vi.fn(async ({ where }: any) => {
      let count = 0;
      for (const [id, row] of rows.entries()) {
        if (matches(row, where)) {
          rows.delete(id);
          count++;
        }
      }
      return { count };
    }),
  };

  const user = { findUnique: vi.fn() };

  return { db: { pendingAuth, user } as any, rows };
}

beforeEach(() => {
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
  auditAuthEvent.mockClear();
});

describe("secret generation and hashing", () => {
  it("generates 256-bit URL-safe secrets", () => {
    const secret = generatePasswordlessSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(generatePasswordlessSecret()).not.toBe(secret);
  });

  it("generates 8-char codes from the unambiguous alphabet only", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePasswordlessCode();
      expect(code).toHaveLength(8);
      for (const ch of code) {
        expect(PASSWORDLESS_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it("alphabet excludes ambiguous characters", () => {
    for (const ch of ["0", "O", "1", "I", "L", "U"]) {
      expect(PASSWORDLESS_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it("hashes are keyed (HMAC) and match only the original value", () => {
    const hash = hashPasswordlessSecret("some-value");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("some-value");
    // Not a plain unkeyed sha256 — a DB dump alone can't verify guesses.
    expect(hash).not.toBe(
      createHash("sha256").update("some-value").digest("hex")
    );
    expect(passwordlessSecretMatches(hash, "some-value")).toBe(true);
    expect(passwordlessSecretMatches(hash, "some-valuf")).toBe(false);
    expect(passwordlessSecretMatches(hash, "")).toBe(false);
  });

  it("normalizes and validates code entry", () => {
    expect(normalizePasswordlessCode(" ab2d-Ef3h ")).toBe("AB2DEF3H");
    expect(formatPasswordlessCode("AB2DEF3H")).toBe("AB2D-EF3H");
    expect(isValidPasswordlessCodeFormat("AB2DEF3H")).toBe(true);
    expect(isValidPasswordlessCodeFormat("AB2DEF3")).toBe(false);
    expect(isValidPasswordlessCodeFormat("AB2DEF30")).toBe(false); // 0 not in alphabet
  });
});

describe("verifier cookie encoding", () => {
  it("round-trips through the cookie header", () => {
    const value = encodeVerifierCookie("pa_1", "secret-value");
    const header = `foo=bar; ${getVerifierCookieName()}=${encodeURIComponent(value)}; baz=1`;
    expect(parseVerifierFromCookieHeader(header)).toEqual({
      pendingId: "pa_1",
      verifier: "secret-value",
    });
  });

  it("rejects malformed cookie values", () => {
    expect(decodeVerifierCookie(undefined)).toBeNull();
    expect(decodeVerifierCookie("v2.pa_1.x")).toBeNull();
    expect(decodeVerifierCookie("v1.only-two")).toBeNull();
    expect(parseVerifierFromCookieHeader("foo=bar")).toBeNull();
    expect(parseVerifierFromCookieHeader(null)).toBeNull();
  });
});

describe("NextAuth CSRF validation (double submit)", () => {
  const secret = process.env.NEXTAUTH_SECRET!;
  const makeCsrfCookie = (token: string) => {
    const hash = createHash("sha256").update(`${token}${secret}`).digest("hex");
    return `next-auth.csrf-token=${encodeURIComponent(`${token}|${hash}`)}`;
  };

  it("accepts a matching token", () => {
    expect(validateNextAuthCsrf(makeCsrfCookie("tok123"), "tok123")).toBe(true);
  });

  it("rejects missing, mismatched, or tampered tokens", () => {
    expect(validateNextAuthCsrf(null, "tok123")).toBe(false);
    expect(validateNextAuthCsrf(makeCsrfCookie("tok123"), "other")).toBe(false);
    expect(validateNextAuthCsrf(makeCsrfCookie("tok123"), null)).toBe(false);
    const forged = `next-auth.csrf-token=${encodeURIComponent("tok123|deadbeef")}`;
    expect(validateNextAuthCsrf(forged, "tok123")).toBe(false);
  });
});

describe("createPendingAuth", () => {
  it("stores only hashes and supersedes previous pending rows for the email", async () => {
    const { db, rows } = makeFakeDb();
    const first = await createPendingAuth(db, { email: "a@example.com" });
    const second = await createPendingAuth(db, { email: "a@example.com" });

    const firstRow = rows.get(first.id)!;
    const secondRow = rows.get(second.id)!;
    expect(firstRow.status).toBe("SUPERSEDED");
    expect(secondRow.status).toBe("PENDING");

    // No plaintext secret is persisted.
    for (const row of [firstRow, secondRow]) {
      const stored = JSON.stringify(row);
      expect(stored).not.toContain(first.verifier);
      expect(stored).not.toContain(first.linkToken);
      expect(stored).not.toContain(first.code);
      expect(stored).not.toContain(second.verifier);
      expect(stored).not.toContain(second.linkToken);
      expect(stored).not.toContain(second.code);
    }
    expect(secondRow.verifierHash).toBe(
      hashPasswordlessSecret(second.verifier)
    );
    expect(secondRow.linkTokenHash).toBe(
      hashPasswordlessSecret(second.linkToken)
    );
    // Relay code is bcrypt-hashed (slow KDF for the one low-entropy secret).
    expect(secondRow.codeHash).toMatch(/^\$2[aby]\$/);
    expect(await passwordlessCodeMatches(secondRow.codeHash, second.code)).toBe(
      true
    );
    expect(await passwordlessCodeMatches(secondRow.codeHash, "WRONGGGG")).toBe(
      false
    );
  });

  it("creates a row even when no account exists (enumeration-uniform)", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, {
      email: "ghost@example.com",
    });
    expect(rows.get(created.id)!.email).toBe("ghost@example.com");
  });
});

describe("inspectPendingAuthLink (scanner-facing, read-only)", () => {
  it("validates a live link without mutating anything", async () => {
    const { db } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });

    db.pendingAuth.update.mockClear();
    db.pendingAuth.updateMany.mockClear();
    db.pendingAuth.deleteMany.mockClear();

    // ACCEPTANCE #3 (service level): N repeated inspections change no state.
    for (let i = 0; i < 5; i++) {
      const inspection = await inspectPendingAuthLink(
        db,
        created.id,
        created.linkToken
      );
      expect(inspection.kind).toBe("valid");
    }
    expect(db.pendingAuth.update).not.toHaveBeenCalled();
    expect(db.pendingAuth.updateMany).not.toHaveBeenCalled();
    expect(db.pendingAuth.deleteMany).not.toHaveBeenCalled();

    // ...and the original completion still works afterwards.
    const result = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: created.verifier,
      linkToken: created.linkToken,
    });
    expect(result).toMatchObject({ ok: true, email: "a@example.com" });
  });

  it("reports invalid for unknown rows and wrong tokens", async () => {
    const { db } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    expect(
      (await inspectPendingAuthLink(db, "missing", created.linkToken)).kind
    ).toBe("invalid");
    expect(
      (await inspectPendingAuthLink(db, created.id, "wrong-token")).kind
    ).toBe("invalid");
  });

  it("reports expired for stale or non-pending rows", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    rows.get(created.id)!.expiresAt = new Date(Date.now() - 1000);
    expect(
      (await inspectPendingAuthLink(db, created.id, created.linkToken)).kind
    ).toBe("expired");

    const other = await createPendingAuth(db, { email: "b@example.com" });
    rows.get(other.id)!.status = "CONSUMED";
    expect(
      (await inspectPendingAuthLink(db, other.id, other.linkToken)).kind
    ).toBe("expired");
  });
});

describe("consumePendingAuth", () => {
  it("consumes exactly once with verifier + linkToken (same browser)", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, {
      email: "a@example.com",
      callbackUrl: "/projects",
    });

    const result = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: created.verifier,
      linkToken: created.linkToken,
    });
    expect(result).toEqual({
      ok: true,
      email: "a@example.com",
      callbackUrl: "/projects",
    });
    expect(rows.get(created.id)!.status).toBe("CONSUMED");

    // Second use of the same link fails: single-shot.
    const replay = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: created.verifier,
      linkToken: created.linkToken,
    });
    expect(replay).toEqual({ ok: false, reason: "expired" });
  });

  it("consumes with verifier + code (cross-device relay)", async () => {
    const { db } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    const result = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: created.verifier,
      code: formatPasswordlessCode(created.code).toLowerCase(), // user-typed form
    });
    expect(result.ok).toBe(true);
  });

  it("rejects without the verifier — a leaked URL alone is inert", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });

    const noVerifier = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: "",
      linkToken: created.linkToken,
    });
    expect(noVerifier).toEqual({ ok: false, reason: "invalid" });

    const wrongVerifier = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: generatePasswordlessSecret(),
      linkToken: created.linkToken,
    });
    expect(wrongVerifier).toEqual({ ok: false, reason: "invalid" });
    expect(rows.get(created.id)!.status).toBe("PENDING");
  });

  it("enforces expiry server-side (ACCEPTANCE #4)", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    rows.get(created.id)!.expiresAt = new Date(Date.now() - 1);
    const result = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: created.verifier,
      linkToken: created.linkToken,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(rows.get(created.id)!.status).toBe("PENDING"); // nothing consumed
  });

  it("locks after MAX wrong codes and rejects the right code afterwards (ACCEPTANCE #5)", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });

    for (let i = 1; i <= PASSWORDLESS_MAX_CODE_ATTEMPTS; i++) {
      const result = await consumePendingAuth(db, {
        pendingId: created.id,
        verifier: created.verifier,
        code: "WRONGGGG",
      });
      expect(result.ok).toBe(false);
      expect((result as any).reason).toBe(
        i < PASSWORDLESS_MAX_CODE_ATTEMPTS ? "invalid_code" : "locked"
      );
    }
    expect(rows.get(created.id)!.status).toBe("LOCKED");

    // Even the correct code no longer works.
    const afterLock = await consumePendingAuth(db, {
      pendingId: created.id,
      verifier: created.verifier,
      code: created.code,
    });
    expect(afterLock).toEqual({ ok: false, reason: "locked" });
  });

  it("exactly one of two concurrent completions succeeds (ACCEPTANCE #6)", async () => {
    const { db } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });

    const [a, b] = await Promise.all([
      consumePendingAuth(db, {
        pendingId: created.id,
        verifier: created.verifier,
        linkToken: created.linkToken,
      }),
      consumePendingAuth(db, {
        pendingId: created.id,
        verifier: created.verifier,
        code: created.code,
      }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("rejects superseded rows (only the latest emailed link is live)", async () => {
    const { db } = makeFakeDb();
    const first = await createPendingAuth(db, { email: "a@example.com" });
    await createPendingAuth(db, { email: "a@example.com" });
    const result = await consumePendingAuth(db, {
      pendingId: first.id,
      verifier: first.verifier,
      linkToken: first.linkToken,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});

describe("authorizePasswordlessComplete (NextAuth provider)", () => {
  const makeReq = (cookieValue?: string) => ({
    headers: cookieValue
      ? {
          cookie: `${getVerifierCookieName()}=${encodeURIComponent(cookieValue)}`,
        }
      : {},
  });

  it("returns the existing flows' user shape on success", async () => {
    const { db } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    db.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      name: "Alice",
      isActive: true,
    });

    const authorize = authorizePasswordlessComplete(db);
    const user = await authorize(
      { pendingId: created.id, linkToken: created.linkToken },
      makeReq(encodeVerifierCookie(created.id, created.verifier))
    );
    expect(user).toEqual({
      id: "user-1",
      email: "a@example.com",
      name: "Alice",
    });
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { email: "a@example.com" },
      select: { id: true, email: true, name: true, isActive: true },
    });
  });

  it("fails without a verifier cookie even with a valid link token", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    const authorize = authorizePasswordlessComplete(db);

    await expect(
      authorize(
        { pendingId: created.id, linkToken: created.linkToken },
        makeReq()
      )
    ).rejects.toThrow("PASSWORDLESS_NO_VERIFIER");
    expect(rows.get(created.id)!.status).toBe("PENDING");
  });

  it("fails when the cookie belongs to a different pending sign-in", async () => {
    const { db } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    const authorize = authorizePasswordlessComplete(db);
    await expect(
      authorize(
        { pendingId: created.id, linkToken: created.linkToken },
        makeReq(encodeVerifierCookie("pa_other", created.verifier))
      )
    ).rejects.toThrow("PASSWORDLESS_NO_VERIFIER");
  });

  it("surfaces expiry and lock as distinct friendly error codes", async () => {
    const { db, rows } = makeFakeDb();
    const created = await createPendingAuth(db, { email: "a@example.com" });
    const authorize = authorizePasswordlessComplete(db);
    const req = makeReq(encodeVerifierCookie(created.id, created.verifier));

    rows.get(created.id)!.expiresAt = new Date(Date.now() - 1);
    await expect(
      authorize({ pendingId: created.id, code: created.code }, req)
    ).rejects.toThrow("PASSWORDLESS_EXPIRED");

    rows.get(created.id)!.expiresAt = new Date(Date.now() + 60_000);
    rows.get(created.id)!.status = "LOCKED";
    await expect(
      authorize({ pendingId: created.id, code: created.code }, req)
    ).rejects.toThrow("PASSWORDLESS_LOCKED");
  });

  it("fails generically when the account does not exist or is inactive", async () => {
    const { db } = makeFakeDb();
    const authorize = authorizePasswordlessComplete(db);

    // Unknown account: a pending row exists (anti-enumeration) but no user.
    const ghost = await createPendingAuth(db, { email: "ghost@example.com" });
    db.user.findUnique.mockResolvedValue(null);
    await expect(
      authorize(
        { pendingId: ghost.id, linkToken: ghost.linkToken },
        makeReq(encodeVerifierCookie(ghost.id, ghost.verifier))
      )
    ).rejects.toThrow("PASSWORDLESS_INVALID");

    const inactive = await createPendingAuth(db, { email: "off@example.com" });
    db.user.findUnique.mockResolvedValue({
      id: "user-2",
      email: "off@example.com",
      name: null,
      isActive: false,
    });
    await expect(
      authorize(
        { pendingId: inactive.id, linkToken: inactive.linkToken },
        makeReq(encodeVerifierCookie(inactive.id, inactive.verifier))
      )
    ).rejects.toThrow("PASSWORDLESS_INVALID");
  });

  it("returns null when the feature flag is off", async () => {
    process.env.PASSWORDLESS_DEVICE_BOUND = "false";
    const { db } = makeFakeDb();
    const authorize = authorizePasswordlessComplete(db);
    expect(
      await authorize({ pendingId: "x", linkToken: "y" }, makeReq())
    ).toBeNull();
  });
});
