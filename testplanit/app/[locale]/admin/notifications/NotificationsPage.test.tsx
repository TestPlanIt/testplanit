import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import NotificationSettingsPage from "./page";
import { useSession } from "next-auth/react";
import {
  useFindUniqueAppConfig,
  useCreateAppConfig,
  useUpdateAppConfig,
} from "~/lib/hooks";
import { NotificationMode } from "@prisma/client";

// Mock dependencies
vi.mock("next-auth/react");
vi.mock("~/lib/hooks");
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));
vi.mock("~/app/actions/admin-system-notifications", () => ({
  createSystemNotification: vi.fn(),
  getSystemNotificationHistory: vi.fn().mockResolvedValue({
    success: true,
    notifications: [],
    totalCount: 0,
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      title: "Notification Settings",
      description: "Configure default notification settings",
      "defaultMode.label": "Default Notification Mode",
      "defaultMode.inApp": "In-App Only",
      "defaultMode.inAppEmailImmediate": "In-App + Immediate Email",
      "defaultMode.inAppEmailDaily": "In-App + Daily Digest",
      save: "Save",
      "success.title": "Success",
      "success.description": "Settings saved successfully",
      "error.description": "Failed to save settings",
      "systemNotification.title": "System Notification",
      "systemNotification.description": "Send a notification to all users",
      "systemNotification.titlePlaceholder": "Enter title",
      "systemNotification.messagePlaceholder": "Enter message",
      "systemNotification.send": "Send",
      "systemNotification.history.title": "History",
      "systemNotification.history.empty": "No history",
      "systemNotification.success.title": "Sent",
      "systemNotification.success.description":
        "Notification sent to {count} users",
      "systemNotification.error.description": "Failed to send notification",
      "systemNotification.error.emptyFields": "Please fill in all fields",
      "components.notifications.empty": "None",
      "common.errors.error": "Error",
      "common.actions.saving": "Saving...",
      "common.actions.automated.message": "Message",
      "auth.signin.magicLink.sending": "Sending...",
      "common.loading": "Loading...",
    };
    return translations[key] || key;
  },
}));
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  __esModule: true,
  default: ({ content, onUpdate, placeholder, readOnly }: any) => (
    <div data-testid="tiptap-editor">
      <textarea
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => onUpdate && onUpdate({ content: e.target.value })}
      />
    </div>
  ),
}));
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({ columns, data, isLoading }: any) => (
    <div data-testid="data-table">
      {isLoading ? "Loading..." : `${data.length} items`}
    </div>
  ),
}));
vi.mock("@/components/tables/Pagination", () => ({
  PaginationComponent: () => <div>{"Pagination"}</div>,
}));
vi.mock("@/components/tables/PaginationControls", () => ({
  PaginationInfo: () => <div>{"Pagination Info"}</div>,
}));
vi.mock("~/lib/contexts/PaginationContext", () => ({
  PaginationProvider: ({ children }: any) => <div>{children}</div>,
  usePagination: () => ({
    currentPage: 1,
    setCurrentPage: vi.fn(),
    pageSize: 10,
    setPageSize: vi.fn(),
    totalItems: 0,
    setTotalItems: vi.fn(),
    startIndex: 0,
    endIndex: 0,
    totalPages: 0,
  }),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("Admin Notifications Page - Email Server Configuration", () => {
  const mockAdminSession = {
    user: {
      id: "admin-123",
      access: "ADMIN",
      preferences: {
        dateFormat: "MM-DD-YYYY",
        timezone: "UTC",
      },
    },
  };

  const mockUpdateAppConfig = vi.fn();
  const mockCreateAppConfig = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSession).mockReturnValue({
      data: mockAdminSession,
      status: "authenticated",
    } as any);
    vi.mocked(useFindUniqueAppConfig).mockReturnValue({
      data: {
        key: "notificationSettings",
        value: { defaultMode: NotificationMode.IN_APP },
      },
      isLoading: false,
    } as any);
    vi.mocked(useUpdateAppConfig).mockReturnValue({
      mutate: mockUpdateAppConfig,
      isPending: false,
    } as any);
    vi.mocked(useCreateAppConfig).mockReturnValue({
      mutate: mockCreateAppConfig,
      isPending: false,
    } as any);
  });

  it("should hide email notification options when email server is not configured", async () => {
    // Mock fetch to return email server not configured
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    } as Response);

    render(<NotificationSettingsPage />);

    // Wait for the email server check to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sso/magic-link-status"
      );
    });

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByText("Notification Settings")).toBeDefined();
    });

    // Verify non-email options are visible
    expect(screen.getByLabelText(/None/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App Only/i)).toBeDefined();

    // Verify email options are NOT visible
    expect(screen.queryByLabelText(/In-App \+ Immediate Email/i)).toBeNull();
    expect(screen.queryByLabelText(/In-App \+ Daily Digest/i)).toBeNull();
  });

  it("should show email notification options when email server is configured", async () => {
    // Mock fetch to return email server configured
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    } as Response);

    render(<NotificationSettingsPage />);

    // Wait for the email server check to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sso/magic-link-status"
      );
    });

    // Wait for component to render
    await waitFor(() => {
      expect(screen.getByText("Notification Settings")).toBeDefined();
    });

    // Verify all options are visible including email options
    expect(screen.getByLabelText(/None/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App Only/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App \+ Immediate Email/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App \+ Daily Digest/i)).toBeDefined();
  });

  it("should fallback default mode to IN_APP when email server is not configured and current mode is email-based", async () => {
    // Mock settings with email-based default mode
    vi.mocked(useFindUniqueAppConfig).mockReturnValue({
      data: {
        key: "notificationSettings",
        value: { defaultMode: NotificationMode.IN_APP_EMAIL_IMMEDIATE },
      },
      isLoading: false,
    } as any);

    // Mock fetch to return email server not configured
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    } as Response);

    render(<NotificationSettingsPage />);

    // Wait for the email server check and fallback to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/sso/magic-link-status"
      );
    });

    // The IN_APP radio should be selected after fallback
    await waitFor(() => {
      const inAppRadio = screen.getByRole("radio", {
        name: /In-App Only/i,
      });
      expect(inAppRadio).toHaveAttribute("aria-checked", "true");
    });
  });

  it("should handle email server check failure gracefully", async () => {
    // Mock fetch to fail
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<NotificationSettingsPage />);

    // Wait for error handling
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to check email server configuration:",
        expect.any(Error)
      );
    });

    // Component should still render with default behavior
    expect(screen.getByText("Notification Settings")).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("should redirect non-admin users", () => {
    // Mock non-admin session
    const mockNonAdminSession = {
      user: {
        id: "user-123",
        access: "READ",
      },
    };

    vi.mocked(useSession).mockReturnValue({
      data: mockNonAdminSession,
      status: "authenticated",
    } as any);

    const { container } = render(<NotificationSettingsPage />);

    // Component should not render content for non-admin
    expect(container.textContent).toBe("");
  });
});
