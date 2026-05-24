import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

const mockMutateAsync = vi.fn();
let mockMutationPending = false;
vi.mock("~/lib/hooks", () => ({
  useUpsertAppConfig: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockMutationPending,
  }),
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQueryClient: () => ({
      invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
    }),
  };
});

type SessionLike = { user: { id: string; access: string } } | null;
let currentSession: SessionLike = {
  user: { id: "user-1", access: "ADMIN" },
};
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => ({
      data: currentSession,
      status: "authenticated" as const,
      update: vi.fn(),
    }),
  };
});

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// PaginationProvider depends on next-intl navigation context; render its
// children as-is so SystemFeatureCard mounts in tests.
vi.mock("~/lib/contexts/PaginationContext", () => ({
  PaginationProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Stub the project list — tests assert presence via this marker, not full
// child behavior (the list has its own test file).
vi.mock("./ProjectReviewToggleList", () => ({
  ProjectReviewToggleList: () => (
    <div data-testid="project-review-toggle-list-stub" />
  ),
}));

import React from "react";
import { SystemFeatureCard } from "./SystemFeatureCard";

describe("SystemFeatureCard (AppConfig-backed)", () => {
  beforeEach(() => {
    mockUseReviewFeatureEnabled.mockReset();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({});
    mockInvalidateQueries.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockMutationPending = false;
    currentSession = { user: { id: "user-1", access: "ADMIN" } };
  });

  it("(a) Switch reflects enabled state when systemEnabled is true", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    expect(screen.getByTestId("system-feature-card")).toBeInTheDocument();
    const toggle = screen.getByTestId("system-feature-toggle");
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("(b) Switch reflects disabled state when systemEnabled is false", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: false,
      enabled: false,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const toggle = screen.getByTestId("system-feature-toggle");
    expect(toggle).toHaveAttribute("data-state", "unchecked");
  });

  it("(c) Switch is enabled for ADMIN users", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const toggle = screen.getByTestId("system-feature-toggle");
    expect(toggle).not.toBeDisabled();
  });

  it("(d) Switch is disabled (and admin-only notice shows) for non-ADMIN users", () => {
    currentSession = { user: { id: "user-2", access: "USER" } };
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const toggle = screen.getByTestId("system-feature-toggle");
    expect(toggle).toBeDisabled();

    expect(
      screen.getByTestId("system-feature-admin-only-notice")
    ).toBeInTheDocument();
  });

  it("(e) Switch is disabled while loading", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: undefined,
      enabled: undefined,
      isLoading: true,
    });

    render(<SystemFeatureCard />);

    const toggle = screen.getByTestId("system-feature-toggle");
    expect(toggle).toBeDisabled();
  });

  it("(f) Switch is disabled while the mutation is in flight", () => {
    mockMutationPending = true;
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const toggle = screen.getByTestId("system-feature-toggle");
    expect(toggle).toBeDisabled();
  });

  it("(g) toggling ON -> OFF fires upsert with value: false, invalidates the query, and toasts success", async () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const toggle = screen.getByTestId("system-feature-toggle");
    fireEvent.click(toggle);

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      where: { key: "review_feature_enabled" },
      create: { key: "review_feature_enabled", value: false },
      update: { value: false },
    });

    await waitFor(() =>
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ["config", "review-feature"],
      })
    );
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("(h) toggling OFF -> ON fires upsert with value: true", async () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: false,
      enabled: false,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    fireEvent.click(screen.getByTestId("system-feature-toggle"));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { key: "review_feature_enabled" },
        create: { key: "review_feature_enabled", value: true },
        update: { value: true },
      })
    );
  });

  it("(i) mutation failure surfaces an error toast (no success toast)", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error("boom"));
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    fireEvent.click(screen.getByTestId("system-feature-toggle"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("(k) renders the project review toggle list when admin + system flag is ON", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    expect(
      screen.getByTestId("project-review-toggle-list-stub")
    ).toBeInTheDocument();
  });

  it("(l) hides the project review toggle list when admin but system flag is OFF", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: false,
      enabled: false,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    expect(
      screen.queryByTestId("project-review-toggle-list-stub")
    ).not.toBeInTheDocument();
  });

  it("(m) hides the project review toggle list for non-admin users (admin notice replaces it)", () => {
    currentSession = { user: { id: "user-2", access: "USER" } };
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    expect(
      screen.queryByTestId("project-review-toggle-list-stub")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("system-feature-admin-only-notice")
    ).toBeInTheDocument();
  });

  it("(j) no env-var name leaks into the rendered DOM", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    const { container } = render(<SystemFeatureCard />);
    expect(container.textContent ?? "").not.toContain(
      "TESTPLANIT_REVIEW_FEATURE_ENABLED"
    );
  });
});
