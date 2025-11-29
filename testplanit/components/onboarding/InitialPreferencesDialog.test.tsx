import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { InitialPreferencesDialog } from "./InitialPreferencesDialog";
import { useSession } from "next-auth/react";
import {
  useFindFirstUserPreferences,
  useUpdateUserPreferences,
} from "~/lib/hooks";
import { useTranslations } from "next-intl";

const mockSetTheme = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindFirstUserPreferences: vi.fn(),
  useUpdateUserPreferences: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: vi.fn((namespace?: string) => {
    return (key: string) => (namespace ? `${namespace}.${key}` : key);
  }),
}));

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "system", setTheme: mockSetTheme })),
}));

const mockUseSession = vi.mocked(useSession);
const mockUseFindFirstUserPreferences = vi.mocked(useFindFirstUserPreferences);
const mockUseUpdateUserPreferences = vi.mocked(useUpdateUserPreferences);

describe("InitialPreferencesDialog", () => {
  beforeEach(() => {
    mockSetTheme.mockClear();

    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
        },
      },
      status: "authenticated",
      update: vi.fn(),
    } as any);

    mockUseFindFirstUserPreferences.mockReturnValue({
      data: {
        id: "pref-1",
        userId: "user-1",
        theme: "Purple",
        locale: "en_US",
        itemsPerPage: "P10",
        dateFormat: "MM_DD_YYYY_DASH",
        timeFormat: "HH_MM_A",
        timezone: "Etc/UTC",
        notificationMode: "USE_GLOBAL",
        emailNotifications: true,
        inAppNotifications: true,
        hasCompletedWelcomeTour: false,
        hasCompletedInitialPreferencesSetup: false,
      },
      refetch: vi.fn(),
      isLoading: false,
    } as any);

    mockUseUpdateUserPreferences.mockReturnValue({
      mutateAsync: vi.fn(),
    } as any);
  });

  it("renders the dialog when preferences are incomplete", async () => {
    render(<InitialPreferencesDialog />);

    expect(
      await screen.findByText("home.initialPreferences.title")
    ).toBeInTheDocument();
  });

  it("does not render when preferences are already completed", () => {
    mockUseFindFirstUserPreferences.mockReturnValue({
      data: {
        id: "pref-1",
        userId: "user-1",
        theme: "Purple",
        locale: "en_US",
        itemsPerPage: "P10",
        dateFormat: "MM_DD_YYYY_DASH",
        timeFormat: "HH_MM_A",
        timezone: "Etc/UTC",
        notificationMode: "USE_GLOBAL",
        emailNotifications: true,
        inAppNotifications: true,
        hasCompletedWelcomeTour: false,
        hasCompletedInitialPreferencesSetup: true,
      },
      refetch: vi.fn(),
      isLoading: false,
    } as any);

    render(<InitialPreferencesDialog />);

    expect(
      screen.queryByText("home.initialPreferences.title")
    ).not.toBeInTheDocument();
  });
});
