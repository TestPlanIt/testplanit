import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Create mock db instance
const mockDb = {
  notification: {
    create: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  userPreferences: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  appConfig: {
    findUnique: vi.fn(),
  },
  $disconnect: vi.fn(),
};

// Mock the email queue
const mockEmailQueue = {
  add: vi.fn(),
};

vi.mock("../lib/queues", () => ({
  getEmailQueue: vi.fn(() => mockEmailQueue),
  NOTIFICATION_QUEUE_NAME: "notifications",
}));

// Email is configured by default in tests; individual tests flip this off.
const mockIsEmailConfigured = vi.fn(() => true);
vi.mock("../lib/email/emailConfig", () => ({
  isEmailServerConfigured: () => mockIsEmailConfigured(),
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock the multiTenantDb module to return our mock db client
vi.mock("../lib/multiTenantDb", () => ({
  getDbClientForJob: vi.fn(() => mockDb),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// Run-readiness hand-off: the claim, the recipient resolution, and the
// notification fan-out are each other modules' business — stub them and assert
// the worker's wiring between them.
const mockClaimRunReadyTransition = vi.fn();
vi.mock("../lib/services/runReadyCheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/services/runReadyCheck")>()),
  claimRunReadyTransition: (...args: any[]) =>
    mockClaimRunReadyTransition(...args),
}));

const mockResolveRunCompletionRecipients = vi.fn();
vi.mock("../lib/services/runCompletionRecipients", () => ({
  resolveRunCompletionRecipients: (...args: any[]) =>
    mockResolveRunCompletionRecipients(...args),
}));

const mockCreateRunReadyToCompleteNotification = vi.fn();
vi.mock("../lib/services/notificationService", () => ({
  NotificationService: {
    createRunReadyToCompleteNotification: (...args: any[]) =>
      mockCreateRunReadyToCompleteNotification(...args),
  } as any,
}));

describe("NotificationWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("JOB_CREATE_NOTIFICATION", () => {
    it("should create a notification and queue email for immediate mode", async () => {
      const jobData = {
        userId: "user-123",
        type: "WORK_ASSIGNED",
        title: "Test Notification",
        message: "Test message",
        relatedEntityId: "entity-123",
        relatedEntityType: "TestRunCase",
        data: { test: true },
      };

      const mockNotification = {
        id: "notif-123",
        ...jobData,
      };

      mockDb.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "IN_APP_EMAIL_IMMEDIATE",
        emailNotifications: true,
      });
      mockDb.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockDb.notification.create.mockResolvedValue(mockNotification);

      // Import after mocks are set up
      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await processor(mockJob);

      // Check that user preferences were checked first
      expect(mockDb.userPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId: jobData.userId },
      });

      expect(mockDb.notification.create).toHaveBeenCalledWith({
        data: {
          userId: jobData.userId,
          type: jobData.type,
          title: jobData.title,
          message: jobData.message,
          relatedEntityId: jobData.relatedEntityId,
          relatedEntityType: jobData.relatedEntityType,
          data: jobData.data,
        },
      });

      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        "send-notification-email",
        {
          notificationId: mockNotification.id,
          userId: jobData.userId,
          immediate: true,
        }
      );
    });

    it("should use global settings when user mode is USE_GLOBAL", async () => {
      const jobData = {
        userId: "user-123",
        type: "WORK_ASSIGNED",
        title: "Test Notification",
        message: "Test message",
      };

      mockDb.notification.create.mockResolvedValue({ id: "notif-123" });
      mockDb.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "USE_GLOBAL",
      });
      mockDb.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await processor(mockJob);

      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });

    it("should skip notification when mode is NONE", async () => {
      const jobData = {
        userId: "user-123",
        type: "WORK_ASSIGNED",
        title: "Test Notification",
        message: "Test message",
      };

      mockDb.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "NONE",
      });
      mockDb.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await processor(mockJob);

      expect(mockDb.notification.create).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Skipping notification for user user-123 - notifications disabled"
      );

      consoleLogSpy.mockRestore();
    });

    it("should handle notification creation errors", async () => {
      const jobData = {
        userId: "user-123",
        type: "WORK_ASSIGNED",
        title: "Test Notification",
        message: "Test message",
      };

      const error = new Error("Database error");

      mockDb.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "IN_APP",
      });
      mockDb.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockDb.notification.create.mockRejectedValue(error);

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await expect(processor(mockJob)).rejects.toThrow("Database error");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to create notification:",
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("JOB_SEND_DAILY_DIGEST", () => {
    it("skips the digest pass entirely when no email server is configured", async () => {
      mockIsEmailConfigured.mockReturnValueOnce(false);

      const { processor } = await import("./notificationWorker");

      await processor({
        id: "job-456",
        name: "send-daily-digest",
        data: {},
      } as Job);

      expect(mockDb.userPreferences.findMany).not.toHaveBeenCalled();
      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });

    it("should send daily digest emails", async () => {
      const mockUsers = [
        {
          userId: "user-123",
          user: {
            id: "user-123",
            name: "Test User",
            email: "test@example.com",
          },
        },
      ];

      const mockNotifications = [
        {
          id: "notif-1",
          title: "Notification 1",
          message: "Message 1",
          createdAt: new Date(),
        },
        {
          id: "notif-2",
          title: "Notification 2",
          message: "Message 2",
          createdAt: new Date(),
        },
      ];

      mockDb.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockDb.userPreferences.findMany.mockResolvedValue(mockUsers);
      mockDb.notification.findMany.mockResolvedValue(mockNotifications);

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-456",
        name: "send-daily-digest",
        data: {},
      } as Job;

      await processor(mockJob);

      expect(mockDb.userPreferences.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { notificationMode: "IN_APP_EMAIL_DAILY" },
            {
              notificationMode: "USE_GLOBAL",
              id: "none", // This is a workaround to conditionally include users
            },
          ],
        },
        include: { user: true },
      });

      expect(mockDb.notification.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          isRead: false,
          isDeleted: false,
          createdAt: { gte: expect.any(Date) },
        },
        orderBy: { createdAt: "desc" },
      });

      expect(mockEmailQueue.add).toHaveBeenCalledWith("send-digest-email", {
        userId: "user-123",
        notifications: mockNotifications.map((n) => ({
          id: n.id,
          title: n.title,
          message: n.message,
          createdAt: n.createdAt,
        })),
      });
    });

    it("should skip users with no notifications", async () => {
      const mockUsers = [
        {
          userId: "user-123",
          user: {
            id: "user-123",
            name: "Test User",
            email: "test@example.com",
          },
        },
      ];

      mockDb.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockDb.userPreferences.findMany.mockResolvedValue(mockUsers);
      mockDb.notification.findMany.mockResolvedValue([]);

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-456",
        name: "send-daily-digest",
        data: {},
      } as Job;

      await processor(mockJob);

      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });
  });

  describe("JOB_CHECK_RUN_READY", () => {
    const readyOutcome = {
      reason: "notified" as const,
      notify: {
        runId: 42,
        runName: "Regression sweep",
        projectId: 7,
        projectName: "Project Alpha",
        caseCount: 12,
      },
    };

    const readyJob = (data: Record<string, unknown> = { runId: 42 }) =>
      ({ id: "job-ready", name: "check-run-ready", data }) as Job;

    it("claims the transition, resolves recipients, and hands both to the notification service", async () => {
      mockClaimRunReadyTransition.mockResolvedValue(readyOutcome);
      mockResolveRunCompletionRecipients.mockResolvedValue([
        "user-a",
        "user-b",
      ]);

      const { processor } = await import("./notificationWorker");

      await processor(readyJob({ runId: 42, tenantId: "acme" }));

      expect(mockClaimRunReadyTransition).toHaveBeenCalledTimes(1);
      expect(mockResolveRunCompletionRecipients).toHaveBeenCalledWith(7);
      expect(mockCreateRunReadyToCompleteNotification).toHaveBeenCalledWith({
        targetUserIds: ["user-a", "user-b"],
        testRunId: 42,
        testRunName: "Regression sweep",
        projectId: 7,
        projectName: "Project Alpha",
        caseCount: 12,
        tenantId: "acme",
      });
    });

    it("passes the recipient list through unchanged — no filtering, no reordering, duplicates intact", async () => {
      mockClaimRunReadyTransition.mockResolvedValue(readyOutcome);
      const resolved = ["user-z", "user-a", "user-z", "user-m"];
      mockResolveRunCompletionRecipients.mockResolvedValue(resolved);

      const { processor } = await import("./notificationWorker");

      await processor(readyJob());

      const params = mockCreateRunReadyToCompleteNotification.mock.calls[0][0];
      expect(params.targetUserIds).toEqual(resolved);
    });

    it("sends an empty recipient list straight through rather than inventing recipients", async () => {
      mockClaimRunReadyTransition.mockResolvedValue(readyOutcome);
      mockResolveRunCompletionRecipients.mockResolvedValue([]);

      const { processor } = await import("./notificationWorker");

      await processor(readyJob());

      expect(mockCreateRunReadyToCompleteNotification).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserIds: [] })
      );
    });

    it("writes the marker through the raw job client, not an enhanced/plugin client", async () => {
      mockClaimRunReadyTransition.mockResolvedValue(readyOutcome);
      mockResolveRunCompletionRecipients.mockResolvedValue(["user-a"]);

      const { processor } = await import("./notificationWorker");
      const { getDbClientForJob } = await import("../lib/multiTenantDb");

      const job = readyJob({ runId: 42, tenantId: "acme" });
      await processor(job);

      // getDbClientForJob is the raw (rawDb / per-tenant) client; the claim must
      // receive exactly that instance so the marker write skips the ES-sync and
      // webhook plugins.
      expect(getDbClientForJob).toHaveBeenCalledWith(job.data);
      const [client, runId] = mockClaimRunReadyTransition.mock.calls[0];
      expect(client).toBe(mockDb);
      expect(runId).toBe(42);
    });

    it.each([
      "not-found",
      "not-regular",
      "already-completed",
      "not-ready",
      "already-notified",
    ])("sends nothing when the claim comes back %s", async (reason) => {
      mockClaimRunReadyTransition.mockResolvedValue({ notify: null, reason });
      mockResolveRunCompletionRecipients.mockResolvedValue(["user-a"]);

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});

      const { processor } = await import("./notificationWorker");

      await processor(readyJob());

      expect(mockResolveRunCompletionRecipients).not.toHaveBeenCalled();
      expect(mockCreateRunReadyToCompleteNotification).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Run 42 readiness check: ${reason}`
      );

      consoleLogSpy.mockRestore();
    });

    it("omits tenantId when the job carries none", async () => {
      mockClaimRunReadyTransition.mockResolvedValue(readyOutcome);
      mockResolveRunCompletionRecipients.mockResolvedValue(["user-a"]);

      const { processor } = await import("./notificationWorker");

      await processor(readyJob({ runId: 42 }));

      const params = mockCreateRunReadyToCompleteNotification.mock.calls[0][0];
      expect(params.tenantId).toBeUndefined();
    });

    it("rethrows so the job retries when the claim fails", async () => {
      const error = new Error("db down");
      mockClaimRunReadyTransition.mockRejectedValue(error);

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { processor } = await import("./notificationWorker");

      await expect(processor(readyJob())).rejects.toThrow("db down");

      expect(mockCreateRunReadyToCompleteNotification).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed readiness check for run 42:",
        error
      );

      consoleErrorSpy.mockRestore();
    });

    it("rethrows when the notification fan-out fails", async () => {
      mockClaimRunReadyTransition.mockResolvedValue(readyOutcome);
      mockResolveRunCompletionRecipients.mockResolvedValue(["user-a"]);
      mockCreateRunReadyToCompleteNotification.mockRejectedValue(
        new Error("fanout failed")
      );

      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { processor } = await import("./notificationWorker");

      await expect(processor(readyJob())).rejects.toThrow("fanout failed");

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Unknown job type", () => {
    it("should throw error for unknown job type", async () => {
      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-789",
        name: "unknown-job",
        data: {},
      } as Job;

      await expect(processor(mockJob)).rejects.toThrow(
        "Unknown job type: unknown-job"
      );
    });
  });
});
