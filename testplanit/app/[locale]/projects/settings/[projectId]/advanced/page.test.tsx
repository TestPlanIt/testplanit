import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockNotFound = vi.fn();
vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  return {
    ...original,
    notFound: (...args: unknown[]) => {
      mockNotFound(...args);
      throw new Error("NEXT_NOT_FOUND");
    },
    useParams: () => ({ projectId: "42" }),
  };
});

const mockToastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
  },
}));

type SessionLike = { user: { id: string; access: string } } | null;
let currentSession: SessionLike = {
  user: { id: "user-1", access: "ADMIN" },
};
let currentSessionStatus: "loading" | "authenticated" | "unauthenticated" =
  "authenticated";

vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => ({
      data: currentSession,
      status: currentSessionStatus,
      update: vi.fn(),
    }),
  };
});

const mockMutateAsync = vi.fn();
let mockProjectData:
  | {
      id: number;
      reviewWorkflowEnabled: boolean;
      requireResultFlipJustification?: boolean;
      editResultsDurationSeconds?: number | null;
    }
  | undefined = {
  id: 42,
  reviewWorkflowEnabled: true,
};
let mockProjectLoading = false;
// System edit-window AppConfig row (`edit_results_duration`). undefined => no
// system policy.
let mockEditWindowConfig: { value: number } | undefined;

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindUnique: () => ({
    data: mockProjectData,
    isLoading: mockProjectLoading,
  }), useUpdate: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }) },
    appConfig: { useFindUnique: () => ({
    data: mockEditWindowConfig,
  }) },
  }),
}));

let mockSystemEnabled: boolean | undefined = true;
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: () => ({
    systemEnabled: mockSystemEnabled,
    enabled: mockSystemEnabled,
    isLoading: false,
  }),
}));

import AdvancedPage from "./page";

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("AdvancedPage (per-project advanced settings)", () => {
  beforeEach(() => {
    mockNotFound.mockReset();
    mockToastSuccess.mockReset();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({ id: 42, reviewWorkflowEnabled: true });
    currentSession = { user: { id: "user-1", access: "ADMIN" } };
    currentSessionStatus = "authenticated";
    mockProjectData = { id: 42, reviewWorkflowEnabled: true };
    mockProjectLoading = false;
    mockSystemEnabled = true;
    mockEditWindowConfig = undefined;
  });

  it("(a) ADMIN sees the Advanced page", () => {
    render(<AdvancedPage />);
    expect(screen.getByTestId("advanced-settings-page")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("(b) PROJECTADMIN sees the Advanced page", () => {
    currentSession = { user: { id: "user-1", access: "PROJECTADMIN" } };
    render(<AdvancedPage />);
    expect(screen.getByTestId("advanced-settings-page")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("(c) regular user triggers notFound()", () => {
    currentSession = { user: { id: "user-1", access: "USER" } };
    expect(() => render(<AdvancedPage />)).toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("(d) Switch reflects the current value (enabled=true)", () => {
    mockProjectData = { id: 42, reviewWorkflowEnabled: true };
    render(<AdvancedPage />);
    const toggle = screen.getByTestId("review-workflow-toggle");
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("(d2) Switch reflects the current value (enabled=false)", () => {
    mockProjectData = { id: 42, reviewWorkflowEnabled: false };
    render(<AdvancedPage />);
    const toggle = screen.getByTestId("review-workflow-toggle");
    expect(toggle).toHaveAttribute("data-state", "unchecked");
  });

  it("(e) toggling the Switch calls mutateAsync with the new value", async () => {
    mockProjectData = { id: 42, reviewWorkflowEnabled: true };
    render(<AdvancedPage />);
    const toggle = screen.getByTestId("review-workflow-toggle");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { reviewWorkflowEnabled: false },
      });
    });
  });

  it("(e2) result-flip-justification switch reflects the current value", () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      requireResultFlipJustification: true,
    };
    render(<AdvancedPage />);
    const toggle = screen.getByTestId("result-flip-justification-toggle");
    expect(toggle).toHaveAttribute("data-state", "checked");
  });

  it("(e3) toggling override justification calls mutateAsync with the new value", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      requireResultFlipJustification: false,
    };
    render(<AdvancedPage />);
    const toggle = screen.getByTestId("result-flip-justification-toggle");
    expect(toggle).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { requireResultFlipJustification: true },
      });
    });
  });

  it("(g) hides the system-disabled warning when the system flag is ON", () => {
    mockSystemEnabled = true;
    mockProjectData = { id: 42, reviewWorkflowEnabled: true };
    render(<AdvancedPage />);
    expect(
      screen.queryByTestId("review-workflow-system-disabled-warning")
    ).not.toBeInTheDocument();
  });

  it("(h) shows the system-disabled warning when system is OFF and project toggle is ON", () => {
    mockSystemEnabled = false;
    mockProjectData = { id: 42, reviewWorkflowEnabled: true };
    render(<AdvancedPage />);
    expect(
      screen.getByTestId("review-workflow-system-disabled-warning")
    ).toBeInTheDocument();
  });

  it("(i) hides the system-disabled warning when system is OFF and project toggle is OFF", () => {
    mockSystemEnabled = false;
    mockProjectData = { id: 42, reviewWorkflowEnabled: false };
    render(<AdvancedPage />);
    expect(
      screen.queryByTestId("review-workflow-system-disabled-warning")
    ).not.toBeInTheDocument();
  });

  it("(f) shows success toast on resolve", async () => {
    mockProjectData = { id: 42, reviewWorkflowEnabled: false };
    render(<AdvancedPage />);
    const toggle = screen.getByTestId("review-workflow-toggle");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
    });
  });

  it("(ew1) saves an inherited edit window as null", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      editResultsDurationSeconds: null,
    };
    render(<AdvancedPage />);

    fireEvent.click(screen.getByTestId("edit-window-save"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { editResultsDurationSeconds: null },
      });
    });
  });

  it("(ew2) saves a custom window converting minutes to seconds", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      editResultsDurationSeconds: 600, // seeds custom mode at 10 minutes
    };
    render(<AdvancedPage />);

    expect(screen.getByTestId("edit-window-minutes-input")).toHaveValue(10);

    fireEvent.click(screen.getByTestId("edit-window-save"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { editResultsDurationSeconds: 600 },
      });
    });
  });

  it("(ew3) locks the project control when editing is disabled system-wide", () => {
    mockEditWindowConfig = { value: 0 };
    render(<AdvancedPage />);

    expect(
      screen.getByTestId("edit-window-system-locked-warning")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("edit-window-mode-select")
    ).not.toBeInTheDocument();
  });
});
