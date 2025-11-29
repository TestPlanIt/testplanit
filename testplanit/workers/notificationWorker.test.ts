import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Job } from "bullmq";

// Create mock prisma instance
const mockPrisma = {
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

// Mock Prisma with a proper constructor
vi.mock("@prisma/client", () => {
  return {
    PrismaClient: class {
      notification = mockPrisma.notification;
      userPreferences = mockPrisma.userPreferences;
      appConfig = mockPrisma.appConfig;
      $disconnect = mockPrisma.$disconnect;
    },
  };
});

// Mock the email queue
vi.mock("../lib/queues", () => ({
  emailQueue: {
    add: vi.fn(),
  },
  NOTIFICATION_QUEUE_NAME: "notifications",
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
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

      mockPrisma.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "IN_APP_EMAIL_IMMEDIATE",
        emailNotifications: true,
      });
      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockPrisma.notification.create.mockResolvedValue(mockNotification);

      // Import after mocks are set up
      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await processor(mockJob);

      // Check that user preferences were checked first
      expect(mockPrisma.userPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId: jobData.userId },
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
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

      const { emailQueue } = await import("../lib/queues");
      expect(emailQueue!.add).toHaveBeenCalledWith("send-notification-email", {
        notificationId: mockNotification.id,
        userId: jobData.userId,
        immediate: true,
      });
    });

    it("should use global settings when user mode is USE_GLOBAL", async () => {
      const jobData = {
        userId: "user-123",
        type: "WORK_ASSIGNED",
        title: "Test Notification",
        message: "Test message",
      };

      mockPrisma.notification.create.mockResolvedValue({ id: "notif-123" });
      mockPrisma.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "USE_GLOBAL",
      });
      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await processor(mockJob);

      const { emailQueue } = await import("../lib/queues");
      expect(emailQueue!.add).not.toHaveBeenCalled();
    });

    it("should skip notification when mode is NONE", async () => {
      const jobData = {
        userId: "user-123",
        type: "WORK_ASSIGNED",
        title: "Test Notification",
        message: "Test message",
      };

      mockPrisma.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "NONE",
      });
      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });

      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-123",
        name: "create-notification",
        data: jobData,
      } as Job;

      await processor(mockJob);
      
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
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
      
      mockPrisma.userPreferences.findUnique.mockResolvedValue({
        notificationMode: "IN_APP",
      });
      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockPrisma.notification.create.mockRejectedValue(error);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
    it("should send daily digest emails", async () => {
      const mockUsers = [
        {
          userId: "user-123",
          user: { id: "user-123", name: "Test User", email: "test@example.com" },
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

      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockPrisma.userPreferences.findMany.mockResolvedValue(mockUsers);
      mockPrisma.notification.findMany.mockResolvedValue(mockNotifications);

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-456",
        name: "send-daily-digest",
        data: {},
      } as Job;

      await processor(mockJob);

      expect(mockPrisma.userPreferences.findMany).toHaveBeenCalledWith({
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

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          isRead: false,
          isDeleted: false,
          createdAt: { gte: expect.any(Date) },
        },
        orderBy: { createdAt: "desc" },
      });

      const { emailQueue } = await import("../lib/queues");
      expect(emailQueue!.add).toHaveBeenCalledWith("send-digest-email", {
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
          user: { id: "user-123", name: "Test User", email: "test@example.com" },
        },
      ];

      mockPrisma.appConfig.findUnique.mockResolvedValue({
        value: { defaultMode: "IN_APP" },
      });
      mockPrisma.userPreferences.findMany.mockResolvedValue(mockUsers);
      mockPrisma.notification.findMany.mockResolvedValue([]);

      const { processor } = await import("./notificationWorker");

      const mockJob = {
        id: "job-456",
        name: "send-daily-digest",
        data: {},
      } as Job;

      await processor(mockJob);

      const { emailQueue } = await import("../lib/queues");
      expect(emailQueue!.add).not.toHaveBeenCalled();
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

      await expect(processor(mockJob)).rejects.toThrow("Unknown job type: unknown-job");
    });
  });
});