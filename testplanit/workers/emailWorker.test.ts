import { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Create mock prisma instance
const mockPrisma = {
  notification: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $disconnect: vi.fn(),
};

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock the multiTenantPrisma module to return our mock prisma client
vi.mock("../lib/multiTenantPrisma", () => ({
  getPrismaClientForJob: vi.fn(() => mockPrisma),
  getTenantConfig: vi.fn(() => undefined),
  isMultiTenantMode: vi.fn(() => false),
  validateMultiTenantJobData: vi.fn(),
  disconnectAllTenantClients: vi.fn(),
}));

// Mock email template functions
const mockSendNotificationEmail = vi.fn();
const mockSendDigestEmail = vi.fn();
vi.mock("../lib/email/notificationTemplates", () => ({
  sendNotificationEmail: (...args: any[]) => mockSendNotificationEmail(...args),
  sendDigestEmail: (...args: any[]) => mockSendDigestEmail(...args),
}));

// Mock server translations
vi.mock("../lib/server-translations", () => ({
  getServerTranslation: vi.fn((locale: string, key: string) =>
    Promise.resolve(key)
  ),
  getServerTranslations: vi.fn((locale: string, keys: string[]) =>
    Promise.resolve(Object.fromEntries(keys.map((k) => [k, k])))
  ),
  formatLocaleForUrl: vi.fn(() => "en-US"),
}));

// Mock tiptapToHtml
vi.mock("../utils/tiptapToHtml", () => ({
  isTipTapContent: vi.fn(() => true),
  tiptapToHtml: vi.fn(() => "<p>rich content html</p>"),
}));

// Mock email queue name
vi.mock("../lib/queues", () => ({
  EMAIL_QUEUE_NAME: "test-email-queue",
}));

const baseNotification = {
  id: "notif-1",
  userId: "user-1",
  type: "WORK_ASSIGNED",
  title: "You have been assigned",
  message: "A test case has been assigned to you",
  data: {
    projectId: "proj-1",
    testRunId: "run-1",
    testCaseId: "case-1",
    testCaseName: "Test Case Alpha",
    projectName: "Test Project",
    assignedByName: "Admin User",
  },
  createdAt: new Date(),
  user: {
    id: "user-1",
    email: "user@example.com",
    name: "Test User",
    userPreferences: {
      locale: "en_US",
    },
  },
};

describe("EmailWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    mockSendNotificationEmail.mockResolvedValue(undefined);
    mockSendDigestEmail.mockResolvedValue(undefined);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
  });

  describe("send-notification-email", () => {
    it("should process WORK_ASSIGNED single assignment and build correct URL", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "WORK_ASSIGNED",
        data: {
          projectId: "proj-1",
          testRunId: "run-1",
          testCaseId: "case-1",
          testCaseName: "My Test Case",
          projectName: "My Project",
          assignedByName: "Jane",
          isBulkAssignment: false,
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-1",
        name: "send-notification-email",
        data: {
          notificationId: "notif-1",
          userId: "user-1",
          immediate: true,
        },
      } as Job;

      await processor(mockJob);

      expect(mockSendNotificationEmail).toHaveBeenCalledOnce();
      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.to).toBe("user@example.com");
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/runs/proj-1/run-1?selectedCase=case-1"
      );
    });

    it("should process WORK_ASSIGNED bulk assignment with correct translation key", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "WORK_ASSIGNED",
        data: {
          isBulkAssignment: true,
          count: 5,
          assignedByName: "Admin",
          projectName: "My Project",
        },
      });

      const { processor } = await import("./emailWorker");
      const { getServerTranslation } = await import(
        "../lib/server-translations"
      );

      const mockJob = {
        id: "job-2",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      expect(getServerTranslation).toHaveBeenCalledWith(
        expect.anything(),
        "components.notifications.content.multipleTestCaseAssignmentTitle"
      );
      expect(mockSendNotificationEmail).toHaveBeenCalledOnce();
    });

    it("should process SESSION_ASSIGNED and build correct URL", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "SESSION_ASSIGNED",
        data: {
          projectId: "proj-1",
          sessionId: "session-1",
          sessionName: "Session Alpha",
          projectName: "My Project",
          assignedByName: "Manager",
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-3",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/sessions/proj-1/session-1"
      );
    });

    it("should process COMMENT_MENTION for RepositoryCase entity type", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "COMMENT_MENTION",
        data: {
          projectId: "proj-1",
          hasProjectAccess: true,
          entityType: "RepositoryCase",
          repositoryCaseId: "repo-case-1",
          entityName: "Test Case 1",
          projectName: "My Project",
          creatorName: "Bob",
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-4",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/repository/proj-1/repo-case-1"
      );
    });

    it("should process COMMENT_MENTION for TestRun entity type", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "COMMENT_MENTION",
        data: {
          projectId: "proj-1",
          hasProjectAccess: true,
          entityType: "TestRun",
          testRunId: "run-99",
          entityName: "Run 1",
          projectName: "My Project",
          creatorName: "Alice",
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-5",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/runs/proj-1/run-99"
      );
    });

    it("should process COMMENT_MENTION for Session entity type", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "COMMENT_MENTION",
        data: {
          projectId: "proj-1",
          hasProjectAccess: true,
          entityType: "Session",
          sessionId: "ses-99",
          entityName: "Session 1",
          projectName: "My Project",
          creatorName: "Alice",
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-6",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/sessions/proj-1/ses-99"
      );
    });

    it("should process COMMENT_MENTION for Milestone entity type", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "COMMENT_MENTION",
        data: {
          projectId: "proj-1",
          hasProjectAccess: true,
          entityType: "Milestone",
          milestoneId: "ms-99",
          entityName: "Milestone 1",
          projectName: "My Project",
          creatorName: "Alice",
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-7",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/milestones/proj-1/ms-99"
      );
    });

    it("should process SYSTEM_ANNOUNCEMENT with htmlContent", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "SYSTEM_ANNOUNCEMENT",
        data: {
          htmlContent: "<h1>Important Update</h1>",
          sentByName: "System",
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-8",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.htmlMessage).toBe("<h1>Important Update</h1>");
    });

    it("should process SYSTEM_ANNOUNCEMENT with richContent via tiptapToHtml", async () => {
      const richContent = { type: "doc", content: [] };
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "SYSTEM_ANNOUNCEMENT",
        data: { richContent },
      });

      const { processor } = await import("./emailWorker");
      const { tiptapToHtml } = await import("../utils/tiptapToHtml");

      const mockJob = {
        id: "job-9",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      expect(tiptapToHtml).toHaveBeenCalledWith(richContent);
      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.htmlMessage).toBe("<p>rich content html</p>");
    });

    it("should process MILESTONE_DUE_REMINDER when not overdue", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "MILESTONE_DUE_REMINDER",
        data: {
          projectId: "proj-1",
          milestoneId: "ms-1",
          milestoneName: "Q1 Milestone",
          projectName: "My Project",
          isOverdue: false,
          dueDate: "2026-04-01",
        },
      });

      const { processor } = await import("./emailWorker");
      const { getServerTranslation } = await import(
        "../lib/server-translations"
      );

      const mockJob = {
        id: "job-10",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      expect(getServerTranslation).toHaveBeenCalledWith(
        expect.anything(),
        "components.notifications.content.milestoneDueSoonTitle"
      );
      const callArgs = mockSendNotificationEmail.mock.calls[0][0];
      expect(callArgs.notificationUrl).toContain(
        "/en-US/projects/milestones/proj-1/ms-1"
      );
    });

    it("should process MILESTONE_DUE_REMINDER when overdue", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        type: "MILESTONE_DUE_REMINDER",
        data: {
          projectId: "proj-1",
          milestoneId: "ms-1",
          milestoneName: "Q1 Milestone",
          projectName: "My Project",
          isOverdue: true,
          dueDate: "2026-01-01",
        },
      });

      const { processor } = await import("./emailWorker");
      const { getServerTranslation } = await import(
        "../lib/server-translations"
      );

      const mockJob = {
        id: "job-11",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      expect(getServerTranslation).toHaveBeenCalledWith(
        expect.anything(),
        "components.notifications.content.milestoneOverdueTitle"
      );
    });

    it("should return early when notification is not found", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue(null);

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-12",
        name: "send-notification-email",
        data: {
          notificationId: "missing-notif",
          userId: "user-1",
          immediate: true,
        },
      } as Job;

      await processor(mockJob);

      expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    });

    it("should return early when user email is missing", async () => {
      mockPrisma.notification.findUnique.mockResolvedValue({
        ...baseNotification,
        user: {
          ...baseNotification.user,
          email: null,
        },
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-13",
        name: "send-notification-email",
        data: { notificationId: "notif-1", userId: "user-1", immediate: true },
      } as Job;

      await processor(mockJob);

      expect(mockSendNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe("send-digest-email", () => {
    const mockUser = {
      id: "user-1",
      email: "user@example.com",
      name: "Test User",
      userPreferences: { locale: "en_US" },
    };

    it("should process digest email and mark notifications as read", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: "notif-1",
          type: "WORK_ASSIGNED",
          title: "Assigned",
          message: "You were assigned",
          data: {
            projectId: "proj-1",
            testRunId: "run-1",
            testCaseId: "case-1",
            assignedByName: "Admin",
            testCaseName: "Test",
            projectName: "Project",
            isBulkAssignment: false,
          },
          createdAt: new Date(),
        },
        {
          id: "notif-2",
          type: "SESSION_ASSIGNED",
          title: "Session",
          message: "You were assigned a session",
          data: {
            projectId: "proj-1",
            sessionId: "session-1",
            sessionName: "My Session",
            projectName: "Project",
            assignedByName: "Admin",
          },
          createdAt: new Date(),
        },
      ]);

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-14",
        name: "send-digest-email",
        data: {
          userId: "user-1",
          notifications: [
            { id: "notif-1", title: "t1", message: "m1", createdAt: new Date() },
            { id: "notif-2", title: "t2", message: "m2", createdAt: new Date() },
          ],
        },
      } as Job;

      await processor(mockJob);

      expect(mockSendDigestEmail).toHaveBeenCalledOnce();
      const digestArgs = mockSendDigestEmail.mock.calls[0][0];
      expect(digestArgs.to).toBe("user@example.com");
      expect(digestArgs.notifications).toHaveLength(2);

      // Should mark notifications as read after sending
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["notif-1", "notif-2"] } },
        data: { isRead: true },
      });
    });

    it("should return early when user is not found", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-15",
        name: "send-digest-email",
        data: {
          userId: "missing-user",
          notifications: [
            { id: "notif-1", title: "t", message: "m", createdAt: new Date() },
          ],
        },
      } as Job;

      await processor(mockJob);

      expect(mockSendDigestEmail).not.toHaveBeenCalled();
      expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
    });

    it("should return early when user has no email", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        email: null,
      });

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-16",
        name: "send-digest-email",
        data: {
          userId: "user-1",
          notifications: [],
        },
      } as Job;

      await processor(mockJob);

      expect(mockSendDigestEmail).not.toHaveBeenCalled();
    });

    it("should build correct URLs for each notification type in digest", async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.notification.findMany.mockResolvedValue([
        {
          id: "notif-1",
          type: "COMMENT_MENTION",
          title: "Mentioned",
          message: "You were mentioned",
          data: {
            projectId: "proj-1",
            hasProjectAccess: true,
            entityType: "RepositoryCase",
            repositoryCaseId: "rc-1",
            entityName: "Case",
            projectName: "Project",
            creatorName: "User",
          },
          createdAt: new Date(),
        },
        {
          id: "notif-2",
          type: "MILESTONE_DUE_REMINDER",
          title: "Milestone",
          message: "Milestone due soon",
          data: {
            projectId: "proj-1",
            milestoneId: "ms-1",
            milestoneName: "Q1",
            projectName: "Project",
            isOverdue: false,
            dueDate: "2026-04-01",
          },
          createdAt: new Date(),
        },
      ]);

      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-17",
        name: "send-digest-email",
        data: {
          userId: "user-1",
          notifications: [
            { id: "notif-1", title: "t1", message: "m1", createdAt: new Date() },
            { id: "notif-2", title: "t2", message: "m2", createdAt: new Date() },
          ],
        },
      } as Job;

      await processor(mockJob);

      const digestArgs = mockSendDigestEmail.mock.calls[0][0];
      const urls = digestArgs.notifications.map((n: any) => n.url);
      expect(urls[0]).toContain("/en-US/projects/repository/proj-1/rc-1");
      expect(urls[1]).toContain("/en-US/projects/milestones/proj-1/ms-1");
    });
  });

  describe("unknown job type", () => {
    it("should throw an error for unknown job types", async () => {
      const { processor } = await import("./emailWorker");

      const mockJob = {
        id: "job-99",
        name: "unknown-job-type",
        data: {},
      } as Job;

      await expect(processor(mockJob)).rejects.toThrow(
        "Unknown job type: unknown-job-type"
      );
    });
  });
});
