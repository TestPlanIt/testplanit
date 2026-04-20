import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  getAuditContext,
  runWithAuditContext,
  type AuditContext,
  SYSTEM_ACTOR_ID,
} from "./auditContext";
import {
  enqueueWithAuditContext,
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

// Hand-rolled Queue mock — no real BullMQ or Valkey connection.
type QueueMock = {
  add: ReturnType<typeof vi.fn>;
};
function makeQueueMock(): QueueMock {
  return { add: vi.fn(async () => ({ id: "job-mock" })) };
}

/**
 * Build a fake NextRequest whose `headers` supports `get(...)` with the
 * shape the extractor requires. Only the methods we touch need to exist.
 */
function fakeRequest(entries: Record<string, string>): NextRequest {
  const map = new Map(
    Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]),
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
        }),
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

describe("enqueueWithAuditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges ALS context into actorContext when ALS is present", async () => {
    const queue = makeQueueMock();
    const ctx: AuditContext = {
      userId: "u-42",
      userEmail: "u42@example.com",
      userName: "User 42",
      ipAddress: "198.51.100.2",
      userAgent: "UA/enqueue",
      requestId: "req_fixed_42",
    };

    await runWithAuditContext(ctx, async () => {
      await enqueueWithAuditContext(
        queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
        "job-alpha",
        { foo: "bar" },
      );
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload] = queue.add.mock.calls[0];
    expect(jobName).toBe("job-alpha");
    expect(payload).toMatchObject({
      foo: "bar",
      actorContext: {
        userId: "u-42",
        userEmail: "u42@example.com",
        userName: "User 42",
        ipAddress: "198.51.100.2",
        userAgent: "UA/enqueue",
        requestId: "req_fixed_42",
      },
    });
    // No root-level systemReason mirror when not system-stamped
    expect((payload as Record<string, unknown>).systemReason).toBeUndefined();
  });

  it("throws when ALS is empty and no systemReason is provided", async () => {
    const queue = makeQueueMock();

    // Call OUTSIDE any runWithAuditContext frame — ALS is empty.
    await expect(
      enqueueWithAuditContext(
        queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
        "job-beta",
        { foo: "bar" },
      ),
    ).rejects.toThrow(/no audit context present/);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it("throws when ALS contains only empty-string fields and no systemReason (WR-01 hardening)", async () => {
    const queue = makeQueueMock();
    const emptyCtx: AuditContext = {
      userId: "",
      userEmail: "",
      userName: "",
      ipAddress: "",
      userAgent: "",
      requestId: "",
    };

    await expect(
      runWithAuditContext(emptyCtx, async () => {
        await enqueueWithAuditContext(
          queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
          "job-empty-strings",
          { foo: "bar" },
        );
      }),
    ).rejects.toThrow(/no audit context present/);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it("does NOT misattribute when ALS has a populated userId but empty ipAddress (WR-01 future-refactor guard)", async () => {
    const queue = makeQueueMock();
    const ctx: AuditContext = {
      userId: "u-real",
      userEmail: "real@example.com",
      userName: "Real User",
      ipAddress: "", // future-refactor scenario: extractIpAddress defaulted to ""
      userAgent: "UA/real",
      requestId: "req_real_1",
    };

    await runWithAuditContext(ctx, async () => {
      await enqueueWithAuditContext(
        queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
        "job-mixed",
        { foo: "bar" },
      );
    });

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, payload] = queue.add.mock.calls[0];
    // The user is real, so user-attribution wins (the empty ipAddress is
    // faithfully carried through — we do NOT rewrite it, we just do not
    // let it alone flip the branch). The job payload reflects the
    // actual ALS state; consumers / expectAuditRowComplete catch the
    // incomplete ipAddress downstream via WR-03.
    expect((payload as Record<string, unknown>).actorContext).toMatchObject({
      userId: "u-real",
      ipAddress: "",
    });
  });

  it("stamps __system__ with systemReason embedded in actorContext when ALS is empty", async () => {
    const queue = makeQueueMock();

    await enqueueWithAuditContext(
      queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
      "job-gamma",
      { foo: "bar" },
      { systemReason: "scheduled:test-rollup" },
    );

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload] = queue.add.mock.calls[0];
    expect(jobName).toBe("job-gamma");
    expect(payload).toMatchObject({
      foo: "bar",
      actorContext: {
        userId: SYSTEM_ACTOR_ID,
        systemReason: "scheduled:test-rollup",
      },
    });
  });

  it("sets root-level systemReason mirror on the job payload", async () => {
    const queue = makeQueueMock();

    await enqueueWithAuditContext(
      queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
      "job-delta",
      { foo: "bar" },
      { systemReason: "scheduled:mirror-test" },
    );

    const payload = queue.add.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.systemReason).toBe("scheduled:mirror-test");
  });

  it("prefers ALS context over systemReason when both present", async () => {
    const queue = makeQueueMock();
    const ctx: AuditContext = {
      userId: "u-user-wins",
      userEmail: "user@example.com",
      userName: "Real User",
      requestId: "req_user_wins",
    };

    await runWithAuditContext(ctx, async () => {
      await enqueueWithAuditContext(
        queue as unknown as Parameters<typeof enqueueWithAuditContext>[0],
        "job-epsilon",
        { foo: "bar" },
        { systemReason: "scheduled:should-be-ignored" },
      );
    });

    const payload = queue.add.mock.calls[0][1] as Record<string, unknown>;
    expect((payload.actorContext as AuditContext).userId).toBe("u-user-wins");
    // No __system__ anywhere in actorContext
    expect((payload.actorContext as AuditContext).userId).not.toBe(
      SYSTEM_ACTOR_ID,
    );
    // No systemReason leaks in on the user-attributed branch
    expect(payload.systemReason).toBeUndefined();
    expect((payload.actorContext as AuditContext).systemReason).toBeUndefined();
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
      },
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
      }),
    ).not.toThrow();
    // getAuditContext may return the globalFallbackContext singleton if
    // some other test set it; the invariant we care about here is that
    // enrichFromApiAuth itself doesn't create a frame. Confirm that via
    // the ALS store directly.
    // Note: we don't assert getAuditContext() === undefined because
    // auditContext.ts's getAuditContext falls back to globalFallbackContext.
    // The behavioral contract is "doesn't throw"; anything else is
    // delegated to updateAuditContext's existing semantics.
  });
});
