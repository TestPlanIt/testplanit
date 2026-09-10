import { beforeEach, describe, expect, it, vi } from "vitest";

const adapterMock = vi.hoisted(() => ({
  supportsStatusPolling: true,
  dispatch: vi.fn(),
  getStatus: vi.fn(),
  cancel: vi.fn(),
  findRunCreatedAfter: vi.fn(),
}));

vi.mock("./adapters", () => {
  class GitHubDispatchAdapter {}
  class DispatchError extends Error {
    constructor(
      message: string,
      public code: string
    ) {
      super(message);
      this.name = "DispatchError";
    }
  }
  return {
    createCiDispatchAdapter: vi.fn(() => adapterMock),
    GitHubDispatchAdapter,
    DispatchError,
  };
});
vi.mock("~/lib/services/auditLog", () => ({ captureAuditEvent: vi.fn() }));
vi.mock("~/lib/live/publish", () => ({ publishTestRunWakeUp: vi.fn() }));
vi.mock("~/lib/webhooks/events", () => ({
  webhookEvents: {
    emit: vi.fn(async () => ({ eventId: "evt", outboxRowId: "who" })),
  },
}));
vi.mock("~/lib/integrations/credentials", () => ({
  resolveStoredCredentials: vi.fn(async () => ({ personalAccessToken: "t" })),
}));
vi.mock("~/lib/auth-security", () => ({
  getAppBaseUrl: () => "https://tpi.example.com",
}));

import { captureAuditEvent } from "~/lib/services/auditLog";
import { webhookEvents } from "~/lib/webhooks/events";
import {
  dispatchExecution,
  finalizeExecution,
  pollActiveExecutions,
} from "./dispatch";

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    provider: "GITHUB_ACTIONS",
    workflowRef: "e2e.yml",
    defaultRef: "main",
    url: null,
    staticInputs: { ENV: "staging" },
    credentials: null,
    timeoutMinutes: 240,
    isEnabled: true,
    isDeleted: false,
    codeRepository: {
      provider: "GITHUB",
      credentials: { encrypted: "x" },
      settings: { owner: "acme", repo: "web" },
    },
    ...overrides,
  };
}

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    testRunId: 42,
    projectId: 3,
    status: "PENDING",
    ref: null,
    inputs: { browser: "chrome" },
    externalRunId: null,
    externalUrl: null,
    pollCount: 0,
    dispatchedAt: null,
    lastPolledAt: null,
    resultsReceivedAt: null,
    adHoc: false,
    createdAt: new Date("2026-09-10T09:00:00Z"),
    target: target(),
    ...overrides,
  };
}

function fakeDb(
  rows: Record<string, unknown>[],
  run: { isCompleted: boolean; isDeleted: boolean } | null = {
    isCompleted: false,
    isDeleted: false,
  }
) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const db = {
    updates,
    testRuns: {
      findUnique: vi.fn(async () => run),
      update: vi.fn(async (args: unknown) => args),
    },
    testRunExecution: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: number } }) =>
          rows.find((r) => r.id === where.id) ?? null
      ),
      findMany: vi.fn(async () => rows),
      update: vi.fn(
        async (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push(args);
          const row = rows.find(
            (r) => r.id === (args.where as { id: number }).id
          );
          return { ...row, ...args.data };
        }
      ),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(db)
    ),
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  adapterMock.supportsStatusPolling = true;
});

describe("dispatchExecution", () => {
  it("builds the reserved inputs, dispatches, and records DISPATCHED", async () => {
    adapterMock.dispatch.mockResolvedValueOnce({
      ref: "main",
      externalRunId: "555",
      externalUrl: "https://github.com/acme/web/actions/runs/555",
    });
    const db = fakeDb([execution()]);
    const outcome = await dispatchExecution(db as never, 7, {
      tenantId: "acme",
    });
    expect(outcome).toEqual({ outcome: "dispatched", executionId: 7 });

    const req = adapterMock.dispatch.mock.calls[0][0];
    expect(req).toMatchObject({
      runId: 42,
      executionId: 7,
      projectId: 3,
      ref: "main",
      appUrl: "https://tpi.example.com",
      planUrl:
        "https://tpi.example.com/api/test-runs/42/automation-plan?executionId=7",
    });
    expect(req.inputs).toEqual({
      ENV: "staging",
      browser: "chrome",
      TESTPLANIT_RUN_ID: "42",
      TESTPLANIT_EXECUTION_ID: "7",
      TESTPLANIT_PROJECT_ID: "3",
      TESTPLANIT_URL: "https://tpi.example.com",
      TESTPLANIT_PLAN_URL:
        "https://tpi.example.com/api/test-runs/42/automation-plan?executionId=7",
    });
    expect(db.updates[0].data).toMatchObject({
      status: "DISPATCHED",
      externalRunId: "555",
      dispatchedAt: expect.any(Date),
    });
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "EXECUTION_DISPATCHED",
        entityId: "7",
        tenantId: "acme",
      })
    );
  });

  it("records DISPATCH_FAILED with a sanitised error and emits the completed event", async () => {
    adapterMock.dispatch.mockRejectedValueOnce(
      new Error("GitHub rejected the dispatch (422)")
    );
    const db = fakeDb([execution()]);
    const outcome = await dispatchExecution(db as never, 7);
    expect(outcome).toMatchObject({
      outcome: "dispatch_failed",
      error: expect.stringMatching(/422/),
    });
    expect(db.updates.at(-1)?.data).toMatchObject({
      status: "DISPATCH_FAILED",
      completedAt: expect.any(Date),
    });
    expect(webhookEvents.emit).toHaveBeenCalledWith(
      "test_run.execution_completed",
      expect.objectContaining({ id: 7, status: "DISPATCH_FAILED" }),
      expect.anything()
    );
  });

  it("refuses a disabled target and skips executions that are not PENDING", async () => {
    const disabled = fakeDb([
      execution({ target: target({ isEnabled: false }) }),
    ]);
    await expect(
      dispatchExecution(disabled as never, 7)
    ).resolves.toMatchObject({
      outcome: "dispatch_failed",
      error: expect.stringMatching(/disabled/),
    });
    const done = fakeDb([execution({ status: "DISPATCHED" })]);
    await expect(dispatchExecution(done as never, 7)).resolves.toMatchObject({
      outcome: "skipped",
    });
    expect(adapterMock.dispatch).not.toHaveBeenCalled();
    await expect(
      dispatchExecution(fakeDb([]) as never, 99)
    ).resolves.toMatchObject({
      outcome: "skipped",
      reason: "not found",
    });
  });
});

describe("pollActiveExecutions", () => {
  const now = () => new Date("2026-09-10T10:00:00Z");

  it("fails a PENDING execution whose dispatch job never ran", async () => {
    const db = fakeDb([
      execution({
        id: 3,
        status: "PENDING",
        createdAt: new Date("2026-09-10T09:40:00Z"),
      }),
      execution({
        id: 4,
        status: "PENDING",
        createdAt: new Date("2026-09-10T09:55:00Z"),
      }),
    ]);
    const summary = await pollActiveExecutions(db as never, { now });
    expect(summary.stalled).toBe(1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      where: { id: 3 },
      data: {
        status: "DISPATCH_FAILED",
        error: expect.stringMatching(/did not run/),
      },
    });
    expect(adapterMock.getStatus).not.toHaveBeenCalled();
  });

  it("times out an execution past its target's timeout regardless of provider", async () => {
    const db = fakeDb([
      execution({
        status: "RUNNING",
        dispatchedAt: new Date("2026-09-10T05:00:00Z"),
        externalRunId: "1",
      }),
    ]);
    const summary = await pollActiveExecutions(db as never, { now });
    expect(summary.timedOut).toBe(1);
    expect(db.updates.at(-1)?.data).toMatchObject({ status: "TIMED_OUT" });
    expect(adapterMock.getStatus).not.toHaveBeenCalled();
  });

  it("polls a due execution and finishes it on a terminal conclusion", async () => {
    adapterMock.getStatus.mockResolvedValueOnce({
      state: "completed",
      conclusion: "success",
      url: "https://github.com/acme/web/actions/runs/1",
      raw: "completed/success",
    });
    const db = fakeDb([
      execution({
        status: "RUNNING",
        dispatchedAt: new Date("2026-09-10T09:50:00Z"),
        lastPolledAt: new Date("2026-09-10T09:58:00Z"),
        externalRunId: "1",
      }),
    ]);
    const summary = await pollActiveExecutions(db as never, { now });
    expect(summary).toEqual({
      polled: 1,
      finished: 1,
      timedOut: 0,
      stalled: 0,
    });
    expect(db.updates.at(-1)?.data).toMatchObject({
      status: "SUCCEEDED",
      externalStatus: "completed/success",
    });
  });

  it("moves DISPATCHED → RUNNING and bumps the poll counter", async () => {
    adapterMock.getStatus.mockResolvedValueOnce({
      state: "in_progress",
      raw: "in_progress",
    });
    const db = fakeDb([
      execution({
        status: "DISPATCHED",
        dispatchedAt: new Date("2026-09-10T09:58:00Z"),
        externalRunId: "1",
      }),
    ]);
    await pollActiveExecutions(db as never, { now });
    expect(db.updates.at(-1)?.data).toMatchObject({
      status: "RUNNING",
      pollCount: { increment: 1 },
      lastPolledAt: now(),
    });
  });

  it("respects the backoff and skips executions that are not due", async () => {
    const db = fakeDb([
      execution({
        status: "RUNNING",
        dispatchedAt: new Date("2026-09-10T09:59:00Z"),
        lastPolledAt: new Date("2026-09-10T09:59:50Z"),
        externalRunId: "1",
      }),
    ]);
    const summary = await pollActiveExecutions(db as never, { now });
    expect(summary.polled).toBe(0);
    expect(db.updates).toHaveLength(0);
  });

  it("keeps the status on a transient provider error", async () => {
    adapterMock.getStatus.mockRejectedValueOnce(new Error("HTTP 503"));
    const db = fakeDb([
      execution({
        status: "RUNNING",
        dispatchedAt: new Date("2026-09-10T09:00:00Z"),
        externalRunId: "1",
      }),
    ]);
    await pollActiveExecutions(db as never, { now });
    expect(db.updates.at(-1)?.data).toMatchObject({
      externalStatus: expect.stringMatching(/poll error: HTTP 503/),
    });
    expect(db.updates.at(-1)?.data.status).toBeUndefined();
  });

  it("only stamps the poll for providers that cannot be asked", async () => {
    adapterMock.supportsStatusPolling = false;
    const db = fakeDb([
      execution({
        status: "DISPATCHED",
        dispatchedAt: new Date("2026-09-10T09:00:00Z"),
        target: target({ provider: "GENERIC_WEBHOOK", codeRepository: null }),
      }),
    ]);
    const summary = await pollActiveExecutions(db as never, { now });
    expect(summary.polled).toBe(0);
    expect(adapterMock.getStatus).not.toHaveBeenCalled();
    expect(db.updates.at(-1)?.data).toMatchObject({ lastPolledAt: now() });
  });
});

describe("finalizeExecution", () => {
  it("completes an ad-hoc run once its execution finished with results", async () => {
    const db = fakeDb([
      execution({
        status: "RUNNING",
        adHoc: true,
        resultsReceivedAt: new Date("2026-09-10T09:59:00Z"),
      }),
    ]);
    await finalizeExecution(db as never, 7, "FAILED");
    expect(db.testRuns.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { isCompleted: true, completedAt: expect.any(Date) },
    });
  });

  it("leaves a run open when the execution never delivered results, was cancelled, or is not ad-hoc", async () => {
    const noResults = fakeDb([
      execution({ status: "DISPATCHED", adHoc: true }),
    ]);
    await finalizeExecution(noResults as never, 7, "TIMED_OUT");
    expect(noResults.testRuns.update).not.toHaveBeenCalled();

    const cancelled = fakeDb([
      execution({
        status: "RUNNING",
        adHoc: true,
        resultsReceivedAt: new Date(),
      }),
    ]);
    await finalizeExecution(cancelled as never, 7, "CANCELLED");
    expect(cancelled.testRuns.update).not.toHaveBeenCalled();

    const ordinary = fakeDb([
      execution({ status: "RUNNING", resultsReceivedAt: new Date() }),
    ]);
    await finalizeExecution(ordinary as never, 7, "SUCCEEDED");
    expect(ordinary.testRuns.update).not.toHaveBeenCalled();

    const alreadyDone = fakeDb(
      [
        execution({
          status: "RUNNING",
          adHoc: true,
          resultsReceivedAt: new Date(),
        }),
      ],
      { isCompleted: true, isDeleted: false }
    );
    await finalizeExecution(alreadyDone as never, 7, "SUCCEEDED");
    expect(alreadyDone.testRuns.update).not.toHaveBeenCalled();
  });

  it("writes the terminal state, emits the completed event and audits with the actor", async () => {
    const db = fakeDb([execution({ status: "RUNNING" })]);
    await finalizeExecution(db as never, 7, "CANCELLED", {
      actorUserId: "u1",
      tenantId: "acme",
    });
    expect(db.updates[0].data).toMatchObject({
      status: "CANCELLED",
      completedAt: expect.any(Date),
    });
    expect(webhookEvents.emit).toHaveBeenCalledTimes(1);
    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "EXECUTION_COMPLETED", userId: "u1" })
    );
  });
});
