import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  getAuditContext,
  runWithAuditContext,
  type AuditContext,
} from "./auditContext";
import {
  enrichFromApiAuth,
  withActionAuditContext,
  withAuditContext,
} from "./auditContextWrappers";

// Hermetic mock for next/headers — per Phase 63 D-18, use vi.hoisted so the
// factory closure captures the mutable state before any helper code runs.
const headersMocks = vi.hoisted(() => ({
  current: new Map<string, string>([
    ["user-agent", "vitest-agent/1.0"],
    ["x-forwarded-for", "10.0.0.1"],
  ]),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    return {
      get: (key: string) => headersMocks.current.get(key.toLowerCase()) ?? null,
    };
  }),
}));

/**
 * Build a fake NextRequest whose `headers` supports `get(...)` with the
 * shape the extractor requires. Only the methods we touch need to exist.
 */
function fakeRequest(entries: Record<string, string>): NextRequest {
  const map = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    headers: {
      get: (key: string) => map.get(key.toLowerCase()) ?? null,
    },
  } as unknown as NextRequest;
}

describe("withAuditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates ALS with ipAddress/userAgent/requestId from request headers", async () => {
    let observed: AuditContext | undefined;
    const handler = withAuditContext(async (_req: NextRequest) => {
      observed = getAuditContext();
      return new Response("ok");
    });

    const req = fakeRequest({
      "user-agent": "UA/route",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });
    const res = await handler(req);

    expect(res).toBeInstanceOf(Response);
    expect(observed).toBeDefined();
    expect(observed?.userAgent).toBe("UA/route");
    // x-forwarded-for takes the first IP
    expect(observed?.ipAddress).toBe("203.0.113.7");
    expect(observed?.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
  });

  it("handler observes populated context via getAuditContext()", async () => {
    const handler = withAuditContext(async (_req: NextRequest) => {
      const ctx = getAuditContext();
      return new Response(
        JSON.stringify({
          hasReqId: Boolean(ctx?.requestId),
          hasUa: Boolean(ctx?.userAgent),
        })
      );
    });

    const req = fakeRequest({ "user-agent": "UA/obs" });
    const res = await handler(req);
    const body = (await res.json()) as {
      hasReqId: boolean;
      hasUa: boolean;
    };
    expect(body.hasReqId).toBe(true);
    expect(body.hasUa).toBe(true);
  });
});

describe("withActionAuditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headersMocks.current = new Map<string, string>([
      ["user-agent", "vitest-agent/1.0"],
      ["x-forwarded-for", "10.0.0.1"],
    ]);
  });

  it("populates ALS via next/headers and generates fresh requestId per call", async () => {
    let observed: AuditContext | undefined;
    const action = withActionAuditContext(async (arg: string) => {
      observed = getAuditContext();
      return `result:${arg}`;
    });

    const result = await action("hello");
    expect(result).toBe("result:hello");
    expect(observed).toBeDefined();
    expect(observed?.userAgent).toBe("vitest-agent/1.0");
    expect(observed?.ipAddress).toBe("10.0.0.1");
    expect(observed?.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
  });

  it("each invocation gets a distinct requestId", async () => {
    const seen: string[] = [];
    const action = withActionAuditContext(async () => {
      const ctx = getAuditContext();
      if (ctx?.requestId) seen.push(ctx.requestId);
      return null;
    });

    await action();
    // Pause a tick so Date.now() has room to advance; even without it the
    // random suffix guarantees uniqueness, but the double call below keeps
    // the assertion honest across clock precision boundaries.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await action();

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

describe("enrichFromApiAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates ALS frame with userId/userEmail/userName", async () => {
    let observed: AuditContext | undefined;
    await runWithAuditContext(
      {
        ipAddress: "192.0.2.1",
        userAgent: "UA/bearer",
        requestId: "req_bearer_1",
      },
      async () => {
        enrichFromApiAuth({
          userId: "u-bearer",
          userEmail: "bearer@example.com",
          userName: "Bearer User",
        });
        observed = getAuditContext();
      }
    );

    expect(observed).toMatchObject({
      userId: "u-bearer",
      userEmail: "bearer@example.com",
      userName: "Bearer User",
      ipAddress: "192.0.2.1",
      userAgent: "UA/bearer",
      requestId: "req_bearer_1",
    });
  });

  it("is a no-op when called outside an ALS frame", () => {
    // Outside any runWithAuditContext frame — should not throw, should
    // not pollute any global state.
    expect(() =>
      enrichFromApiAuth({
        userId: "u-orphan",
        userEmail: "orphan@example.com",
        userName: "Orphan",
      })
    ).not.toThrow();
    // The behavioral contract is "doesn't throw" — enrichFromApiAuth must
    // not create its own ALS frame; anything else is delegated to
    // updateAuditContext's existing semantics.
  });
});
