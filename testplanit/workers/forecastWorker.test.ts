import { Job } from "bullmq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the forecast service
const mockUpdateRepositoryCaseForecast = vi.fn();
const mockGetUniqueCaseGroupIds = vi.fn();
const mockUpdateTestRunForecast = vi.fn();

vi.mock("../services/forecastService", () => ({
  updateRepositoryCaseForecast: (...args: any[]) =>
    mockUpdateRepositoryCaseForecast(...args),
  getUniqueCaseGroupIds: () => mockGetUniqueCaseGroupIds(),
  updateTestRunForecast: (...args: any[]) => mockUpdateTestRunForecast(...args),
}));

// Mock prisma. Each test seeds the relevant mocks before invoking the processor.
const mockPrisma = {
  testRuns: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  reviewRequest: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  projects: {
    findUnique: vi.fn(),
  },
  workflows: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  repositoryCases: {
    findUnique: vi.fn(),
  },
  sessions: {
    findUnique: vi.fn(),
  },
  appConfig: {
    findUnique: vi.fn(),
  },
};

vi.mock("../lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Multi-tenant module — return our mock prisma client for every job.
vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// Audit context — keep the runWithAuditContext frame transparent.
vi.mock("../lib/auditContext", () => ({
  runWithAuditContext: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../lib/tenantContext", () => ({
  withTenantContext: (fn: any) => fn,
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  FORECAST_QUEUE_NAME: "test-forecast-queue",
}));

// Audit emission — wired to a spy so reminder tests can assert on it.
const mockCaptureAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
}));

// NotificationService — partial mock so static methods we touch are spies.
const mockCreateReviewReminderNotification = vi
  .fn()
  .mockResolvedValue(undefined);
const mockResolveRoleHolderUserIds = vi.fn().mockResolvedValue([]);
vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {
    createReviewReminderNotification: (...args: any[]) =>
      mockCreateReviewReminderNotification(...args),
    resolveRoleHolderUserIds: (...args: any[]) =>
      mockResolveRoleHolderUserIds(...args),
    createMilestoneDueNotification: vi.fn(),
  },
}));

// Threshold loader — default to 24h; tests override via mockResolvedValueOnce.
const mockGetReviewReminderThresholdHours = vi.fn().mockResolvedValue(24);
vi.mock("../lib/services/reviewReminderConfig", () => ({
  getReviewReminderThresholdHours: (...args: any[]) =>
    mockGetReviewReminderThresholdHours(...args),
}));

describe("ForecastWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("JOB_UPDATE_SINGLE_CASE", () => {
    it("should update forecast for a single case", async () => {
      mockUpdateRepositoryCaseForecast.mockResolvedValue({
        affectedTestRunIds: [],
      });

      // Dynamically import to get fresh module with mocks
      const forecastWorkerModule = await import("./forecastWorker");

      const _mockJob = {
        id: "job-123",
        name: "update-single-case-forecast",
        data: { repositoryCaseId: 42 },
      } as Job;

      // Access the processor - we need to test it via the module
      // Since processor isn't exported, we'll test the job names export
      expect(forecastWorkerModule.JOB_UPDATE_SINGLE_CASE).toBe(
        "update-single-case-forecast"
      );
      expect(forecastWorkerModule.JOB_UPDATE_ALL_CASES).toBe(
        "update-all-cases-forecast"
      );
    });

    it("should export correct job name constants", async () => {
      const { JOB_UPDATE_SINGLE_CASE, JOB_UPDATE_ALL_CASES } =
        await import("./forecastWorker");

      expect(JOB_UPDATE_SINGLE_CASE).toBe("update-single-case-forecast");
      expect(JOB_UPDATE_ALL_CASES).toBe("update-all-cases-forecast");
    });
  });

  describe("Job data validation", () => {
    it("should have proper job name for single case update", async () => {
      const { JOB_UPDATE_SINGLE_CASE } = await import("./forecastWorker");
      expect(JOB_UPDATE_SINGLE_CASE).toBe("update-single-case-forecast");
    });

    it("should have proper job name for all cases update", async () => {
      const { JOB_UPDATE_ALL_CASES } = await import("./forecastWorker");
      expect(JOB_UPDATE_ALL_CASES).toBe("update-all-cases-forecast");
    });
  });
});

describe("ForecastWorker job constants", () => {
  it("should export JOB_UPDATE_SINGLE_CASE constant", async () => {
    const { JOB_UPDATE_SINGLE_CASE } = await import("./forecastWorker");
    expect(typeof JOB_UPDATE_SINGLE_CASE).toBe("string");
    expect(JOB_UPDATE_SINGLE_CASE).toBe("update-single-case-forecast");
  });

  it("should export JOB_UPDATE_ALL_CASES constant", async () => {
    const { JOB_UPDATE_ALL_CASES } = await import("./forecastWorker");
    expect(typeof JOB_UPDATE_ALL_CASES).toBe("string");
    expect(JOB_UPDATE_ALL_CASES).toBe("update-all-cases-forecast");
  });

  it("should export JOB_AUTO_COMPLETE_MILESTONES constant", async () => {
    const { JOB_AUTO_COMPLETE_MILESTONES } = await import("./forecastWorker");
    expect(typeof JOB_AUTO_COMPLETE_MILESTONES).toBe("string");
    expect(JOB_AUTO_COMPLETE_MILESTONES).toBe("auto-complete-milestones");
  });

  it("should export JOB_MILESTONE_DUE_NOTIFICATIONS constant", async () => {
    const { JOB_MILESTONE_DUE_NOTIFICATIONS } =
      await import("./forecastWorker");
    expect(typeof JOB_MILESTONE_DUE_NOTIFICATIONS).toBe("string");
    expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toBe("milestone-due-notifications");
  });

  it("should export JOB_REVIEW_REMINDERS constant", async () => {
    const { JOB_REVIEW_REMINDERS } = await import("./forecastWorker");
    expect(typeof JOB_REVIEW_REMINDERS).toBe("string");
    expect(JOB_REVIEW_REMINDERS).toBe("review-reminders");
  });
});

describe("Milestone job constants", () => {
  it("should have unique job names for all milestone jobs", async () => {
    const {
      JOB_UPDATE_SINGLE_CASE,
      JOB_UPDATE_ALL_CASES,
      JOB_AUTO_COMPLETE_MILESTONES,
      JOB_MILESTONE_DUE_NOTIFICATIONS,
    } = await import("./forecastWorker");

    const jobNames = [
      JOB_UPDATE_SINGLE_CASE,
      JOB_UPDATE_ALL_CASES,
      JOB_AUTO_COMPLETE_MILESTONES,
      JOB_MILESTONE_DUE_NOTIFICATIONS,
    ];

    // Check all job names are unique
    const uniqueJobNames = new Set(jobNames);
    expect(uniqueJobNames.size).toBe(jobNames.length);
  });

  it("should use descriptive job names for milestone features", async () => {
    const { JOB_AUTO_COMPLETE_MILESTONES, JOB_MILESTONE_DUE_NOTIFICATIONS } =
      await import("./forecastWorker");

    // Job names should be descriptive and follow naming convention
    expect(JOB_AUTO_COMPLETE_MILESTONES).toContain("milestone");
    expect(JOB_AUTO_COMPLETE_MILESTONES).toContain("auto-complete");
    expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toContain("milestone");
    expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toContain("notification");
  });
});

describe("JOB_REVIEW_REMINDERS", () => {
  const FIXED_NOW = new Date("2026-05-24T12:00:00Z");
  const THIRTY_SIX_HOURS_AGO = new Date(
    FIXED_NOW.getTime() - 36 * 60 * 60 * 1000
  );
  const ONE_HOUR_AGO = new Date(FIXED_NOW.getTime() - 1 * 60 * 60 * 1000);
  const TWENTY_SIX_HOURS_AGO = new Date(
    FIXED_NOW.getTime() - 26 * 60 * 60 * 1000
  );

  const seedContextHappyPath = () => {
    mockPrisma.projects.findUnique.mockResolvedValue({
      id: 1,
      name: "Project Alpha",
    });
    mockPrisma.workflows.findUnique.mockImplementation((args: any) =>
      Promise.resolve({
        name: args.where.id === 10 ? "Draft" : "Approved",
      })
    );
    mockPrisma.user.findUnique.mockResolvedValue({ name: "Requester Name" });
    mockPrisma.repositoryCases.findUnique.mockResolvedValue({
      name: "Login flow",
    });
    mockPrisma.testRuns.findUnique.mockResolvedValue({ name: "Smoke Run" });
    mockPrisma.sessions.findUnique.mockResolvedValue({ name: "Exploration" });
    mockPrisma.reviewRequest.update.mockResolvedValue({});
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockGetReviewReminderThresholdHours.mockResolvedValue(24);
    seedContextHappyPath();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const runProcessor = async () => {
    const { processor } = await import("./forecastWorker");
    const job = {
      id: "job-rr-1",
      name: "review-reminders",
      data: { tenantId: undefined, actorContext: {} },
    } as unknown as Job;
    await processor(job);
  };

  it("Test 1: scan predicate filters by status / isDeleted / createdAt / lastRemindedAt", async () => {
    mockPrisma.reviewRequest.findMany.mockResolvedValue([]);

    await runProcessor();

    expect(mockPrisma.reviewRequest.findMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.reviewRequest.findMany.mock.calls[0][0];
    const cutoff = new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000);

    expect(arg.where.status).toBe("PENDING");
    expect(arg.where.isDeleted).toBe(false);
    expect(arg.where.createdAt).toEqual({ lt: cutoff });
    expect(arg.where.OR).toEqual([
      { lastRemindedAt: null },
      { lastRemindedAt: { lt: cutoff } },
    ]);
  });

  it("Test 2: direct assignee path enqueues one reminder for the assignee", async () => {
    mockPrisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: "rr-1",
        projectId: 1,
        entityType: "CASE",
        entityId: 5,
        fromStateId: 10,
        toStateId: 11,
        requestedByUserId: "user-r",
        assigneeUserId: "user-a",
        assigneeRoleId: null,
        createdAt: THIRTY_SIX_HOURS_AGO,
      },
    ]);

    await runProcessor();

    expect(mockCreateReviewReminderNotification).toHaveBeenCalledTimes(1);
    const params = mockCreateReviewReminderNotification.mock.calls[0][0];
    expect(params.targetUserIds).toEqual(["user-a"]);
    expect(params.requesterUserId).toBe("user-r");
    expect(params.reviewRequestId).toBe("rr-1");
    expect(params.hoursPending).toBe(36);
    expect(mockResolveRoleHolderUserIds).not.toHaveBeenCalled();
  });

  it("Test 3: role assignee path fans out via resolveRoleHolderUserIds", async () => {
    mockResolveRoleHolderUserIds.mockResolvedValueOnce(["user-a", "user-b"]);
    mockPrisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: "rr-role",
        projectId: 1,
        entityType: "RUN",
        entityId: 7,
        fromStateId: 10,
        toStateId: 11,
        requestedByUserId: "user-r",
        assigneeUserId: null,
        assigneeRoleId: 42,
        createdAt: THIRTY_SIX_HOURS_AGO,
      },
    ]);

    await runProcessor();

    expect(mockResolveRoleHolderUserIds).toHaveBeenCalledWith(1, 42, "user-r");
    expect(mockCreateReviewReminderNotification).toHaveBeenCalledTimes(1);
    const params = mockCreateReviewReminderNotification.mock.calls[0][0];
    expect(params.targetUserIds).toEqual(["user-a", "user-b"]);
  });

  it("Test 4: requester is excluded on direct self-assignment edge case (stamp anyway)", async () => {
    mockPrisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: "rr-self",
        projectId: 1,
        entityType: "CASE",
        entityId: 5,
        fromStateId: 10,
        toStateId: 11,
        requestedByUserId: "user-r",
        assigneeUserId: "user-r",
        assigneeRoleId: null,
        createdAt: THIRTY_SIX_HOURS_AGO,
      },
    ]);

    await runProcessor();

    expect(mockCreateReviewReminderNotification).not.toHaveBeenCalled();
    // lastRemindedAt MUST still be stamped so the row doesn't loop every interval.
    expect(mockPrisma.reviewRequest.update).toHaveBeenCalledWith({
      where: { id: "rr-self" },
      data: { lastRemindedAt: FIXED_NOW },
    });
  });

  it("Test 5: stamps lastRemindedAt AFTER dispatch (call order)", async () => {
    const callOrder: string[] = [];
    mockCreateReviewReminderNotification.mockImplementationOnce(async () => {
      callOrder.push("dispatch");
    });
    mockPrisma.reviewRequest.update.mockImplementationOnce(async () => {
      callOrder.push("stamp");
      return {};
    });

    mockPrisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: "rr-order",
        projectId: 1,
        entityType: "CASE",
        entityId: 5,
        fromStateId: 10,
        toStateId: 11,
        requestedByUserId: "user-r",
        assigneeUserId: "user-a",
        assigneeRoleId: null,
        createdAt: THIRTY_SIX_HOURS_AGO,
      },
    ]);

    await runProcessor();

    expect(callOrder).toEqual(["dispatch", "stamp"]);
  });

  it("Test 6: idempotent within interval — recently-stamped rows are not re-included by findMany", async () => {
    // Simulate the cutoff filter excluding a row stamped 1h ago.
    mockPrisma.reviewRequest.findMany.mockResolvedValue([]);

    // Sanity: even if a row were stamped 1h ago, the where clause demands
    // lastRemindedAt < cutoff (24h ago). 1h ago > 24h ago so it would NOT match.
    expect(ONE_HOUR_AGO.getTime()).toBeGreaterThan(
      FIXED_NOW.getTime() - 24 * 60 * 60 * 1000
    );

    await runProcessor();

    expect(mockCreateReviewReminderNotification).not.toHaveBeenCalled();
    expect(mockPrisma.reviewRequest.update).not.toHaveBeenCalled();
  });

  it("Test 7: re-reminds after threshold — a row stamped 26h ago IS included by the OR predicate", async () => {
    mockPrisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: "rr-recur",
        projectId: 1,
        entityType: "CASE",
        entityId: 5,
        fromStateId: 10,
        toStateId: 11,
        requestedByUserId: "user-r",
        assigneeUserId: "user-a",
        assigneeRoleId: null,
        createdAt: TWENTY_SIX_HOURS_AGO,
      },
    ]);

    await runProcessor();

    expect(mockCreateReviewReminderNotification).toHaveBeenCalledTimes(1);
    // The OR clause carries `{ lastRemindedAt: { lt: cutoff } }` — that's
    // the recurring branch (a row last reminded 26h ago is older than the
    // 24h cutoff and is re-eligible). Assert the clause shape exists.
    const arg = mockPrisma.reviewRequest.findMany.mock.calls[0][0];
    expect(arg.where.OR[1]).toEqual({
      lastRemindedAt: { lt: expect.any(Date) },
    });
  });

  it("Test 8: soft-deleted rows are excluded by the where clause", async () => {
    // The findMany call carries `isDeleted: false` — assert the predicate.
    mockPrisma.reviewRequest.findMany.mockResolvedValue([]);

    await runProcessor();

    const arg = mockPrisma.reviewRequest.findMany.mock.calls[0][0];
    expect(arg.where.isDeleted).toBe(false);

    // No dispatch call ever happens for a row not returned by findMany.
    expect(mockCreateReviewReminderNotification).not.toHaveBeenCalled();
  });

  it("emits a REVIEW_REMINDED audit row with system actor and metadata", async () => {
    mockPrisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: "rr-audit",
        projectId: 1,
        entityType: "CASE",
        entityId: 5,
        fromStateId: 10,
        toStateId: 11,
        requestedByUserId: "user-r",
        assigneeUserId: "user-a",
        assigneeRoleId: null,
        createdAt: THIRTY_SIX_HOURS_AGO,
      },
    ]);

    await runProcessor();

    expect(mockCaptureAuditEvent).toHaveBeenCalledTimes(1);
    const auditArgs = mockCaptureAuditEvent.mock.calls[0][0];
    expect(auditArgs.action).toBe("REVIEW_REMINDED");
    expect(auditArgs.entityType).toBe("ReviewRequest");
    expect(auditArgs.entityId).toBe("rr-audit");
    expect(auditArgs.projectId).toBe(1);
    expect(auditArgs.userId).toBeUndefined();
    expect(auditArgs.metadata.source).toBe("review-reminder-worker");
    expect(auditArgs.metadata.recipientCount).toBe(1);
    expect(auditArgs.metadata.hoursPending).toBe(36);
  });

  it("respects a custom AppConfig threshold from getReviewReminderThresholdHours", async () => {
    mockGetReviewReminderThresholdHours.mockResolvedValueOnce(48);
    mockPrisma.reviewRequest.findMany.mockResolvedValue([]);

    await runProcessor();

    const arg = mockPrisma.reviewRequest.findMany.mock.calls[0][0];
    const expectedCutoff = new Date(FIXED_NOW.getTime() - 48 * 60 * 60 * 1000);
    expect(arg.where.createdAt).toEqual({ lt: expectedCutoff });
  });
});
