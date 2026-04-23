import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAuditContext,
  runWithAuditContext,
  type AuditContext,
  SYSTEM_ACTOR_ID,
} from "./auditContext";
import { enqueueWithAuditContext } from "./auditContextEnqueue";

// Hand-rolled Queue mock — no real BullMQ or Valkey connection.
type QueueMock = {
  add: ReturnType<typeof vi.fn>;
};
function makeQueueMock(): QueueMock {
  return { add: vi.fn(async () => ({ id: "job-mock" })) };
}

// This suite intentionally does NOT mock next/headers. The enqueue module
// is runtime-agnostic and must load cleanly in environments where Next.js
// is not installed (e.g. the workers Docker image).
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
        { foo: "bar" }
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
        { foo: "bar" }
      )
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
          { foo: "bar" }
        );
      })
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
        { foo: "bar" }
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
      { systemReason: "scheduled:test-rollup" }
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
      { systemReason: "scheduled:mirror-test" }
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
        { systemReason: "scheduled:should-be-ignored" }
      );
    });

    const payload = queue.add.mock.calls[0][1] as Record<string, unknown>;
    expect((payload.actorContext as AuditContext).userId).toBe("u-user-wins");
    // No __system__ anywhere in actorContext
    expect((payload.actorContext as AuditContext).userId).not.toBe(
      SYSTEM_ACTOR_ID
    );
    // No systemReason leaks in on the user-attributed branch
    expect(payload.systemReason).toBeUndefined();
    expect((payload.actorContext as AuditContext).systemReason).toBeUndefined();
  });

  it("sanity: getAuditContext is the same module both tests import", async () => {
    // Guard against a stealth duplicate-module issue where the enqueue
    // module's ALS store diverges from the test's. If this ever fails,
    // the tsconfig path alias or vitest resolver has drifted.
    await runWithAuditContext({ userId: "sanity" }, async () => {
      expect(getAuditContext()?.userId).toBe("sanity");
    });
  });
});
