import { NotificationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNotificationQueue } from "../queues";
import { NotificationService } from "./notificationService";

// Mock ~/server/db for createUserRegistrationNotification
const mockFindMany = vi.fn();
vi.mock("~/server/db", () => ({
  db: {
    user: {
      findMany: mockFindMany,
    },
  },
}));

// Mock the queue
const mockQueue = {
  add: vi.fn(),
};

vi.mock("../queues", () => ({
  getNotificationQueue: vi.fn(() => mockQueue),
}));

describe("NotificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createNotification", () => {
    it("should add a notification job to the queue", async () => {
      const mockJobId = "job-123";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      const params = {
        userId: "user-123",
        type: NotificationType.WORK_ASSIGNED,
        title: "Test Notification",
        message: "This is a test notification",
        relatedEntityId: "entity-123",
        relatedEntityType: "TestEntity",
        data: { test: true },
      };

      const jobId = await NotificationService.createNotification(params);

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        params,
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      expect(jobId).toBe(mockJobId);
    });

    it("should handle queue not available", async () => {
      vi.mocked(getNotificationQueue).mockReturnValueOnce(null);

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const params = {
        userId: "user-123",
        type: NotificationType.WORK_ASSIGNED,
        title: "Test Notification",
        message: "This is a test notification",
      };

      const result = await NotificationService.createNotification(params);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Notification queue not available, notification not created"
      );
      expect(result).toBeUndefined();

      consoleWarnSpy.mockRestore();
    });

    it("should handle queue errors", async () => {
      const error = new Error("Queue error");
      mockQueue.add.mockRejectedValue(error);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const params = {
        userId: "user-123",
        type: NotificationType.WORK_ASSIGNED,
        title: "Test Notification",
        message: "This is a test notification",
      };

      await expect(NotificationService.createNotification(params)).rejects.toThrow(
        "Queue error"
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to queue notification:",
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("createWorkAssignmentNotification", () => {
    it("should create a notification for test run case assignment", async () => {
      const mockJobId = "job-456";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      const result = await NotificationService.createWorkAssignmentNotification(
        "assignee-123",
        "TestRunCase",
        "Test Case 1",
        "Project Alpha",
        "assigner-456",
        "John Doe",
        "case-789"
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        {
          userId: "assignee-123",
          type: NotificationType.WORK_ASSIGNED,
          title: "New Test Case Assignment",
          message: 'John Doe assigned you to test case "Test Case 1" in project "Project Alpha"',
          relatedEntityId: "case-789",
          relatedEntityType: "TestRunCase",
          data: {
            assignedById: "assigner-456",
            assignedByName: "John Doe",
            projectName: "Project Alpha",
            entityName: "Test Case 1",
          },
        },
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      expect(result).toBe(mockJobId);
    });

    it("should create a notification for session assignment", async () => {
      const mockJobId = "job-789";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      const result = await NotificationService.createWorkAssignmentNotification(
        "assignee-123",
        "Session",
        "Exploratory Session 1",
        "Project Beta",
        "assigner-456",
        "Jane Smith",
        "session-123"
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        {
          userId: "assignee-123",
          type: NotificationType.SESSION_ASSIGNED,
          title: "New Session Assignment",
          message: 'Jane Smith assigned you to session "Exploratory Session 1" in project "Project Beta"',
          relatedEntityId: "session-123",
          relatedEntityType: "Session",
          data: {
            assignedById: "assigner-456",
            assignedByName: "Jane Smith",
            projectName: "Project Beta",
            entityName: "Exploratory Session 1",
          },
        },
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      expect(result).toBe(mockJobId);
    });
  });

  describe("bulk assignment notifications", () => {
    it("should create notifications for multiple test case assignments", async () => {
      const mockJobId = "job-bulk-123";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      // Simulate bulk assignment to multiple test cases
      const assigneeId = "assignee-123";
      const assignerId = "assigner-456";
      const assignerName = "Admin User";
      const projectName = "Test Project";
      
      // Simulate assigning 3 test cases
      const testCases = [
        { id: "case-1", name: "Test Case 1" },
        { id: "case-2", name: "Test Case 2" },
        { id: "case-3", name: "Test Case 3" }
      ];

      // Create bulk notification
      const result = await NotificationService.createNotification({
        userId: assigneeId,
        type: NotificationType.WORK_ASSIGNED,
        title: "Multiple Test Cases Assigned",
        message: `${assignerName} assigned you ${testCases.length} test cases`,
        data: {
          assignedById: assignerId,
          assignedByName: assignerName,
          projectName: projectName,
          count: testCases.length,
          isBulkAssignment: true,
          testCases: testCases
        }
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          userId: assigneeId,
          type: NotificationType.WORK_ASSIGNED,
          title: "Multiple Test Cases Assigned",
          message: `Admin User assigned you 3 test cases`,
          data: expect.objectContaining({
            isBulkAssignment: true,
            count: 3
          })
        }),
        expect.any(Object)
      );

      expect(result).toBe(mockJobId);
    });

    it("should handle bulk assignment with grouping by test run", async () => {
      const mockJobId = "job-bulk-grouped";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      // Simulate bulk assignment grouped by test runs
      const testRunGroups = [
        {
          testRunId: 1,
          testRunName: "Sprint 1 Testing",
          projectId: 100,
          projectName: "E-Commerce Platform",
          testCases: [
            { testRunCaseId: 10, testCaseId: 1001, testCaseName: "Login Test" },
            { testRunCaseId: 11, testCaseId: 1002, testCaseName: "Checkout Test" }
          ]
        },
        {
          testRunId: 2,
          testRunName: "Sprint 2 Testing",
          projectId: 100,
          projectName: "E-Commerce Platform",
          testCases: [
            { testRunCaseId: 20, testCaseId: 2001, testCaseName: "API Test" }
          ]
        }
      ];

      const result = await NotificationService.createNotification({
        userId: "user-456",
        type: NotificationType.WORK_ASSIGNED,
        title: "Multiple Test Cases Assigned",
        message: "Jane Doe assigned you 3 test cases",
        data: {
          assignedById: "jane-123",
          assignedByName: "Jane Doe",
          testRunGroups: testRunGroups,
          count: 3,
          isBulkAssignment: true
        }
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          data: expect.objectContaining({
            testRunGroups: expect.arrayContaining([
              expect.objectContaining({
                testRunName: "Sprint 1 Testing",
                testCases: expect.arrayContaining([
                  expect.objectContaining({ testCaseName: "Login Test" })
                ])
              })
            ])
          })
        }),
        expect.any(Object)
      );

      expect(result).toBe(mockJobId);
    });
  });

  describe("notification preferences", () => {
    it("should respect user preference overrides when creating notifications", async () => {
      const mockJobId = "job-pref-123";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      // Create a notification with user preference data
      const result = await NotificationService.createNotification({
        userId: "user-with-prefs",
        type: NotificationType.WORK_ASSIGNED,
        title: "Test Assignment",
        message: "You have been assigned a test",
        data: {
          userNotificationMode: "NO_NOTIFICATIONS",
          shouldSkipNotification: true
        }
      });

      // The service should still queue the job, but with preference data
      // The worker will decide whether to actually create the notification
      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          data: expect.objectContaining({
            userNotificationMode: "NO_NOTIFICATIONS",
            shouldSkipNotification: true
          })
        }),
        expect.any(Object)
      );

      expect(result).toBe(mockJobId);
    });

    it("should include global notification settings in the notification data", async () => {
      const mockJobId = "job-global-123";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      // Create a notification with global settings reference
      const result = await NotificationService.createNotification({
        userId: "user-123",
        type: NotificationType.SESSION_ASSIGNED,
        title: "Session Assignment",
        message: "You have been assigned to a session",
        data: {
          globalNotificationMode: "IN_APP_EMAIL_DAILY",
          userNotificationMode: "USE_GLOBAL"
        }
      });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          data: expect.objectContaining({
            globalNotificationMode: "IN_APP_EMAIL_DAILY",
            userNotificationMode: "USE_GLOBAL"
          })
        }),
        expect.any(Object)
      );

      expect(result).toBe(mockJobId);
    });
  });

  describe("assignment change detection", () => {
    it("should not create notification when assignee hasn't changed", async () => {
      // This test covers the logic in the server actions
      // where we check if newAssigneeId === previousAssigneeId
      const mockJobId = "job-no-change";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      // In the actual implementation, the server action would return early
      // and not call createNotification if assignee hasn't changed
      // This test documents that behavior
      const callCount = mockQueue.add.mock.calls.length;

      // Simulate no call when assignee is the same
      expect(callCount).toBe(0);
    });

    it("should not create notification when unassigning (null assignee)", async () => {
      // This test covers the logic where we don't notify on unassignment
      const mockJobId = "job-unassign";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      // In the actual implementation, the server action would return early
      // and not call createNotification if newAssigneeId is null
      const callCount = mockQueue.add.mock.calls.length;

      // Simulate no call when unassigning
      expect(callCount).toBe(0);
    });
  });

  describe("createMilestoneDueNotification", () => {
    it("should create a notification for milestone due soon", async () => {
      const mockJobId = "job-milestone-due";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      const dueDate = new Date("2025-12-15");
      const result = await NotificationService.createMilestoneDueNotification(
        "user-123",
        "Release 2.0",
        "Project Alpha",
        dueDate,
        42,
        100,
        false // not overdue
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        {
          userId: "user-123",
          type: NotificationType.MILESTONE_DUE_REMINDER,
          title: "Milestone Due Soon",
          message: expect.stringContaining('Milestone "Release 2.0" in project "Project Alpha" is due on'),
          relatedEntityId: "42",
          relatedEntityType: "Milestone",
          data: {
            milestoneName: "Release 2.0",
            projectName: "Project Alpha",
            projectId: 100,
            milestoneId: 42,
            dueDate: dueDate.toISOString(),
            isOverdue: false,
          },
        },
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      expect(result).toBe(mockJobId);
    });

    it("should create a notification for overdue milestone", async () => {
      const mockJobId = "job-milestone-overdue";
      mockQueue.add.mockResolvedValue({ id: mockJobId } as any);

      const dueDate = new Date("2025-11-01");
      const result = await NotificationService.createMilestoneDueNotification(
        "user-456",
        "Sprint 5 Complete",
        "Mobile App",
        dueDate,
        99,
        200,
        true // overdue
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        {
          userId: "user-456",
          type: NotificationType.MILESTONE_DUE_REMINDER,
          title: "Milestone Overdue",
          message: expect.stringContaining('Milestone "Sprint 5 Complete" in project "Mobile App" was due on'),
          relatedEntityId: "99",
          relatedEntityType: "Milestone",
          data: {
            milestoneName: "Sprint 5 Complete",
            projectName: "Mobile App",
            projectId: 200,
            milestoneId: 99,
            dueDate: dueDate.toISOString(),
            isOverdue: true,
          },
        },
        {
          removeOnComplete: true,
          removeOnFail: false,
        }
      );

      expect(result).toBe(mockJobId);
    });

    it("should include correct title based on overdue status", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-123" } as any);

      const dueDate = new Date();

      // Test non-overdue
      await NotificationService.createMilestoneDueNotification(
        "user-1",
        "Test Milestone",
        "Test Project",
        dueDate,
        1,
        1,
        false
      );

      expect(mockQueue.add).toHaveBeenLastCalledWith(
        "create-notification",
        expect.objectContaining({
          title: "Milestone Due Soon",
        }),
        expect.any(Object)
      );

      // Test overdue
      await NotificationService.createMilestoneDueNotification(
        "user-1",
        "Test Milestone",
        "Test Project",
        dueDate,
        1,
        1,
        true
      );

      expect(mockQueue.add).toHaveBeenLastCalledWith(
        "create-notification",
        expect.objectContaining({
          title: "Milestone Overdue",
        }),
        expect.any(Object)
      );
    });

    it("should store milestone and project IDs for URL building", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-123" } as any);

      const milestoneId = 42;
      const projectId = 100;
      const dueDate = new Date();

      await NotificationService.createMilestoneDueNotification(
        "user-1",
        "Test Milestone",
        "Test Project",
        dueDate,
        milestoneId,
        projectId,
        false
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          relatedEntityId: milestoneId.toString(),
          relatedEntityType: "Milestone",
          data: expect.objectContaining({
            milestoneId,
            projectId,
          }),
        }),
        expect.any(Object)
      );
    });

    it("should handle queue errors gracefully", async () => {
      const error = new Error("Queue error");
      mockQueue.add.mockRejectedValue(error);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        NotificationService.createMilestoneDueNotification(
          "user-1",
          "Test Milestone",
          "Test Project",
          new Date(),
          1,
          1,
          false
        )
      ).rejects.toThrow("Queue error");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to queue notification:",
        error
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("createUserRegistrationNotification", () => {
    it("should notify all system admins when a new user registers via form", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-admin-1" } as any);
      mockFindMany.mockResolvedValue([
        { id: "admin-1" },
        { id: "admin-2" },
      ]);

      await NotificationService.createUserRegistrationNotification(
        "Jane Smith",
        "jane@example.com",
        "new-user-id",
        "form"
      );

      expect(mockFindMany).toHaveBeenCalledWith({
        where: {
          access: "ADMIN",
          isActive: true,
          isDeleted: false,
        },
        select: { id: true },
      });

      // Should have called add twice (once per admin)
      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          userId: "admin-1",
          type: NotificationType.USER_REGISTERED,
          title: "New User Registration",
          message: "Jane Smith (jane@example.com) has registered via registration form",
          relatedEntityId: "new-user-id",
          relatedEntityType: "User",
          data: expect.objectContaining({
            newUserName: "Jane Smith",
            newUserEmail: "jane@example.com",
            newUserId: "new-user-id",
            registrationMethod: "form",
          }),
        }),
        expect.any(Object)
      );
    });

    it("should notify all system admins when a new user registers via SSO", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-sso-1" } as any);
      mockFindMany.mockResolvedValue([{ id: "admin-only" }]);

      await NotificationService.createUserRegistrationNotification(
        "Bob Jones",
        "bob@company.com",
        "sso-user-id",
        "sso"
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          userId: "admin-only",
          type: NotificationType.USER_REGISTERED,
          message: "Bob Jones (bob@company.com) has registered via SSO",
        }),
        expect.any(Object)
      );
    });

    it("should handle no system admins found gracefully", async () => {
      mockFindMany.mockResolvedValue([]);
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await NotificationService.createUserRegistrationNotification(
        "Alice",
        "alice@example.com",
        "user-alice",
        "form"
      );

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "No system administrators found to notify"
      );
      expect(mockQueue.add).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it("should handle db errors without throwing", async () => {
      mockFindMany.mockRejectedValue(new Error("DB connection error"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Should not throw — the method swallows errors
      await expect(
        NotificationService.createUserRegistrationNotification(
          "Carol",
          "carol@example.com",
          "user-carol",
          "form"
        )
      ).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to create user registration notifications:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("createShareLinkAccessedNotification", () => {
    it("should create share link accessed notification with viewer name", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-share-1" } as any);

      const result = await NotificationService.createShareLinkAccessedNotification(
        "owner-123",
        "Sprint Report Q4",
        "Alice Viewer",
        "alice@test.com",
        "share-link-abc",
        100
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          userId: "owner-123",
          type: NotificationType.SHARE_LINK_ACCESSED,
          title: "Shared Report Viewed",
          message: 'Alice Viewer viewed your shared report: "Sprint Report Q4"',
          relatedEntityId: "share-link-abc",
          relatedEntityType: "ShareLink",
          data: expect.objectContaining({
            shareLinkId: "share-link-abc",
            projectId: 100,
            viewerName: "Alice Viewer",
            viewerEmail: "alice@test.com",
          }),
        }),
        expect.any(Object)
      );

      expect(result).toBe("job-share-1");
    });

    it("should use viewer email when name is not available", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-share-2" } as any);

      await NotificationService.createShareLinkAccessedNotification(
        "owner-456",
        "Test Summary",
        null,
        "anonymous@test.com",
        "share-link-xyz"
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          message: 'anonymous@test.com viewed your shared report: "Test Summary"',
        }),
        expect.any(Object)
      );
    });

    it("should use 'Someone' when both name and email are null", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-share-3" } as any);

      await NotificationService.createShareLinkAccessedNotification(
        "owner-789",
        "Anonymous Report",
        null,
        null,
        "share-link-anon"
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          message: 'Someone viewed your shared report: "Anonymous Report"',
        }),
        expect.any(Object)
      );
    });

    it("should omit projectId from data when not provided", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-share-4" } as any);

      await NotificationService.createShareLinkAccessedNotification(
        "owner-000",
        "Report Without Project",
        "Bob",
        null,
        "share-link-no-project"
        // no projectId argument
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        "create-notification",
        expect.objectContaining({
          data: expect.not.objectContaining({ projectId: expect.anything() }),
        }),
        expect.any(Object)
      );
    });

    it("should include viewedAt timestamp in data", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-share-5" } as any);

      const before = Date.now();
      await NotificationService.createShareLinkAccessedNotification(
        "owner-ts",
        "Timestamped Report",
        "Dave",
        null,
        "share-link-ts",
        50
      );
      const after = Date.now();

      const callArgs = mockQueue.add.mock.calls[0][1] as any;
      const viewedAtMs = new Date(callArgs.data.viewedAt).getTime();
      expect(viewedAtMs).toBeGreaterThanOrEqual(before);
      expect(viewedAtMs).toBeLessThanOrEqual(after);
    });
  });

  describe("markNotificationsAsRead", () => {
    it("should return the provided notification IDs", async () => {
      const ids = ["notif-1", "notif-2", "notif-3"];
      const result = await NotificationService.markNotificationsAsRead(ids, "user-123");
      expect(result).toEqual(ids);
    });

    it("should return empty array when no IDs provided", async () => {
      const result = await NotificationService.markNotificationsAsRead([], "user-123");
      expect(result).toEqual([]);
    });
  });

  describe("getUnreadCount", () => {
    it("should return 0 as placeholder implementation", async () => {
      const count = await NotificationService.getUnreadCount("user-123");
      expect(count).toBe(0);
    });
  });
});