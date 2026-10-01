import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks mirror abandonedRunSweep.test.ts so the real `processor` runs
// end-to-end against an in-memory db double; the sweep service itself is
// mocked since its batched raw SQL is covered by reportBuilderState.test.ts.
const mockDb = {
  $executeRaw: vi.fn(),
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

vi.mock("../lib/queueNames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/queueNames")>()),
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

vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../lib/webhooks/event-emitters/testRunEvents", () => ({
  emitTestRunUpdateEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/testRunSearch", () => ({
  syncTestRunToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));

const mockSweep = vi.fn();
vi.mock("../lib/services/reportBuilderState", () => ({
  sweepReportBuilderStates: (...args: any[]) => mockSweep(...args),
}));

function makeJob(tenantId?: string) {
  return {
    id: "job-sweep-states",
    name: "sweep-report-builder-states",
    data: { tenantId, actorContext: {} },
  } as any;
}

describe("JOB_SWEEP_REPORT_BUILDER_STATES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSweep.mockResolvedValue({
      deleted: 12,
      cutoff: new Date("2026-07-02T00:00:00Z"),
    });
  });

  it("exports the job name constant", async () => {
    const { JOB_SWEEP_REPORT_BUILDER_STATES } =
      await import("./forecastWorker");
    expect(JOB_SWEEP_REPORT_BUILDER_STATES).toBe("sweep-report-builder-states");
  });

  it("runs the sweep against the job's db client and reports the count", async () => {
    const { processor } = await import("./forecastWorker");
    const result = await processor(makeJob());

    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockSweep).toHaveBeenCalledWith(mockDb);
    expect(result).toEqual({
      status: "completed",
      successCount: 12,
      failCount: 0,
    });
  });

  it("propagates a sweep failure so BullMQ retries the job", async () => {
    const { processor } = await import("./forecastWorker");
    mockSweep.mockRejectedValue(new Error("db down"));
    await expect(processor(makeJob())).rejects.toThrow("db down");
  });
});
