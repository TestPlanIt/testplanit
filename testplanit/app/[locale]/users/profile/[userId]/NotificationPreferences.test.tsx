import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { NotificationPreferences } from "./NotificationPreferences";
import { useSession } from "next-auth/react";
import { useFindUniqueAppConfig, useUpdateUserPreferences } from "~/lib/hooks";
import { NotificationMode } from "@prisma/client";

// Mock dependencies
vi.mock("next-auth/react");
vi.mock("~/lib/hooks");
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: any) => {
    const translations: Record<string, string> = {
      "title": "Notification Preferences",
      "description": "Choose how you want to receive notifications",
      "mode.label": "Notification Mode",
      "mode.useGlobal": "Use Global Setting",
      "success.title": "Success",
      "success.description": "Preferences saved successfully",
      "error.description": "Failed to save preferences",
      "common.access.none": "None",
      "admin.notifications.defaultMode.inApp": "In-App Only",
      "admin.notifications.defaultMode.inAppEmailImmediate": "In-App + Immediate Email",
      "admin.notifications.defaultMode.inAppEmailDaily": "In-App + Daily Digest",
      "common.actions.saving": "Saving...",
      "common.actions.save": "Save",
      "common.messages.createError": "Error",
    };
    return translations[key] || key;
  },
}));

// Mock toast
const mockToast = vi.fn();
vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("NotificationPreferences - Email Server Configuration", () => {
  const mockSession = {
    user: {
      id: "user-123",
      preferences: {
        dateFormat: "MM-DD-YYYY",
        timezone: "UTC",
      },
    },
  };

  const mockUserPreferences = {
    id: "pref-123",
    notificationMode: NotificationMode.USE_GLOBAL,
    emailNotifications: false,
    inAppNotifications: true,
  };

  const mockUpdatePreferences = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSession).mockReturnValue({ data: mockSession } as any);
    vi.mocked(useFindUniqueAppConfig).mockReturnValue({
      data: {
        key: "notificationSettings",
        value: { defaultMode: "IN_APP" },
      },
    } as any);
    vi.mocked(useUpdateUserPreferences).mockReturnValue({
      mutate: mockUpdatePreferences,
      isPending: false,
    } as any);
  });

  it("should hide email notification options when email server is not configured", async () => {
    // Mock fetch to return email server not configured
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    } as Response);

    render(
      <NotificationPreferences
        userPreferences={mockUserPreferences}
        userId="user-123"
      />
    );

    // Wait for the email server check to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/sso/magic-link-status");
    });

    // Verify non-email options are visible
    expect(screen.getByLabelText(/Use Global Setting/i)).toBeDefined();
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

    render(
      <NotificationPreferences
        userPreferences={mockUserPreferences}
        userId="user-123"
      />
    );

    // Wait for the email server check to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/sso/magic-link-status");
    });

    // Verify all options are visible including email options
    expect(screen.getByLabelText(/Use Global Setting/i)).toBeDefined();
    expect(screen.getByLabelText(/None/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App Only/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App \+ Immediate Email/i)).toBeDefined();
    expect(screen.getByLabelText(/In-App \+ Daily Digest/i)).toBeDefined();
  });

  it("should fallback email-based notification mode to IN_APP when email server is not configured", async () => {
    // Mock user with email-based notification mode
    const userWithEmailMode = {
      ...mockUserPreferences,
      notificationMode: NotificationMode.IN_APP_EMAIL_IMMEDIATE,
    };

    // Mock fetch to return email server not configured
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    } as Response);

    render(
      <NotificationPreferences
        userPreferences={userWithEmailMode}
        userId="user-123"
      />
    );

    // Wait for the email server check and fallback to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/sso/magic-link-status");
    });

    // The IN_APP radio should be selected after fallback
    await waitFor(() => {
      const inAppRadio = screen.getByRole("radio", { name: /In-App Only/i });
      expect(inAppRadio).toHaveAttribute("aria-checked", "true");
    });
  });

  it("should handle email server check failure gracefully", async () => {
    // Mock fetch to fail
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <NotificationPreferences
        userPreferences={mockUserPreferences}
        userId="user-123"
      />
    );

    // Wait for error handling
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to check email server configuration:",
        expect.any(Error)
      );
    });

    // Component should still render with default behavior (showing email options)
    expect(screen.getByLabelText(/Use Global Setting/i)).toBeDefined();

    consoleSpy.mockRestore();
  });

  it("should not render for other users (not own profile)", () => {
    // Mock different user ID
    render(
      <NotificationPreferences
        userPreferences={mockUserPreferences}
        userId="different-user-456"
      />
    );

    // Component should not render anything
    expect(screen.queryByText(/Notification Preferences/i)).toBeNull();
  });
});
