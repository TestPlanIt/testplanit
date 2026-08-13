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
      abandonedRunIdleMinutes?: number | null;
      abandonedRunStateId?: number | null;
    }
  | undefined = {
  id: 42,
  reviewWorkflowEnabled: true,
};
let mockProjectLoading = false;
// System edit-window AppConfig row (`edit_results_duration`). undefined => no
// system policy.
let mockEditWindowConfig: { value: number } | undefined;
// System abandoned-run AppConfig row (`abandoned_run_idle_minutes`).
// undefined => sweeping off by default.
let mockAbandonedRunConfig: { value: number } | undefined;
// RUNS workflow states assigned to the project (abandoned-run target picker).
let mockRunWorkflows: Array<{ id: number; name: string }> = [];

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindUnique: () => ({
        data: mockProjectData,
        isLoading: mockProjectLoading,
      }),
      // Live project-code uniqueness check (record-keys feature).
      useFindFirst: () => ({
        data: null,
        isFetching: false,
      }),
      useUpdate: () => ({
        mutateAsync: mockMutateAsync,
        isPending: false,
      }),
    },
    appConfig: {
      // Both the edit-window and abandoned-run system rows resolve through
      // this hook; return the row matching the queried key.
      useFindUnique: (args: { where: { key: string } }) => ({
        data:
          args?.where?.key === "abandoned_run_idle_minutes"
            ? mockAbandonedRunConfig
            : mockEditWindowConfig,
      }),
    },
    workflows: {
      // RUNS-state picker for the abandoned-run target state.
      useFindMany: () => ({
        data: mockRunWorkflows,
      }),
    },
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

// The page's access gate is `isProjectAdmin` — the server's own
// `authorizeProjectAdminForProject` resolution, surfaced through this hook —
// not the raw session access level.
let mockIsProjectAdmin = true;
let mockPermissionsLoading = false;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: { canAddEdit: false, canDelete: false, canClose: false },
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: mockPermissionsLoading,
    error: null,
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
    mockAbandonedRunConfig = undefined;
    mockRunWorkflows = [];
    mockIsProjectAdmin = true;
    mockPermissionsLoading = false;
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
    mockIsProjectAdmin = false;
    expect(() => render(<AdvancedPage />)).toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("(c2) a USER holding the per-project Project Admin role sees the page", () => {
    // Project creators and "Project Admin" role holders are system USERs but
    // carry project-admin authority; the settings APIs already accept them.
    currentSession = { user: { id: "user-1", access: "USER" } };
    mockIsProjectAdmin = true;
    render(<AdvancedPage />);
    expect(screen.getByTestId("advanced-settings-page")).toBeInTheDocument();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("(c3) waits for the permission resolution before deciding", () => {
    currentSession = { user: { id: "user-1", access: "USER" } };
    mockIsProjectAdmin = false;
    mockPermissionsLoading = true;
    render(<AdvancedPage />);
    expect(mockNotFound).not.toHaveBeenCalled();
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

  it("(ar1) saves an inherited abandoned-run threshold as null with automatic state", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      abandonedRunIdleMinutes: null,
      abandonedRunStateId: null,
    };
    render(<AdvancedPage />);

    fireEvent.click(screen.getByTestId("abandoned-runs-save"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { abandonedRunIdleMinutes: null, abandonedRunStateId: null },
      });
    });
  });

  it("(ar2) seeds custom mode from the project override and keeps the configured target state", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      abandonedRunIdleMinutes: 720,
      abandonedRunStateId: 7,
    };
    mockRunWorkflows = [{ id: 7, name: "Aborted" }];
    render(<AdvancedPage />);

    expect(screen.getByTestId("abandoned-runs-minutes-input")).toHaveValue(720);

    fireEvent.click(screen.getByTestId("abandoned-runs-save"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { abandonedRunIdleMinutes: 720, abandonedRunStateId: 7 },
      });
    });
  });

  it("(ar4) rejects a custom threshold below the 15-minute minimum", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      abandonedRunIdleMinutes: 720,
      abandonedRunStateId: null,
    };
    render(<AdvancedPage />);

    fireEvent.change(screen.getByTestId("abandoned-runs-minutes-input"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByTestId("abandoned-runs-save"));

    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
  });

  it("(ar3) saves a project opt-out as 0 and hides the state picker", async () => {
    mockProjectData = {
      id: 42,
      reviewWorkflowEnabled: true,
      abandonedRunIdleMinutes: 0,
      abandonedRunStateId: null,
    };
    render(<AdvancedPage />);

    expect(
      screen.queryByTestId("abandoned-runs-state-select")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("abandoned-runs-save"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { abandonedRunIdleMinutes: 0, abandonedRunStateId: null },
      });
    });
  });
});
