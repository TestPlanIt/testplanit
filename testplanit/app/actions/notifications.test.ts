import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies
const mockUpdate = vi.fn();
const mockUpdateMany = vi.fn();
const mockCount = vi.fn();

vi.mock("~/lib/prisma", () => ({
  prisma: {
    notification: {
      update: (...args: any[]) => mockUpdate(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
      count: (...args: any[]) => mockCount(...args),
    },
  },
}));

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockCreateUserRegistrationNotification = vi.fn();
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createUserRegistrationNotification: (...args: any[]) =>
      mockCreateUserRegistrationNotification(...args),
  },
}));

import {
  markNotificationAsRead,
  markNotificationAsUnread,
  deleteNotification,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
  createUserRegistrationNotification,
} from "./notifications";

describe("notifications actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-123" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("markNotificationAsRead", () => {
    it("should throw error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      await expect(markNotificationAsRead("notif-1")).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should throw error when user has no id", async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: {} });

      await expect(markNotificationAsRead("notif-1")).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should mark notification as read", async () => {
      const mockNotification = { id: "notif-1", isRead: true };
      mockUpdate.mockResolvedValue(mockNotification);

      const result = await markNotificationAsRead("notif-1");

      expect(result).toEqual({ success: true, notification: mockNotification });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "notif-1" },
        data: { isRead: true },
      });
    });

    it("should return error on database failure", async () => {
      mockUpdate.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await markNotificationAsRead("notif-1");

      expect(result).toEqual({
        success: false,
        error: "Failed to update notification",
      });

      consoleSpy.mockRestore();
    });
  });

  describe("markNotificationAsUnread", () => {
    it("should throw error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      await expect(markNotificationAsUnread("notif-1")).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should mark notification as unread", async () => {
      const mockNotification = { id: "notif-1", isRead: false };
      mockUpdate.mockResolvedValue(mockNotification);

      const result = await markNotificationAsUnread("notif-1");

      expect(result).toEqual({ success: true, notification: mockNotification });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "notif-1" },
        data: { isRead: false },
      });
    });

    it("should return error on database failure", async () => {
      mockUpdate.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await markNotificationAsUnread("notif-1");

      expect(result).toEqual({
        success: false,
        error: "Failed to update notification",
      });

      consoleSpy.mockRestore();
    });
  });

  describe("deleteNotification", () => {
    it("should throw error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      await expect(deleteNotification("notif-1")).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should soft delete notification", async () => {
      const mockNotification = { id: "notif-1", isDeleted: true };
      mockUpdate.mockResolvedValue(mockNotification);

      const result = await deleteNotification("notif-1");

      expect(result).toEqual({ success: true, notification: mockNotification });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: "notif-1" },
        data: { isDeleted: true },
      });
    });

    it("should return error on database failure", async () => {
      mockUpdate.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await deleteNotification("notif-1");

      expect(result).toEqual({
        success: false,
        error: "Failed to delete notification",
      });

      consoleSpy.mockRestore();
    });
  });

  describe("markAllNotificationsAsRead", () => {
    it("should throw error when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      await expect(markAllNotificationsAsRead()).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should mark all unread notifications as read", async () => {
      mockUpdateMany.mockResolvedValue({ count: 5 });

      const result = await markAllNotificationsAsRead();

      expect(result).toEqual({ success: true, count: 5 });
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          isRead: false,
          isDeleted: false,
        },
        data: { isRead: true },
      });
    });

    it("should return zero count when no unread notifications", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const result = await markAllNotificationsAsRead();

      expect(result).toEqual({ success: true, count: 0 });
    });

    it("should return error on database failure", async () => {
      mockUpdateMany.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await markAllNotificationsAsRead();

      expect(result).toEqual({
        success: false,
        error: "Failed to update notifications",
      });

      consoleSpy.mockRestore();
    });
  });

  describe("getUnreadNotificationCount", () => {
    it("should return 0 when not authenticated", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await getUnreadNotificationCount();

      expect(result).toBe(0);
    });

    it("should return 0 when user has no id", async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: {} });

      const result = await getUnreadNotificationCount();

      expect(result).toBe(0);
    });

    it("should return unread notification count", async () => {
      mockCount.mockResolvedValue(10);

      const result = await getUnreadNotificationCount();

      expect(result).toBe(10);
      expect(mockCount).toHaveBeenCalledWith({
        where: {
          userId: "user-123",
          isRead: false,
          isDeleted: false,
        },
      });
    });

    it("should return 0 on database error", async () => {
      mockCount.mockRejectedValue(new Error("DB error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await getUnreadNotificationCount();

      expect(result).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe("createUserRegistrationNotification", () => {
    it("should create notification for form registration", async () => {
      mockCreateUserRegistrationNotification.mockResolvedValue(undefined);

      const result = await createUserRegistrationNotification(
        "John Doe",
        "john@example.com",
        "user-456",
        "form"
      );

      expect(result).toEqual({ success: true });
      expect(mockCreateUserRegistrationNotification).toHaveBeenCalledWith(
        "John Doe",
        "john@example.com",
        "user-456",
        "form"
      );
    });

    it("should create notification for SSO registration", async () => {
      mockCreateUserRegistrationNotification.mockResolvedValue(undefined);

      const result = await createUserRegistrationNotification(
        "Jane Doe",
        "jane@example.com",
        "user-789",
        "sso"
      );

      expect(result).toEqual({ success: true });
      expect(mockCreateUserRegistrationNotification).toHaveBeenCalledWith(
        "Jane Doe",
        "jane@example.com",
        "user-789",
        "sso"
      );
    });

    it("should return error on failure", async () => {
      mockCreateUserRegistrationNotification.mockRejectedValue(
        new Error("Notification error")
      );
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await createUserRegistrationNotification(
        "Test User",
        "test@example.com",
        "user-000",
        "form"
      );

      expect(result).toEqual({
        success: false,
        error: "Failed to create notification",
      });

      consoleSpy.mockRestore();
    });
  });
});
