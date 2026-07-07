// @vitest-environment node
/**
 * POST /api/auth/passwordless/request — start a device-bound sign-in.
 *
 * ACCEPTANCE #7: identical response for existing and non-existing accounts
 * (no user enumeration), while mail goes out only for real, active accounts.
 * Plus: verifier cookie attributes, CSRF, throttling, supersede-on-repeat,
 * and no plaintext secrets at rest.
 */
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
});

vi.mock("~/lib/valkey", () => ({ default: null }));

const { sendPasswordlessEmail } = vi.hoisted(() => ({
  sendPasswordlessEmail: vi.fn(async (_args: { to: string }) => undefined),
}));
vi.mock("~/lib/email/magicLink", () => ({ sendPasswordlessEmail }));

const { auditAuthEvent } = vi.hoisted(() => ({
  auditAuthEvent: vi.fn(async () => undefined),
}));
vi.mock("~/lib/services/auditLog", () => ({ auditAuthEvent }));

const { fakeDb, rows, resetFakeDb, userFindUnique } = vi.hoisted(() => {
  const rows = new Map<string, any>();
  let seq = 0;
  const matches = (row: any, where: any): boolean => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.email !== undefined && row.email !== where.email) return false;
    if (where.status !== undefined && row.status !== where.status) return false;
    if (
      where.expiresAt?.lt !== undefined &&
      !(row.expiresAt < where.expiresAt.lt)
    )
      return false;
    return true;
  };
  const userFindUnique = { fn: async (_args: any): Promise<any> => null };
  const fakeDb = {
    pendingAuth: {
      create: async ({ data }: any) => {
        const row = {
          id: `pa_${++seq}`,
          status: "PENDING",
          attempts: 0,
          createdAt: new Date(),
          consumedAt: null,
          ...data,
        };
        rows.set(row.id, row);
        return { ...row };
      },
      findUnique: async ({ where }: any) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows.values()) {
          if (!matches(row, where)) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (const [id, row] of rows.entries()) {
          if (matches(row, where)) {
            rows.delete(id);
            count++;
          }
        }
        return { count };
      },
    },
    user: { findUnique: (args: any) => userFindUnique.fn(args) },
  };
  return { fakeDb, rows, resetFakeDb: () => rows.clear(), userFindUnique };
});

vi.mock("~/server/db", () => ({ db: fakeDb }));

import { POST } from "./route";

const SECRET = "test-secret-key-at-least-32-chars-long";
const CSRF_TOKEN = "csrf-token-value";
const csrfCookie = () => {
  const hash = createHash("sha256")
    .update(`${CSRF_TOKEN}${SECRET}`)
    .digest("hex");
  return `next-auth.csrf-token=${encodeURIComponent(`${CSRF_TOKEN}|${hash}`)}`;
};

let ipSeq = 0;
function makePost(body: unknown, opts?: { ip?: string; cookie?: string }) {
  // Unique source IP per request unless pinned — keeps the in-memory
  // rate limiter from coupling unrelated tests.
  const ip = opts?.ip ?? `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  return new NextRequest(
    "https://app.example.com/api/auth/passwordless/request",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        cookie: opts?.cookie ?? csrfCookie(),
      },
    }
  );
}

const activeUser = {
  id: "user-1",
  isActive: true,
  userPreferences: { locale: "en_US" },
};

// The email dispatch is deliberately fire-and-forget; give the microtask
// queue a chance to drain before asserting on it.
const flush = () => new Promise((resolve) => setTimeout(resolve, 25));

beforeEach(() => {
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
  resetFakeDb();
  sendPasswordlessEmail.mockClear();
  auditAuthEvent.mockClear();
  userFindUnique.fn = async () => null;
});

describe("anti-enumeration (ACCEPTANCE #7)", () => {
  it("returns an identical response shape for existing and unknown accounts", async () => {
    userFindUnique.fn = async ({ where }: any) =>
      where.email === "real@example.com" ? activeUser : null;

    const resReal = await POST(
      makePost({ email: "real@example.com", csrfToken: CSRF_TOKEN })
    );
    const resGhost = await POST(
      makePost({ email: "ghost@example.com", csrfToken: CSRF_TOKEN })
    );

    expect(resReal.status).toBe(200);
    expect(resGhost.status).toBe(200);

    const bodyReal = await resReal.json();
    const bodyGhost = await resGhost.json();
    expect(Object.keys(bodyReal).sort()).toEqual(Object.keys(bodyGhost).sort());
    expect(bodyReal.enabled).toBe(true);
    expect(bodyGhost.enabled).toBe(true);
    expect(bodyGhost.pendingId).toBeTruthy();

    // Both set the verifier cookie.
    expect(resReal.headers.getSetCookie().join()).toContain(
      "tpi.passwordless-verifier"
    );
    expect(resGhost.headers.getSetCookie().join()).toContain(
      "tpi.passwordless-verifier"
    );

    await flush();
    // Mail only for the real account.
    expect(sendPasswordlessEmail).toHaveBeenCalledTimes(1);
    expect(sendPasswordlessEmail.mock.calls[0][0]).toMatchObject({
      to: "real@example.com",
    });
  });

  it("does not email inactive accounts either", async () => {
    userFindUnique.fn = async () => ({ ...activeUser, isActive: false });
    const res = await POST(
      makePost({ email: "inactive@example.com", csrfToken: CSRF_TOKEN })
    );
    expect(res.status).toBe(200);
    await flush();
    expect(sendPasswordlessEmail).not.toHaveBeenCalled();
  });
});

describe("verifier cookie", () => {
  it("is HttpOnly, Secure, SameSite=Lax, scoped to /api/auth, with TTL-matched Max-Age", async () => {
    const res = await POST(
      makePost({ email: "cookie@example.com", csrfToken: CSRF_TOKEN })
    );
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toContain("__Secure-tpi.passwordless-verifier=");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/auth/i);
    expect(setCookie).toMatch(/Max-Age=2700/i); // 45 min
  });

  it("stores only hashes — no plaintext secret at rest matches the cookie", async () => {
    const res = await POST(
      makePost({ email: "hash@example.com", csrfToken: CSRF_TOKEN })
    );
    const body = await res.json();
    const row = rows.get(body.pendingId)!;
    const setCookie = res.headers.getSetCookie().join("\n");
    const stored = JSON.stringify(row);
    // The cookie's verifier segment never appears in the row.
    const cookieValue = /verifier=([^;]+)/.exec(setCookie)![1];
    const verifier = decodeURIComponent(cookieValue).split(".")[2];
    expect(verifier.length).toBeGreaterThan(30);
    expect(stored).not.toContain(verifier);
    expect(row.verifierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.linkTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).toMatch(/^\$2[aby]\$/); // bcrypt (slow KDF)
  });
});

describe("repeat requests", () => {
  it("supersedes the previous pending row so only the latest link is live", async () => {
    const res1 = await POST(
      makePost({ email: "repeat@example.com", csrfToken: CSRF_TOKEN })
    );
    const res2 = await POST(
      makePost({ email: "repeat@example.com", csrfToken: CSRF_TOKEN })
    );
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(rows.get(body1.pendingId)!.status).toBe("SUPERSEDED");
    expect(rows.get(body2.pendingId)!.status).toBe("PENDING");
  });
});

describe("request hardening", () => {
  it("rejects a missing/invalid CSRF token", async () => {
    const res = await POST(
      makePost(
        { email: "csrf@example.com", csrfToken: "wrong" },
        { cookie: csrfCookie() }
      )
    );
    expect(res.status).toBe(403);

    const res2 = await POST(
      makePost(
        { email: "csrf@example.com", csrfToken: CSRF_TOKEN },
        { cookie: "unrelated=1" }
      )
    );
    expect(res2.status).toBe(403);
  });

  it("rejects malformed bodies", async () => {
    const res = await POST(
      makePost({ email: "not-an-email", csrfToken: CSRF_TOKEN })
    );
    expect(res.status).toBe(400);
  });

  it("throttles per email", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(
        makePost({ email: "throttle@example.com", csrfToken: CSRF_TOKEN })
      );
      expect(res.status).toBe(200);
    }
    const res = await POST(
      makePost({ email: "throttle@example.com", csrfToken: CSRF_TOKEN })
    );
    expect(res.status).toBe(429);
  });

  it("throttles per IP", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        makePost(
          { email: `ip-limit-${i}@example.com`, csrfToken: CSRF_TOKEN },
          { ip: "192.0.2.99" }
        )
      );
      expect(res.status).toBe(200);
    }
    const res = await POST(
      makePost(
        { email: "ip-limit-final@example.com", csrfToken: CSRF_TOKEN },
        { ip: "192.0.2.99" }
      )
    );
    expect(res.status).toBe(429);
  });
});

describe("feature flag", () => {
  it("answers { enabled: false } when off, so the client falls back to the stock flow", async () => {
    process.env.PASSWORDLESS_DEVICE_BOUND = "false";
    const res = await POST(
      makePost({ email: "off@example.com", csrfToken: CSRF_TOKEN })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
    expect(rows.size).toBe(0);
  });
});
