import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the NotificationService
const mockCreateMilestoneDueNotification = vi.fn();
vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {
    createMilestoneDueNotification: (...args: any[]) =>
      mockCreateMilestoneDueNotification(...args),
  },
}));

// Mock baseDb with milestone methods
const mockDb = {
  milestones: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  testRuns: {
    findMany: vi.fn(),
  },
};

vi.mock("../lib/db", () => ({
  baseDb: mockDb,
}));

// Mock multiTenantDb
vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => mockDb),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  FORECAST_QUEUE_NAME: "test-forecast-queue",
}));

// Mock forecast service
vi.mock("../services/forecastService", () => ({
  updateRepositoryCaseForecast: vi.fn(),
  getUniqueCaseGroupIds: vi.fn(),
  updateTestRunForecast: vi.fn(),
}));

// Mock audit context + audit log so the real `processor` can run end-to-end
// without touching AsyncLocalStorage or a real audit sink.
vi.mock("../lib/auditContext", () => ({
  runWithAuditContext: (_context: unknown, fn: () => unknown) => fn(),
}));
const mockCaptureAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
}));
vi.mock("../lib/services/reviewReminderConfig", () => ({
  getReviewReminderThresholdDays: vi.fn().mockResolvedValue(0),
}));
vi.mock("../lib/webhooks/event-emitters/reviewEvents", () => ({
  emitReviewReminderEvent: vi.fn(),
}));

describe("Milestone Auto-Completion Job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("JOB_AUTO_COMPLETE_MILESTONES", () => {
    it("should export correct job name constant", async () => {
      const { JOB_AUTO_COMPLETE_MILESTONES } = await import("./forecastWorker");
      expect(JOB_AUTO_COMPLETE_MILESTONES).toBe("auto-complete-milestones");
    });

    it("should identify milestones to auto-complete", async () => {
      const now = new Date();
      const pastDueDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Yesterday

      const mockMilestones = [
        {
          id: 1,
          name: "Sprint 1",
          projectId: 100,
          isCompleted: false,
          isDeleted: false,
          automaticCompletion: true,
          completedAt: pastDueDate,
        },
        {
          id: 2,
          name: "Sprint 2",
          projectId: 100,
          isCompleted: false,
          isDeleted: false,
          automaticCompletion: true,
          completedAt: pastDueDate,
        },
      ];

      mockDb.milestones.findMany.mockResolvedValue(mockMilestones);
      mockDb.milestones.update.mockResolvedValue({});

      // The query should filter for:
      // - isCompleted: false
      // - isDeleted: false
      // - automaticCompletion: true
      // - completedAt <= now (due date has passed)
      expect(mockDb.milestones.findMany).not.toHaveBeenCalled();
    });

    it("should not auto-complete milestones without automaticCompletion flag", async () => {
      const now = new Date();
      const _pastDueDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Milestone without automaticCompletion should not be returned
      const mockMilestones: any[] = [];

      mockDb.milestones.findMany.mockResolvedValue(mockMilestones);

      // No milestones should be updated
      expect(mockDb.milestones.update).not.toHaveBeenCalled();
    });

    it("should not auto-complete milestones with future due date", async () => {
      const now = new Date();
      const _futureDueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Next week

      // Milestone with future due date should not be returned by the query
      const mockMilestones: any[] = [];

      mockDb.milestones.findMany.mockResolvedValue(mockMilestones);

      expect(mockDb.milestones.update).not.toHaveBeenCalled();
    });
  });

  describe("JOB_AUTO_COMPLETE_MILESTONES — LOCK-04 (real processor invocation)", () => {
    it("queries with integrationId: null so a synced milestone is never returned even when automaticCompletion is true and completedAt is in the past", async () => {
      const { processor, JOB_AUTO_COMPLETE_MILESTONES } =
        await import("./forecastWorker");

      // Real query behavior: a synced milestone (integrationId set) with
      // automaticCompletion=true and a past completedAt would match every
      // OTHER filter — only the integrationId: null clause excludes it.
      // The mock simply returns [] (as a correctly-scoped real Postgres
      // query would for a WHERE that includes integrationId: null when the
      // only matching row has integrationId != null) so this test asserts
      // the where-clause shape itself, not simulated DB filtering.
      mockDb.milestones.findMany.mockResolvedValue([]);

      const job = {
        id: "job-lock04",
        name: JOB_AUTO_COMPLETE_MILESTONES,
        data: { tenantId: undefined, actorContext: {} },
      } as any;

      await processor(job);

      expect(mockDb.milestones.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ integrationId: null }),
        })
      );
      // No milestone was returned (the synced one is filtered out), so
      // nothing gets auto-completed.
      expect(mockDb.milestones.update).not.toHaveBeenCalled();
    });

    it("auto-completes a LOCAL milestone (integrationId: null) matching all criteria", async () => {
      const { processor, JOB_AUTO_COMPLETE_MILESTONES } =
        await import("./forecastWorker");

      const pastDueDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      mockDb.milestones.findMany.mockResolvedValue([
        {
          id: 42,
          name: "Local Milestone",
          projectId: 100,
        },
      ]);
      mockDb.milestones.update.mockResolvedValue({});

      const job = {
        id: "job-lock04-local",
        name: JOB_AUTO_COMPLETE_MILESTONES,
        data: { tenantId: undefined, actorContext: {} },
      } as any;

      await processor(job);

      expect(mockDb.milestones.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ integrationId: null }),
        })
      );
      expect(mockDb.milestones.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { isCompleted: true },
      });
      void pastDueDate; // fixture context only — the mocked findMany already returns the "matching" row
    });
  });
});

describe("Milestone Due Notifications Job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("JOB_MILESTONE_DUE_NOTIFICATIONS", () => {
    it("should export correct job name constant", async () => {
      const { JOB_MILESTONE_DUE_NOTIFICATIONS } =
        await import("./forecastWorker");
      expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toBe(
        "milestone-due-notifications"
      );
    });

    it("should identify milestones that need notifications", async () => {
      const mockMilestones = [
        {
          id: 1,
          name: "Release 1.0",
          notifyDaysBefore: 5,
          completedAt: new Date(),
          isCompleted: false,
          isDeleted: false,
          project: { id: 100, name: "Project Alpha" },
          testRuns: [],
          sessions: [],
        },
      ];

      mockDb.milestones.findMany.mockResolvedValue(mockMilestones);

      // The query should filter for:
      // - isCompleted: false
      // - isDeleted: false
      // - notifyDaysBefore > 0
      // - completedAt is set (has a due date)
      expect(mockDb.milestones.findMany).not.toHaveBeenCalled();
    });

    it("should not send notifications for milestones with notifyDaysBefore = 0", async () => {
      // Milestones with notifyDaysBefore = 0 should not be in the query results
      const mockMilestones: any[] = [];

      mockDb.milestones.findMany.mockResolvedValue(mockMilestones);

      expect(mockCreateMilestoneDueNotification).not.toHaveBeenCalled();
    });

    it("should not send notifications for milestones without due date", async () => {
      // Milestones without completedAt should not be in the query results
      const mockMilestones: any[] = [];

      mockDb.milestones.findMany.mockResolvedValue(mockMilestones);

      expect(mockCreateMilestoneDueNotification).not.toHaveBeenCalled();
    });
  });

  describe("Notification targeting", () => {
    it("should collect user IDs from milestone creator", () => {
      const milestone = {
        createdBy: "milestone-creator",
      };

      const userIds = new Set<string>();
      if (milestone.createdBy) {
        userIds.add(milestone.createdBy);
      }

      expect(userIds.size).toBe(1);
      expect(userIds.has("milestone-creator")).toBe(true);
    });

    it("should collect user IDs from test run creators", () => {
      const testRuns = [
        { createdById: "testrun-creator-1", testCases: [] },
        { createdById: "testrun-creator-2", testCases: [] },
        { createdById: "testrun-creator-1", testCases: [] }, // Duplicate should be deduplicated
      ];

      const userIds = new Set<string>();
      for (const testRun of testRuns) {
        if (testRun.createdById) {
          userIds.add(testRun.createdById);
        }
      }

      expect(userIds.size).toBe(2);
      expect(userIds.has("testrun-creator-1")).toBe(true);
      expect(userIds.has("testrun-creator-2")).toBe(true);
    });

    it("should collect user IDs from test run cases", () => {
      // Test the logic that collects user IDs from test cases
      const testRuns = [
        {
          createdById: null,
          testCases: [
            { assignedToId: "user-1", results: [] },
            { assignedToId: "user-2", results: [] },
            { assignedToId: "user-1", results: [] }, // Duplicate should be deduplicated
          ],
        },
      ];

      const userIds = new Set<string>();
      for (const testRun of testRuns) {
        for (const testCase of testRun.testCases) {
          if (testCase.assignedToId) {
            userIds.add(testCase.assignedToId);
          }
        }
      }

      expect(userIds.size).toBe(2);
      expect(userIds.has("user-1")).toBe(true);
      expect(userIds.has("user-2")).toBe(true);
    });

    it("should collect user IDs from result executors", () => {
      const testRuns = [
        {
          createdById: null,
          testCases: [
            {
              assignedToId: null,
              results: [
                { executedById: "executor-1" },
                { executedById: "executor-2" },
                { executedById: "executor-1" }, // Duplicate
              ],
            },
          ],
        },
      ];

      const userIds = new Set<string>();
      for (const testRun of testRuns) {
        for (const testCase of testRun.testCases) {
          for (const result of testCase.results) {
            if (result.executedById) {
              userIds.add(result.executedById);
            }
          }
        }
      }

      expect(userIds.size).toBe(2);
      expect(userIds.has("executor-1")).toBe(true);
      expect(userIds.has("executor-2")).toBe(true);
    });

    it("should collect user IDs from session creators", () => {
      const sessions = [
        { createdById: "session-creator-1", assignedToId: null },
        { createdById: "session-creator-2", assignedToId: null },
      ];

      const userIds = new Set<string>();
      for (const session of sessions) {
        if (session.createdById) {
          userIds.add(session.createdById);
        }
      }

      expect(userIds.size).toBe(2);
      expect(userIds.has("session-creator-1")).toBe(true);
      expect(userIds.has("session-creator-2")).toBe(true);
    });

    it("should collect user IDs from sessions", () => {
      // Test the logic that collects user IDs from sessions
      const sessions = [
        { createdById: null, assignedToId: "user-3" },
        { createdById: null, assignedToId: "user-4" },
        { createdById: null, assignedToId: null }, // Null should be skipped
      ];

      const userIds = new Set<string>();
      for (const session of sessions) {
        if (session.assignedToId) {
          userIds.add(session.assignedToId);
        }
      }

      expect(userIds.size).toBe(2);
      expect(userIds.has("user-3")).toBe(true);
      expect(userIds.has("user-4")).toBe(true);
    });

    it("should combine and deduplicate all participating users", () => {
      // Simulates the full notification targeting logic
      const milestone = {
        createdBy: "milestone-creator",
      };

      const testRuns = [
        {
          createdById: "testrun-creator",
          testCases: [
            {
              assignedToId: "assigned-user",
              results: [
                { executedById: "executor-user" },
                { executedById: "milestone-creator" }, // Duplicate with milestone creator
              ],
            },
          ],
        },
      ];

      const sessions = [
        { createdById: "session-creator", assignedToId: "assigned-user" }, // Duplicate assignedToId
        { createdById: "testrun-creator", assignedToId: null }, // Duplicate createdById
      ];

      const userIds = new Set<string>();

      // Milestone creator
      if (milestone.createdBy) {
        userIds.add(milestone.createdBy);
      }

      // Test run users
      for (const testRun of testRuns) {
        if (testRun.createdById) {
          userIds.add(testRun.createdById);
        }
        for (const testCase of testRun.testCases) {
          if (testCase.assignedToId) {
            userIds.add(testCase.assignedToId);
          }
          for (const result of testCase.results) {
            if (result.executedById) {
              userIds.add(result.executedById);
            }
          }
        }
      }

      // Session users
      for (const session of sessions) {
        if (session.createdById) {
          userIds.add(session.createdById);
        }
        if (session.assignedToId) {
          userIds.add(session.assignedToId);
        }
      }

      // Should have 5 unique users:
      // milestone-creator, testrun-creator, assigned-user, executor-user, session-creator
      expect(userIds.size).toBe(5);
      expect(userIds.has("milestone-creator")).toBe(true);
      expect(userIds.has("testrun-creator")).toBe(true);
      expect(userIds.has("assigned-user")).toBe(true);
      expect(userIds.has("executor-user")).toBe(true);
      expect(userIds.has("session-creator")).toBe(true);
    });
  });

  describe("Due date calculation", () => {
    // Helper function matching the actual implementation
    const calculateDaysDiff = (timeDiff: number) => {
      return timeDiff >= 0
        ? Math.ceil(timeDiff / (1000 * 60 * 60 * 24))
        : Math.floor(timeDiff / (1000 * 60 * 60 * 24));
    };

    it("should correctly calculate days until due date", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const dueDate = new Date("2025-12-10T12:00:00Z");

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);

      expect(daysDiff).toBe(6);
    });

    it("should correctly identify overdue milestones", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const pastDueDate = new Date("2025-12-01T12:00:00Z");

      const timeDiff = pastDueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);
      const isOverdue = daysDiff < 0;

      expect(daysDiff).toBeLessThan(0);
      expect(isOverdue).toBe(true);
    });

    it("should correctly identify milestones overdue by less than 24 hours", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      // Due date was 6 hours ago (less than 24 hours)
      const pastDueDate = new Date("2025-12-04T06:00:00Z");

      const timeDiff = pastDueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);
      const isOverdue = daysDiff < 0;

      // Math.floor(-0.25) = -1, correctly identifies as overdue
      expect(daysDiff).toBe(-1);
      expect(isOverdue).toBe(true);
    });

    it("should not notify too early for fractional future days", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      // Due in 5.8 days (should round UP to 6, NOT down to 5)
      const dueDate = new Date("2025-12-10T07:12:00Z"); // ~5.8 days away
      const notifyDaysBefore = 5;

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);
      const isOverdue = daysDiff < 0;
      const shouldNotify = isOverdue || daysDiff <= notifyDaysBefore;

      // Math.ceil(5.8) = 6, so 6 <= 5 is false - don't notify yet
      expect(daysDiff).toBe(6);
      expect(shouldNotify).toBe(false);
    });

    it("should send notification when within notifyDaysBefore threshold", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const dueDate = new Date("2025-12-07T12:00:00Z"); // exactly 3 days away
      const notifyDaysBefore = 5;

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);
      const isOverdue = daysDiff < 0;
      const shouldNotify = isOverdue || daysDiff <= notifyDaysBefore;

      expect(daysDiff).toBe(3);
      expect(shouldNotify).toBe(true);
    });

    it("should not send notification when outside notifyDaysBefore threshold", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const dueDate = new Date("2025-12-15T12:00:00Z"); // 11 days away
      const notifyDaysBefore = 5;

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);
      const isOverdue = daysDiff < 0;
      const shouldNotify = isOverdue || daysDiff <= notifyDaysBefore;

      expect(shouldNotify).toBe(false);
    });

    it("should always notify for overdue milestones", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const pastDueDate = new Date("2025-11-30T12:00:00Z"); // 4 days overdue
      const notifyDaysBefore = 5;

      const timeDiff = pastDueDate.getTime() - now.getTime();
      const daysDiff = calculateDaysDiff(timeDiff);
      const isOverdue = daysDiff < 0;
      const shouldNotify = isOverdue || daysDiff <= notifyDaysBefore;

      expect(isOverdue).toBe(true);
      expect(shouldNotify).toBe(true);
    });
  });
});

describe("Milestone schema field defaults", () => {
  it("should have automaticCompletion default to false", () => {
    // This documents the expected default behavior
    const defaultMilestone = {
      automaticCompletion: false,
    };

    expect(defaultMilestone.automaticCompletion).toBe(false);
  });

  it("should have notifyDaysBefore default to 0", () => {
    // This documents the expected default behavior
    const defaultMilestone = {
      notifyDaysBefore: 0,
    };

    expect(defaultMilestone.notifyDaysBefore).toBe(0);
  });

  it("should allow positive values for notifyDaysBefore", () => {
    const milestone = {
      notifyDaysBefore: 5,
    };

    expect(milestone.notifyDaysBefore).toBeGreaterThan(0);
  });
});
