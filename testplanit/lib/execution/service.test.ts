import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/live/publish", () => ({ publishTestRunWakeUp: vi.fn() }));
vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({ eventId: "evt", outboxRowId: "who" })),
  },
}));
vi.mock("~/lib/integrations/credentials", () => ({
  resolveStoredCredentials: vi.fn(async (raw: unknown) =>
    raw && typeof raw === "object" ? (raw as Record<string, string>) : {}
  ),
}));

import { publishTestRunWakeUp } from "~/lib/live/publish";
import {
  buildPlanUrl,
  completeExecutionsForRun,
  isPollDue,
  isTimedOut,
  markExecutionResultsReceived,
  nextPollDelayMs,
  resolveTargetCredentials,
  sanitizeExecutionError,
  statusFromExternal,
} from "./service";

beforeEach(() => vi.clearAllMocks());

describe("buildPlanUrl / sanitizeExecutionError", () => {
  it("builds the plan URL with and without an execution", () => {
    expect(buildPlanUrl("https://tpi.example.com", 42)).toBe(
      "https://tpi.example.com/api/test-runs/42/automation-plan"
    );
    expect(buildPlanUrl("https://tpi.example.com", 42, 7)).toBe(
      "https://tpi.example.com/api/test-runs/42/automation-plan?executionId=7"
    );
  });

  it("truncates, keeps the message readable, and never keeps a token", () => {
    const long = "x".repeat(3000);
    expect(sanitizeExecutionError(new Error(long)).length).toBe(1024);
    expect(
      sanitizeExecutionError(new Error("GitHub rejected the dispatch (422)"))
    ).toBe("GitHub rejected the dispatch (422)");
    const withPat = sanitizeExecutionError(
      new Error(
        "Bad credentials for ghp_abcdefghijklmnopqrstuvwxyz0123456789 on acme/web"
      )
    );
    expect(withPat).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(withPat).toMatch(/^Bad credentials for .* on acme\/web$/);
    const withHeader = sanitizeExecutionError(
      new Error(
        "401 Unauthorized: Authorization: Bearer abcdefghijklmnopqrstuvwxyz"
      )
    );
    expect(withHeader).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(
      sanitizeExecutionError(new Error("glpat-AbCdEfGhIjKlMnOp rejected"))
    ).not.toContain("glpat-AbCdEfGhIjKlMnOp");
    expect(sanitizeExecutionError(undefined)).toBe("Unknown error");
  });
});

describe("resolveTargetCredentials", () => {
  it("merges the repository credential under the target override", async () => {
    await expect(
      resolveTargetCredentials(
        { provider: "GITLAB_CI", credentials: { triggerToken: "t" } },
        { provider: "GITLAB", credentials: { personalAccessToken: "p" } }
      )
    ).resolves.toEqual({ personalAccessToken: "p", triggerToken: "t" });
  });

  it("never reads a repository for the generic provider", async () => {
    await expect(
      resolveTargetCredentials(
        { provider: "GENERIC_WEBHOOK", credentials: { secret: "s" } },
        { provider: "GITHUB", credentials: { personalAccessToken: "p" } }
      )
    ).resolves.toEqual({ secret: "s" });
  });
});

describe("statusFromExternal", () => {
  it("maps provider states to execution statuses, or null for no change", () => {
    expect(statusFromExternal("DISPATCHED", { state: "queued" })).toBeNull();
    expect(statusFromExternal("DISPATCHED", { state: "in_progress" })).toBe(
      "RUNNING"
    );
    expect(statusFromExternal("RUNNING", { state: "in_progress" })).toBeNull();
    expect(
      statusFromExternal("RUNNING", {
        state: "completed",
        conclusion: "success",
      })
    ).toBe("SUCCEEDED");
    expect(
      statusFromExternal("RUNNING", {
        state: "completed",
        conclusion: "skipped",
      })
    ).toBe("SUCCEEDED");
    expect(
      statusFromExternal("RUNNING", {
        state: "completed",
        conclusion: "failure",
      })
    ).toBe("FAILED");
    expect(
      statusFromExternal("RUNNING", {
        state: "completed",
        conclusion: "cancelled",
      })
    ).toBe("CANCELLED");
    expect(
      statusFromExternal("RUNNING", {
        state: "completed",
        conclusion: "timed_out",
      })
    ).toBe("TIMED_OUT");
    expect(statusFromExternal("RUNNING", { state: "unknown" })).toBeNull();
  });
});

describe("poll timing", () => {
  it("backs off exponentially and caps at five minutes", () => {
    expect(nextPollDelayMs(0)).toBe(30_000);
    expect(nextPollDelayMs(1)).toBe(60_000);
    expect(nextPollDelayMs(3)).toBe(240_000);
    expect(nextPollDelayMs(10)).toBe(300_000);
  });

  it("is due when the backoff has elapsed since the last poll (or dispatch)", () => {
    const now = new Date("2026-09-10T10:00:00Z");
    expect(
      isPollDue(
        {
          lastPolledAt: null,
          dispatchedAt: new Date("2026-09-10T09:59:00Z"),
          pollCount: 0,
        },
        now
      )
    ).toBe(true);
    expect(
      isPollDue(
        {
          lastPolledAt: new Date("2026-09-10T09:59:50Z"),
          dispatchedAt: null,
          pollCount: 0,
        },
        now
      )
    ).toBe(false);
    expect(
      isPollDue({ lastPolledAt: null, dispatchedAt: null, pollCount: 0 }, now)
    ).toBe(true);
  });

  it("times out from dispatch (or creation when never dispatched)", () => {
    const now = new Date("2026-09-10T10:00:00Z");
    expect(
      isTimedOut({ dispatchedAt: new Date("2026-09-10T05:00:00Z") }, 240, now)
    ).toBe(true);
    expect(
      isTimedOut({ dispatchedAt: new Date("2026-09-10T09:00:00Z") }, 240, now)
    ).toBe(false);
    expect(
      isTimedOut(
        { dispatchedAt: null, createdAt: new Date("2026-09-09T00:00:00Z") },
        240,
        now
      )
    ).toBe(true);
  });
});

describe("markExecutionResultsReceived / completeExecutionsForRun", () => {
  function fakeDb(active: Record<string, unknown> | null) {
    return {
      testRunExecution: {
        findFirst: vi.fn().mockResolvedValue(active),
        findMany: vi
          .fn()
          .mockResolvedValue(active ? [{ id: active.id, projectId: 3 }] : []),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: active ? 1 : 0 }),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValue(active ? [{ id: active.id, projectId: 3 }] : []),
    };
  }

  it("stamps resultsReceivedAt and moves a DISPATCHED execution to RUNNING", async () => {
    const db = fakeDb({
      id: 7,
      projectId: 3,
      status: "DISPATCHED",
      dispatchedAt: new Date(),
    });
    await markExecutionResultsReceived(db, 42);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/UPDATE "TestRunExecution"/);
    expect(sql).toMatch(/WHEN "status" = 'DISPATCHED' THEN 'RUNNING'/);
    expect(db.testRunExecution.update).not.toHaveBeenCalled();
    expect(publishTestRunWakeUp).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "test_run.execution_changed",
        runId: 42,
        targetId: 7,
      })
    );
  });

  it("is a no-op without an active execution and never throws", async () => {
    const db = fakeDb(null);
    await markExecutionResultsReceived(db, 42);
    expect(publishTestRunWakeUp).not.toHaveBeenCalled();
    const failing = fakeDb({
      id: 7,
      projectId: 3,
      status: "RUNNING",
      dispatchedAt: null,
    });
    failing.$queryRaw.mockRejectedValueOnce(new Error("db down"));
    await expect(
      markExecutionResultsReceived(failing, 42)
    ).resolves.toBeUndefined();
  });

  it("closes every active execution when the run completes", async () => {
    const db = fakeDb({ id: 7, projectId: 3, status: "RUNNING" });
    await expect(completeExecutionsForRun(db as never, 42)).resolves.toBe(1);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (db.$queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/UPDATE "TestRunExecution"/);
    expect(db.$queryRaw.mock.calls[0][1]).toBe("SUCCEEDED");
    expect(db.testRunExecution.updateMany).not.toHaveBeenCalled();
    await expect(
      completeExecutionsForRun(fakeDb(null) as never, 42)
    ).resolves.toBe(0);
  });
});
