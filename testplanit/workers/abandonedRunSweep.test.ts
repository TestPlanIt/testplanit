import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks mirror milestoneJobs.test.ts so the real `processor` runs end-to-end
// against an in-memory db double. The abandonedRuns service itself is NOT
// mocked — it only touches db.appConfig / db.workflows, so the sweep's
// config-resolution logic is exercised for real.
const mockDb = {
  appConfig: {
    findUnique: vi.fn(),
  },
  workflows: {
    findFirst: vi.fn(),
  },
  testRuns: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  jUnitTestResult: {
    aggregate: vi.fn(),
  },
  jUnitTestSuite: {
    aggregate: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
};

vi.mock("../lib/db", () => ({
  baseDb: mockDb,
}));

vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => mockDb),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

vi.mock("../lib/valkey", () => ({
  default: null,
}));

vi.mock("../lib/queueNames", () => ({
  FORECAST_QUEUE_NAME: "test-forecast-queue",
}));

vi.mock("../services/forecastService", () => ({
  updateRepositoryCaseForecast: vi.fn(),
  getUniqueCaseGroupIds: vi.fn(),
  updateTestRunForecast: vi.fn(),
}));

vi.mock("../lib/auditContext", () => ({
  runWithAuditContext: (_context: unknown, fn: () => unknown) => fn(),
}));

const mockCaptureAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
}));

vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {},
}));

vi.mock("../lib/services/reviewReminderConfig", () => ({
  getReviewReminderThresholdDays: vi.fn().mockResolvedValue(0),
}));

vi.mock("../lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewReminderEvent: vi.fn(),
}));

const mockEmitTestRunUpdateEvents = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunUpdateEvents: (...args: any[]) =>
    mockEmitTestRunUpdateEvents(...args),
}));

const mockSyncTestRunToElasticsearch = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/testRunSearch", () => ({
  syncTestRunToElasticsearch: (...args: any[]) =>
    mockSyncTestRunToElasticsearch(...args),
}));

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function makeJob() {
  return {
    id: "job-sweep",
    name: "sweep-abandoned-runs",
    data: { tenantId: undefined, actorContext: {} },
  } as any;
}

/** One candidate run row as the sweep's findMany returns it. */
function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 92163,
    name: "iPadOS Regression #40",
    projectId: 7,
    stateId: 70,
    createdAt: new Date(Date.now() - 3 * DAY_MS),
    project: { abandonedRunIdleMinutes: null, abandonedRunStateId: null },
    ...overrides,
  };
}

function setAppConfigMinutes(minutes: number | undefined) {
  mockDb.appConfig.findUnique.mockResolvedValue(
    minutes === undefined
      ? null
      : { key: "abandoned_run_idle_minutes", value: minutes }
  );
}

function setLastImportActivity(date: Date | null) {
  mockDb.jUnitTestResult.aggregate.mockResolvedValue({
    _max: { createdAt: date },
  });
  mockDb.jUnitTestSuite.aggregate.mockResolvedValue({
    _max: { createdAt: null },
  });
}

describe("JOB_SWEEP_ABANDONED_RUNS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(mockDb)
    );
    // In-tx re-check: the run is still open by default.
    mockDb.testRuns.findUnique.mockResolvedValue({
      isCompleted: false,
      stateId: 70,
    });
    mockDb.testRuns.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id,
      projectId: 7,
      name: "iPadOS Regression #40",
      stateId: data.stateId ?? 70,
      isCompleted: true,
    }));
  });

  it("exports the job name constant", async () => {
    const { JOB_SWEEP_ABANDONED_RUNS } = await import("./forecastWorker");
    expect(JOB_SWEEP_ABANDONED_RUNS).toBe("sweep-abandoned-runs");
  });

  it("only scans incomplete automated (non-REGULAR) runs", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(undefined);
    mockDb.testRuns.findMany.mockResolvedValue([]);

    await processor(makeJob());

    const where = mockDb.testRuns.findMany.mock.calls[0][0].where;
    expect(where.isCompleted).toBe(false);
    expect(where.isDeleted).toBe(false);
    expect(where.testRunType.in).toContain("JUNIT");
    expect(where.testRunType.in).not.toContain("REGULAR");
  });

  it("is a no-op by default (no AppConfig row, no project overrides)", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(undefined);
    mockDb.testRuns.findMany.mockResolvedValue([makeRun()]);

    await processor(makeJob());

    // Disabled projects are skipped before any per-run activity lookup.
    expect(mockDb.jUnitTestResult.aggregate).not.toHaveBeenCalled();
    expect(mockDb.testRuns.update).not.toHaveBeenCalled();
  });

  it("closes a run idle past the system threshold and moves it to the DONE fallback state", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([makeRun()]);
    setLastImportActivity(new Date(Date.now() - 2 * DAY_MS));
    mockDb.workflows.findFirst.mockResolvedValue({ id: 9 });

    await processor(makeJob());

    expect(mockDb.testRuns.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 92163 },
        data: expect.objectContaining({
          isCompleted: true,
          completedAt: expect.any(Date),
          stateId: 9,
        }),
      })
    );
    // Webhooks are emitted by hand (raw client — no sideEffectsPlugin),
    // as a system actor.
    expect(mockEmitTestRunUpdateEvents).toHaveBeenCalledWith(
      expect.objectContaining({ id: 92163, stateId: 70, isCompleted: false }),
      expect.objectContaining({ id: 92163, stateId: 9, isCompleted: true }),
      mockDb,
      { actorUserId: null }
    );
    expect(mockSyncTestRunToElasticsearch).toHaveBeenCalledWith(92163);
    expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "TestRuns",
        entityId: "92163",
        metadata: expect.objectContaining({
          source: "forecast-worker:abandoned-run-sweep",
        }),
      })
    );
  });

  it("never closes a run whose newest imported result is inside the threshold, even when the run row is old", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([makeRun()]);
    // Run created 3 days ago but still streaming: last result 10 minutes ago.
    setLastImportActivity(new Date(Date.now() - 10 * MINUTE_MS));

    await processor(makeJob());

    expect(mockDb.testRuns.update).not.toHaveBeenCalled();
    expect(mockEmitTestRunUpdateEvents).not.toHaveBeenCalled();
  });

  it("honors a project override of 0 (disabled) when the system threshold is on", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([
      makeRun({
        project: { abandonedRunIdleMinutes: 0, abandonedRunStateId: null },
      }),
    ]);

    await processor(makeJob());

    expect(mockDb.jUnitTestResult.aggregate).not.toHaveBeenCalled();
    expect(mockDb.testRuns.update).not.toHaveBeenCalled();
  });

  it("lets a project enable sweeping when the system default is off", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(undefined);
    mockDb.testRuns.findMany.mockResolvedValue([
      makeRun({
        project: { abandonedRunIdleMinutes: 720, abandonedRunStateId: null },
      }),
    ]);
    setLastImportActivity(new Date(Date.now() - DAY_MS));
    mockDb.workflows.findFirst.mockResolvedValue({ id: 9 });

    await processor(makeJob());

    expect(mockDb.testRuns.update).toHaveBeenCalledTimes(1);
  });

  it("uses the project's configured target state when it is still valid", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([
      makeRun({
        project: { abandonedRunIdleMinutes: null, abandonedRunStateId: 42 },
      }),
    ]);
    setLastImportActivity(new Date(Date.now() - 2 * DAY_MS));
    mockDb.workflows.findFirst.mockResolvedValueOnce({ id: 42 });

    await processor(makeJob());

    expect(mockDb.workflows.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.workflows.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 42,
      scope: "RUNS",
      projects: { some: { projectId: 7 } },
    });
    expect(mockDb.testRuns.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stateId: 42 }),
      })
    );
  });

  it("completes without a state change when the project has no eligible RUNS workflow", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([makeRun()]);
    setLastImportActivity(null); // died at startup: no suites, no results
    mockDb.workflows.findFirst.mockResolvedValue(null);

    await processor(makeJob());

    expect(mockDb.testRuns.update).toHaveBeenCalledTimes(1);
    const data = mockDb.testRuns.update.mock.calls[0][0].data;
    expect(data.isCompleted).toBe(true);
    expect(data).not.toHaveProperty("stateId");
  });

  it("resolves the target state once per project across many runs", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([
      makeRun({ id: 1 }),
      makeRun({ id: 2 }),
      makeRun({ id: 3 }),
    ]);
    setLastImportActivity(new Date(Date.now() - 2 * DAY_MS));
    mockDb.workflows.findFirst.mockResolvedValue({ id: 9 });

    await processor(makeJob());

    expect(mockDb.testRuns.update).toHaveBeenCalledTimes(3);
    expect(mockDb.workflows.findFirst).toHaveBeenCalledTimes(1);
  });

  it("skips a run that was completed between the scan and the write", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([makeRun()]);
    setLastImportActivity(new Date(Date.now() - 2 * DAY_MS));
    mockDb.workflows.findFirst.mockResolvedValue({ id: 9 });
    // A very late completeTestRun landed after the scan.
    mockDb.testRuns.findUnique.mockResolvedValue({
      isCompleted: true,
      stateId: 9,
    });

    const result = await processor(makeJob());

    expect(mockDb.testRuns.update).not.toHaveBeenCalled();
    expect(mockEmitTestRunUpdateEvents).not.toHaveBeenCalled();
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successCount: 0, failCount: 0 });
  });

  it("continues sweeping when one run's update fails", async () => {
    const { processor } = await import("./forecastWorker");
    setAppConfigMinutes(1440);
    mockDb.testRuns.findMany.mockResolvedValue([
      makeRun({ id: 1 }),
      makeRun({ id: 2 }),
    ]);
    setLastImportActivity(new Date(Date.now() - 2 * DAY_MS));
    mockDb.workflows.findFirst.mockResolvedValue({ id: 9 });
    mockDb.testRuns.update
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(async ({ where, data }: any) => ({
        id: where.id,
        projectId: 7,
        name: "run",
        stateId: data.stateId ?? 70,
        isCompleted: true,
      }));

    const result = await processor(makeJob());

    expect(mockDb.testRuns.update).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ successCount: 1, failCount: 1 });
  });
});
