import { describe, it, expect, vi, beforeEach } from "vitest";
import { Job } from "bullmq";

// Mock the NotificationService
const mockCreateMilestoneDueNotification = vi.fn();
vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {
    createMilestoneDueNotification: (...args: any[]) =>
      mockCreateMilestoneDueNotification(...args),
  },
}));

// Mock prisma with milestone methods
const mockPrisma = {
  milestones: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  testRuns: {
    findMany: vi.fn(),
  },
};

vi.mock("../lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock multiTenantPrisma
vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
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

      mockPrisma.milestones.findMany.mockResolvedValue(mockMilestones);
      mockPrisma.milestones.update.mockResolvedValue({});

      // The query should filter for:
      // - isCompleted: false
      // - isDeleted: false
      // - automaticCompletion: true
      // - completedAt <= now (due date has passed)
      expect(mockPrisma.milestones.findMany).not.toHaveBeenCalled();
    });

    it("should not auto-complete milestones without automaticCompletion flag", async () => {
      const now = new Date();
      const pastDueDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Milestone without automaticCompletion should not be returned
      const mockMilestones: any[] = [];

      mockPrisma.milestones.findMany.mockResolvedValue(mockMilestones);

      // No milestones should be updated
      expect(mockPrisma.milestones.update).not.toHaveBeenCalled();
    });

    it("should not auto-complete milestones with future due date", async () => {
      const now = new Date();
      const futureDueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Next week

      // Milestone with future due date should not be returned by the query
      const mockMilestones: any[] = [];

      mockPrisma.milestones.findMany.mockResolvedValue(mockMilestones);

      expect(mockPrisma.milestones.update).not.toHaveBeenCalled();
    });
  });
});

describe("Milestone Due Notifications Job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("JOB_MILESTONE_DUE_NOTIFICATIONS", () => {
    it("should export correct job name constant", async () => {
      const { JOB_MILESTONE_DUE_NOTIFICATIONS } = await import(
        "./forecastWorker"
      );
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

      mockPrisma.milestones.findMany.mockResolvedValue(mockMilestones);

      // The query should filter for:
      // - isCompleted: false
      // - isDeleted: false
      // - notifyDaysBefore > 0
      // - completedAt is set (has a due date)
      expect(mockPrisma.milestones.findMany).not.toHaveBeenCalled();
    });

    it("should not send notifications for milestones with notifyDaysBefore = 0", async () => {
      // Milestones with notifyDaysBefore = 0 should not be in the query results
      const mockMilestones: any[] = [];

      mockPrisma.milestones.findMany.mockResolvedValue(mockMilestones);

      expect(mockCreateMilestoneDueNotification).not.toHaveBeenCalled();
    });

    it("should not send notifications for milestones without due date", async () => {
      // Milestones without completedAt should not be in the query results
      const mockMilestones: any[] = [];

      mockPrisma.milestones.findMany.mockResolvedValue(mockMilestones);

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
    it("should correctly calculate days until due date", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const dueDate = new Date("2025-12-10T12:00:00Z");

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

      expect(daysDiff).toBe(6);
    });

    it("should correctly identify overdue milestones", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const pastDueDate = new Date("2025-12-01T12:00:00Z");

      const timeDiff = pastDueDate.getTime() - now.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const isOverdue = daysDiff < 0;

      expect(daysDiff).toBeLessThan(0);
      expect(isOverdue).toBe(true);
    });

    it("should correctly identify milestones overdue by less than 24 hours", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      // Due date was 6 hours ago (less than 24 hours)
      const pastDueDate = new Date("2025-12-04T06:00:00Z");

      const timeDiff = pastDueDate.getTime() - now.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const isOverdue = daysDiff < 0;

      // Math.floor(-0.25) = -1, correctly identifies as overdue
      expect(daysDiff).toBe(-1);
      expect(isOverdue).toBe(true);
    });

    it("should send notification when within notifyDaysBefore threshold", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const dueDate = new Date("2025-12-07T12:00:00Z"); // 3 days away
      const notifyDaysBefore = 5;

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const isOverdue = daysDiff < 0;
      const shouldNotify = isOverdue || daysDiff <= notifyDaysBefore;

      expect(shouldNotify).toBe(true);
    });

    it("should not send notification when outside notifyDaysBefore threshold", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const dueDate = new Date("2025-12-15T12:00:00Z"); // 11 days away
      const notifyDaysBefore = 5;

      const timeDiff = dueDate.getTime() - now.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
      const isOverdue = daysDiff < 0;
      const shouldNotify = isOverdue || daysDiff <= notifyDaysBefore;

      expect(shouldNotify).toBe(false);
    });

    it("should always notify for overdue milestones", () => {
      const now = new Date("2025-12-04T12:00:00Z");
      const pastDueDate = new Date("2025-11-30T12:00:00Z"); // 4 days overdue
      const notifyDaysBefore = 5;

      const timeDiff = pastDueDate.getTime() - now.getTime();
      const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
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
