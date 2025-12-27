import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { NotificationBell } from "./NotificationBell";
import { useSession } from "next-auth/react";
import { useFindManyNotification } from "~/lib/hooks";

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

const mockReplace = vi.fn();
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => "/",
}));

const mockSearchParams = {
  get: vi.fn(),
  toString: vi.fn().mockReturnValue("openNotifications=true"),
};
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
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
      "fields.notificationMode": "Notifications",
    };
    return translations[key] || key;
  },
}));

const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("NotificationBell - openNotifications parameter", () => {
  const mockSession = {
    user: {
      id: "user-123",
      preferences: {
        dateFormat: "MM-dd-yyyy",
        timezone: "UTC",
      },
    },
  };

  const mockNotifications = [
    {
      id: "notif-1",
      title: "Test Notification 1",
      message: "Test message 1",
      isRead: false,
      createdAt: new Date(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useSession as any).mockReturnValue({ data: mockSession });
    (useFindManyNotification as any).mockReturnValue({
      data: mockNotifications,
      refetch: vi.fn(),
    });
  });

  it("should open notification panel when openNotifications=true in URL", async () => {
    mockSearchParams.get.mockReturnValue("true");
    
    render(<NotificationBell />);
    
    // Wait for the dropdown to be visible
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
      expect(screen.getByText("Test Notification 1")).toBeInTheDocument();
    });
  });

  it("should remove openNotifications parameter from URL after opening", async () => {
    mockSearchParams.get.mockReturnValue("true");
    
    render(<NotificationBell />);
    
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });

  it("should not open panel when openNotifications parameter is not present", () => {
    mockSearchParams.get.mockReturnValue(null);
    
    render(<NotificationBell />);
    
    // Dropdown should not be visible
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Test Notification 1")).not.toBeInTheDocument();
  });

  it("should preserve other query parameters when removing openNotifications", async () => {
    mockSearchParams.get.mockReturnValue("true");
    mockSearchParams.toString.mockReturnValue("openNotifications=true&someOther=value");
    
    render(<NotificationBell />);
    
    await waitFor(() => {
      // Should be called with the pathname + remaining params
      expect(mockReplace).toHaveBeenCalledWith("/?someOther=value");
    });
  });
});