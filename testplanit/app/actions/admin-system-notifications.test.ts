import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSystemNotification, getSystemNotificationHistory } from "./admin-system-notifications";
import { prisma } from "~/lib/prisma";
import { NotificationService } from "~/lib/services/notificationService";
import { getServerAuthSession } from "~/server/auth";

// Mock dependencies
vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
    },
    notification: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createNotification: vi.fn(),
  },
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

describe("admin-system-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSystemNotification", () => {
    it("should reject non-admin users", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "user1", access: "USER" },
      } as any);

      const result = await createSystemNotification({
        title: "Test",
        message: "Test message",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unauthorized");
    });

    it("should reject invalid input", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin1", access: "ADMIN", name: "Admin User" },
      } as any);

      const result = await createSystemNotification({
        title: "",
        message: "Test message",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid input");
    });

    it("should create notifications for all active users", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin1", access: "ADMIN", name: "Admin User" },
      } as any);

      const mockUsers = [
        { id: "user1" },
        { id: "user2" },
        { id: "user3" },
      ];

      vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any);
      vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

      const result = await createSystemNotification({
        title: "System Update",
        message: "We have updated the system",
      });

      expect(result.success).toBe(true);
      expect(result.sentToCount).toBe(3);

      // Verify user query filters
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          isDeleted: false,
          isActive: true,
        },
        select: {
          id: true,
        },
      });

      // Verify notifications created for each user
      expect(prisma.notification.create).toHaveBeenCalledTimes(3);
      mockUsers.forEach((user) => {
        expect(prisma.notification.create).toHaveBeenCalledWith({
          data: {
            userId: user.id,
            type: "SYSTEM_ANNOUNCEMENT",
            title: "System Update",
            message: "We have updated the system",
            isRead: false,
            data: {
              sentById: "admin1",
              sentByName: "Admin User",
              sentAt: expect.any(String),
              richContent: "We have updated the system",
            },
          },
        });
      });
    });

    it("should handle TipTap rich content", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin1", access: "ADMIN", name: "Admin User" },
      } as any);

      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "user1" }] as any);
      vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

      const richContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", marks: [{ type: "bold" }], text: "world" },
            ],
          },
        ],
      };

      const result = await createSystemNotification({
        title: "Rich Notification",
        message: JSON.stringify(richContent),
      });

      expect(result.success).toBe(true);

      // Verify rich content is preserved and plain text extracted
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: "user1",
          type: "SYSTEM_ANNOUNCEMENT",
          title: "Rich Notification",
          message: "Hello  world", // Plain text extracted (with space between nodes)
          isRead: false,
          data: {
            sentById: "admin1",
            sentByName: "Admin User",
            sentAt: expect.any(String),
            richContent: richContent, // Original rich content preserved
          },
        },
      });
    });
  });

  describe("getSystemNotificationHistory", () => {
    it("should reject non-admin users", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "user1", access: "USER" },
      } as any);

      const result = await getSystemNotificationHistory();

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unauthorized");
      expect(result.notifications).toEqual([]);
    });

    it("should return paginated notification history", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin1", access: "ADMIN" },
      } as any);

      const mockNotifications = [
        {
          id: "notif1",
          title: "Test 1",
          message: "Message 1",
          data: { sentByName: "Admin 1" },
          createdAt: new Date(),
        },
        {
          id: "notif2",
          title: "Test 2",
          message: "Message 2",
          data: { sentByName: "Admin 2" },
          createdAt: new Date(),
        },
      ];

      vi.mocked(prisma.notification.findMany).mockResolvedValue(mockNotifications as any);
      vi.mocked(prisma.notification.groupBy).mockResolvedValue([
        { title: "Test 1", message: "Message 1", _count: 5 },
        { title: "Test 2", message: "Message 2", _count: 3 },
      ] as any);

      const result = await getSystemNotificationHistory({ page: 1, pageSize: 10 });

      expect(result.success).toBe(true);
      expect(result.notifications).toEqual(mockNotifications);
      expect(result.totalCount).toBe(2);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);

      // Verify query parameters
      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: {
          type: "SYSTEM_ANNOUNCEMENT",
        },
        distinct: ["title", "message"],
        orderBy: {
          createdAt: "desc",
        },
        take: 10,
        skip: 0,
        select: {
          id: true,
          title: true,
          message: true,
          data: true,
          createdAt: true,
        },
      });
    });

    it("should handle pagination correctly", async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: "admin1", access: "ADMIN" },
      } as any);

      vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
      vi.mocked(prisma.notification.groupBy).mockResolvedValue(
        Array(25).fill({ title: "Test", message: "Message", _count: 1 })
      );

      const result = await getSystemNotificationHistory({ page: 2, pageSize: 10 });

      expect(result.totalCount).toBe(25);
      expect(result.currentPage).toBe(2);
      expect(result.totalPages).toBe(3);

      // Verify skip calculation
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10, // (page 2 - 1) * pageSize 10
          take: 10,
        })
      );
    });
  });
});