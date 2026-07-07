// @vitest-environment node
/**
 * GET /api/auth/passwordless/callback — the emailed link target.
 *
 * ACCEPTANCE #3 (the whole point of the feature): a mail-security scanner
 * GET-ing the link any number of times, with no verifier cookie, must
 * consume nothing and log nobody in — and the human's completion must still
 * work afterwards.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key-at-least-32-chars-long";
  process.env.NEXTAUTH_URL = "https://app.example.com";
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
});

vi.mock("~/lib/valkey", () => ({ default: null }));
vi.mock("~/lib/services/auditLog", () => ({
  auditAuthEvent: vi.fn(async () => undefined),
}));

const { fakeDb, rows, resetFakeDb } = vi.hoisted(() => {
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
  const fakeDb = {
    pendingAuth: {
      create: async ({ data }: any) => {
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
      },
      findUnique: async ({ where }: any) => {
        const row = rows.get(where.id);
        return row ? { ...row } : null;
      },
      update: Object.assign(async ({ where, data, select }: any) => {
        const row = rows.get(where.id);
        if (!row) throw new Error("Record not found");
        applyData(row, data);
        if (select?.attempts) return { attempts: row.attempts };
        return { ...row };
      }, {}),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of rows.values()) {
          if (!matches(row, where)) continue;
          applyData(row, data);
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
    user: { findUnique: async () => null },
  };
  return { fakeDb, rows, resetFakeDb: () => rows.clear() };
});

vi.mock("~/server/db", () => ({ db: fakeDb }));

import {
  consumePendingAuth,
  createPendingAuth,
  encodeVerifierCookie,
  getVerifierCookieName,
} from "~/lib/passwordless";
import { GET } from "./route";

// Spy on every mutating pendingAuth operation to prove the GET is read-only.
const mutationSpies = () => {
  const update = vi.spyOn(fakeDb.pendingAuth, "update" as any);
  const updateMany = vi.spyOn(fakeDb.pendingAuth, "updateMany" as any);
  const deleteMany = vi.spyOn(fakeDb.pendingAuth, "deleteMany" as any);
  const create = vi.spyOn(fakeDb.pendingAuth, "create" as any);
  return { update, updateMany, deleteMany, create };
};

function makeGet(qs: string, cookie?: string) {
  return new NextRequest(
    `https://app.example.com/api/auth/passwordless/callback${qs}`,
    { headers: cookie ? { cookie } : {} }
  );
}

beforeEach(() => {
  process.env.PASSWORDLESS_DEVICE_BOUND = "true";
  resetFakeDb();
  vi.restoreAllMocks();
});

describe("scanner prefetch (ACCEPTANCE #3)", () => {
  it("N cookie-less GETs consume nothing, log nobody in, and the human can still complete", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
    });
    const spies = mutationSpies();

    for (let i = 0; i < 5; i++) {
      const res = await GET(
        makeGet(
          `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=${created.code}`
        )
      );
      // Renders the relay-code page — no session cookie, no consumption.
      expect(res.status).toBeGreaterThanOrEqual(300);
      expect(res.status).toBeLessThan(400);
      expect(res.headers.get("location")).toBe(
        `https://app.example.com/passwordless/code?code=${encodeURIComponent(created.code)}`
      );
      expect(res.headers.getSetCookie()).toEqual([]);
      expect(rows.get(created.id)!.status).toBe("PENDING");
    }

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.updateMany).not.toHaveBeenCalled();
    expect(spies.deleteMany).not.toHaveBeenCalled();
    expect(spies.create).not.toHaveBeenCalled();

    // The original window still completes afterwards.
    const result = await consumePendingAuth(fakeDb as any, {
      pendingId: created.id,
      verifier: created.verifier,
      code: created.code,
    });
    expect(result.ok).toBe(true);
  });

  it("a GET with a FOREIGN verifier cookie is also read-only (scanner behind a proxy reusing cookies)", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
    });
    const spies = mutationSpies();
    const res = await GET(
      makeGet(
        `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=${created.code}`,
        `${getVerifierCookieName()}=${encodeURIComponent(encodeVerifierCookie(created.id, "wrong-verifier"))}`
      )
    );
    expect(res.headers.get("location")).toContain("/passwordless/code");
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.updateMany).not.toHaveBeenCalled();
    expect(rows.get(created.id)!.status).toBe("PENDING");
  });
});

describe("same-browser click", () => {
  it("redirects to the completion page without consuming anything yet", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
      callbackUrl: "/projects",
    });
    const spies = mutationSpies();
    const res = await GET(
      makeGet(
        `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=${created.code}`,
        `${getVerifierCookieName()}=${encodeURIComponent(encodeVerifierCookie(created.id, created.verifier))}`
      )
    );
    const location = res.headers.get("location")!;
    expect(location).toContain("https://app.example.com/passwordless/complete");
    expect(location).toContain(`pid=${created.id}`);
    expect(location).toContain(
      `token=${encodeURIComponent(created.linkToken)}`
    );
    expect(location).toContain(
      `callbackUrl=${encodeURIComponent("/projects")}`
    );
    // Consumption happens in the NextAuth provider POST, not on this GET.
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.updateMany).not.toHaveBeenCalled();
    expect(rows.get(created.id)!.status).toBe("PENDING");
  });

  it("does not put an absolute/external callbackUrl in the redirect", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
      callbackUrl: "https://evil.example.com/phish",
    });
    const res = await GET(
      makeGet(
        `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=${created.code}`,
        `${getVerifierCookieName()}=${encodeURIComponent(encodeVerifierCookie(created.id, created.verifier))}`
      )
    );
    const location = res.headers.get("location")!;
    expect(location).toContain(`callbackUrl=${encodeURIComponent("/")}`);
    expect(location).not.toContain("evil.example.com");
  });
});

describe("invalid and expired links (ACCEPTANCE #4)", () => {
  it("expired link redirects to the friendly expired page", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
    });
    rows.get(created.id)!.expiresAt = new Date(Date.now() - 1000);
    const res = await GET(
      makeGet(
        `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=${created.code}`
      )
    );
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/passwordless/expired?reason=expired"
    );
  });

  it("already-consumed link redirects to the expired page", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
    });
    rows.get(created.id)!.status = "CONSUMED";
    const res = await GET(
      makeGet(
        `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=${created.code}`
      )
    );
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/passwordless/expired?reason=expired"
    );
  });

  it("unknown pid or wrong token redirects with reason=invalid", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
    });
    for (const qs of [
      `?pid=missing&token=${encodeURIComponent(created.linkToken)}`,
      `?pid=${created.id}&token=not-the-token`,
      `?pid=${created.id}`,
      "",
    ]) {
      const res = await GET(makeGet(qs));
      expect(res.headers.get("location")).toBe(
        "https://app.example.com/passwordless/expired?reason=invalid"
      );
    }
  });

  it("a tampered code param is never displayed", async () => {
    const created = await createPendingAuth(fakeDb as any, {
      email: "a@example.com",
    });
    const res = await GET(
      makeGet(
        `?pid=${created.id}&token=${encodeURIComponent(created.linkToken)}&code=FAKECODE`
      )
    );
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/passwordless/expired?reason=invalid"
    );
  });
});

describe("feature flag", () => {
  it("redirects to the expired page when the flag is off", async () => {
    process.env.PASSWORDLESS_DEVICE_BOUND = "false";
    const res = await GET(makeGet("?pid=x&token=y"));
    expect(res.headers.get("location")).toBe(
      "https://app.example.com/passwordless/expired?reason=disabled"
    );
  });
});
