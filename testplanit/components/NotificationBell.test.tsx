import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { NotificationBell } from "./NotificationBell";
import { useSession } from "next-auth/react";
import { useFindManyNotification } from "~/lib/hooks";
import { NotificationType } from "@prisma/client";

// Mock dependencies
vi.mock("next-auth/react");
vi.mock("~/lib/hooks");
vi.mock("~/app/actions/notifications", () => ({
  markNotificationAsRead: vi.fn(),
  markNotificationAsUnread: vi.fn(),
  deleteNotification: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
}));
vi.mock("@/components/NotificationContent", () => ({
  NotificationContent: ({ notification }: any) => (
    <div>
      <h4>{notification.title}</h4>
      <p>{notification.message}</p>
    </div>
  ),
}));
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
  usePathname: () => "/",
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: vi.fn().mockReturnValue(null),
    toString: vi.fn().mockReturnValue(""),
  }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      "title": "Notifications",
      "empty": "No notifications",
      "aria.notifications": `Notifications (${values?.count || 0} unread)`,
      "actions.menu": "Actions",
      "actions.markRead": "Mark as read",
      "actions.markUnread": "Mark as unread",
      "actions.delete": "Delete",
      "actions.markAllRead": "Mark all as read",
      "success.deleted": "Notification deleted",
      "success.markedAllRead": "All notifications marked as read",
      "error.markRead": "Failed to mark as read",
      "error.markUnread": "Failed to mark as unread",
      "error.delete": "Failed to delete notification",
      "error.markAllRead": "Failed to mark all as read",
    };
    return translations[key] || key;
  },
}));

// Mock toast
const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("NotificationBell", () => {
  const mockSession = {
    user: {
      id: "user-123",
      preferences: {
        dateFormat: "MM-DD-YYYY",
        timezone: "UTC",
      },
    },
  };

  const mockNotifications = [
    {
      id: "notif-1",
      title: "Test Notification 1",
      message: "This is test notification 1",
      isRead: false,
      isDeleted: false,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      userId: "user-123",
      type: NotificationType.WORK_ASSIGNED,
      data: {},
      relatedEntityId: null,
      relatedEntityType: null,
    },
    {
      id: "notif-2",
      title: "Test Notification 2",
      message: "This is test notification 2",
      isRead: true,
      isDeleted: false,
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
      userId: "user-123",
      type: NotificationType.WORK_ASSIGNED,
      data: {},
      relatedEntityId: null,
      relatedEntityType: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSession).mockReturnValue({ data: mockSession } as any);
    vi.mocked(useFindManyNotification).mockReturnValue({
      data: mockNotifications,
      refetch: vi.fn(),
    } as any);
  });

  it("should render notification bell with unread count", () => {
    render(<NotificationBell />);

    const bell = screen.getByLabelText("Notifications (1 unread)");
    expect(bell).toBeDefined();

    const badge = screen.getByTestId("notification-count-badge");
    expect(badge.textContent).toBe("1");
  });

  it("should render notification bell button", () => {
    render(<NotificationBell />);

    const button = screen.getByTestId("notification-bell-button");
    expect(button).toBeDefined();
    expect(button.getAttribute("aria-label")).toBe("Notifications (1 unread)");
  });

  it("should show 9+ for more than 9 unread notifications", () => {
    const manyNotifications = Array.from({ length: 15 }, (_, i) => ({
      id: `notif-${i}`,
      title: `Notification ${i}`,
      message: `Message ${i}`,
      isRead: false,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: "user-123",
      type: NotificationType.WORK_ASSIGNED,
      data: {},
      relatedEntityId: null,
      relatedEntityType: null,
    }));

    vi.mocked(useFindManyNotification).mockReturnValue({
      data: manyNotifications,
      refetch: vi.fn(),
    } as any);

    render(<NotificationBell />);

    const badge = screen.getByTestId("notification-count-badge");
    expect(badge.textContent).toBe("9+");
  });

  it("should not show badge when no unread notifications", () => {
    vi.mocked(useFindManyNotification).mockReturnValue({
      data: mockNotifications.map(n => ({ ...n, isRead: true })),
      refetch: vi.fn(),
    } as any);

    render(<NotificationBell />);

    const badge = screen.queryByTestId("notification-count-badge");
    expect(badge).toBeNull();
  });

  it("should query notifications for current user", () => {
    render(<NotificationBell />);

    expect(useFindManyNotification).toHaveBeenCalledWith(
      {
        where: {
          userId: "user-123",
          isDeleted: false,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 20,
      },
      {
        enabled: true,
        refetchInterval: 30000,
        refetchIntervalInBackground: true,
      }
    );
  });

  it("should not query notifications when no session", () => {
    vi.mocked(useSession).mockReturnValue({ data: null } as any);

    render(<NotificationBell />);

    expect(useFindManyNotification).toHaveBeenCalledWith(
      expect.any(Object),
      {
        enabled: false,
        refetchInterval: 30000,
        refetchIntervalInBackground: true,
      }
    );
  });

  it("should handle empty notifications", () => {
    vi.mocked(useFindManyNotification).mockReturnValue({
      data: [],
      refetch: vi.fn(),
    } as any);

    render(<NotificationBell />);

    const bell = screen.getByLabelText("Notifications (0 unread)");
    expect(bell).toBeDefined();

    const badge = screen.queryByTestId("notification-count-badge");
    expect(badge).toBeNull();
  });
});