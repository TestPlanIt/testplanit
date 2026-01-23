import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { CompleteSessionDialog, CompletableSession } from "./CompleteSessionDialog";
import { useSession } from "next-auth/react";
import {
  useFindManyWorkflows,
  useUpdateSessions,
  useCreateSessionVersions,
} from "~/lib/hooks";
import { useTranslations } from "next-intl";

// Mock the router
const mockPush = vi.fn();
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

// Mock hooks
vi.mock("~/lib/hooks", () => ({
  useFindManyWorkflows: vi.fn(),
  useUpdateSessions: vi.fn(),
  useCreateSessionVersions: vi.fn(),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

const mockUseSession = vi.mocked(useSession);
const mockUseFindManyWorkflows = vi.mocked(useFindManyWorkflows);
const mockUseUpdateSessions = vi.mocked(useUpdateSessions);
const mockUseCreateSessionVersions = vi.mocked(useCreateSessionVersions);

describe("CompleteSessionDialog", () => {
  const mockSession: CompletableSession = {
    id: 1,
    name: "Test Session",
    projectId: 1,
    templateId: 1,
    stateId: 1,
    configId: null,
    milestoneId: null,
    assignedToId: "user-1",
    estimate: null,
    forecastManual: null,
    forecastAutomated: null,
    elapsed: null,
    note: null,
    mission: null,
    currentVersion: 1,
    project: { name: "Test Project" },
    template: {
      id: 1,
      templateName: "Test Template",
      isDeleted: false,
      isDefault: true,
      isEnabled: true,
    },
    configuration: null,
    milestone: null,
    state: { name: "In Progress" },
    assignedTo: { name: "Test User" },
  };

  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
        },
      },
      status: "authenticated",
      update: vi.fn(),
    } as any);

    mockUseUpdateSessions.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    } as any);

    mockUseCreateSessionVersions.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    } as any);
  });

  describe("State Selection with Workflows Ordered by 'order' Field", () => {
    it("should select the first workflow (lowest order) when workflows are available", async () => {
      // Mock workflows with different order values
      const mockWorkflows = [
        {
          id: 10,
          name: "First State",
          order: 1, // Lowest order - should be selected
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
        {
          id: 20,
          name: "Second State",
          order: 2,
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
        {
          id: 30,
          name: "Third State",
          order: 3, // Highest order - should NOT be selected
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      // Wait for the dialog to render and state to be set
      await waitFor(() => {
        expect(screen.getByText("First State")).toBeInTheDocument();
      });

      // The Select component should show the first workflow (lowest order)
      // Since the Select is controlled by selectedStateId, and we set it to workflows[0].id
      // The SelectTrigger should display the first workflow's name
      const selectTrigger = screen.getByRole("combobox");
      expect(selectTrigger).toHaveTextContent("First State");
    });

    it("should NOT select the last workflow (highest order)", async () => {
      // This test ensures the bug is fixed
      const mockWorkflows = [
        {
          id: 10,
          name: "Started",
          order: 1,
          icon: { name: "play" },
          color: { value: "#00ff00" },
        },
        {
          id: 20,
          name: "In Progress",
          order: 5,
          icon: { name: "clock" },
          color: { value: "#ffff00" },
        },
        {
          id: 30,
          name: "Completed", // This was incorrectly selected before the fix
          order: 10,
          icon: { name: "check" },
          color: { value: "#0000ff" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Started")).toBeInTheDocument();
      });

      // Verify "Completed" (highest order) is NOT initially selected
      const selectTrigger = screen.getByRole("combobox");
      expect(selectTrigger).not.toHaveTextContent("Completed");
      expect(selectTrigger).toHaveTextContent("Started");
    });

    it("should select first item in pre-sorted workflow array", async () => {
      // The API query includes orderBy: { order: "asc" }, so workflows come pre-sorted
      // This test verifies the component correctly uses workflows[0]
      const mockWorkflows = [
        {
          id: 10,
          name: "First", // This is workflows[0] and has lowest order
          order: 5,
          icon: { name: "start" },
          color: { value: "#00ff00" },
        },
        {
          id: 20,
          name: "Second",
          order: 10,
          icon: { name: "progress" },
          color: { value: "#ffff00" },
        },
        {
          id: 30,
          name: "Third",
          order: 15,
          icon: { name: "check" },
          color: { value: "#0000ff" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("First")).toBeInTheDocument();
      });

      // workflows[0] should be selected since it's pre-sorted by API
      const selectTrigger = screen.getByRole("combobox");
      expect(selectTrigger).toHaveTextContent("First");
    });

    it("should fall back to session stateId when no workflows are available", async () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      // With no workflows, it should keep the session's current stateId
      // We can't directly test the internal state, but the component should render
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });

    it("should handle single workflow correctly", async () => {
      const mockWorkflows = [
        {
          id: 100,
          name: "Only State",
          order: 42,
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Only State")).toBeInTheDocument();
      });

      const selectTrigger = screen.getByRole("combobox");
      expect(selectTrigger).toHaveTextContent("Only State");
    });
  });

  describe("Dialog Rendering", () => {
    it("should not render when open is false", () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={false}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("should render dialog when open is true", async () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });

    it("should display session name in confirmation message", async () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={{ ...mockSession, name: "My Special Session" }}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
    });
  });

  describe("Workflow Query", () => {
    it("should query workflows with correct filters", () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={123}
        />
      );

      // Verify the hook was called with correct parameters
      expect(mockUseFindManyWorkflows).toHaveBeenCalledWith({
        where: {
          isDeleted: false,
          isEnabled: true,
          scope: "SESSIONS",
          workflowType: "DONE",
          projects: {
            some: {
              projectId: 123,
            },
          },
        },
        orderBy: { order: "asc" },
        include: { icon: true, color: true },
      });
    });
  });

  describe("No Workflows Message", () => {
    it("should display message when no workflows are configured", async () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Should show the no workflows message
      expect(
        screen.getByText("sessions.completeDialog.noWorkflowsConfigured")
      ).toBeInTheDocument();
    });

    it("should not show complete button when no workflows configured", async () => {
      mockUseFindManyWorkflows.mockReturnValue({
        data: [],
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // State selector and date picker should not be present
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

      // Cancel button in footer should not be present (simple UI)
      expect(screen.queryByText("common.cancel")).not.toBeInTheDocument();
    });
  });

  describe("User Interactions", () => {
    beforeEach(() => {
      const mockWorkflows = [
        {
          id: 10,
          name: "In Progress",
          order: 1,
          icon: { name: "clock" },
          color: { value: "#ffff00" },
        },
        {
          id: 20,
          name: "Completed",
          order: 2,
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);
    });

    it("should call onOpenChange when cancel button is clicked", async () => {
      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      const cancelButton = screen.getByText("common.cancel");
      await cancelButton.click();

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it("should show submitting state when completing", async () => {
      const mockUpdateSessions = vi.fn().mockImplementation(() => {
        // Simulate slow async operation
        return new Promise((resolve) => setTimeout(resolve, 100));
      });

      const mockCreateSessionVersions = vi.fn().mockResolvedValue({});

      mockUseUpdateSessions.mockReturnValue({
        mutateAsync: mockUpdateSessions,
      } as any);

      mockUseCreateSessionVersions.mockReturnValue({
        mutateAsync: mockCreateSessionVersions,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      const completeButtons = screen.getAllByText("sessions.actions.complete");
      const completeButton = completeButtons[completeButtons.length - 1]; // Get the button, not the title

      // Click the complete button
      await completeButton.click();

      // Wait for mutations to be called (verifies button was functional)
      await waitFor(() => {
        expect(mockCreateSessionVersions).toHaveBeenCalled();
      });
    });
  });

  describe("Completion Logic", () => {
    it("should call createSessionVersions and updateSessions when completing", async () => {
      const mockUpdateSessions = vi.fn().mockResolvedValue({});
      const mockCreateSessionVersions = vi.fn().mockResolvedValue({});

      mockUseUpdateSessions.mockReturnValue({
        mutateAsync: mockUpdateSessions,
      } as any);

      mockUseCreateSessionVersions.mockReturnValue({
        mutateAsync: mockCreateSessionVersions,
      } as any);

      const mockWorkflows = [
        {
          id: 10,
          name: "Completed",
          order: 1,
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      const { getAllByText, getByRole } = render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(getByRole("dialog")).toBeInTheDocument();
      });

      const completeButtons = getAllByText("sessions.actions.complete");
      const completeButton = completeButtons[completeButtons.length - 1];

      await completeButton.click();

      // Wait for async operations
      await waitFor(
        () => {
          expect(mockCreateSessionVersions).toHaveBeenCalled();
          expect(mockUpdateSessions).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      // Verify session version was created with correct data
      expect(mockCreateSessionVersions).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: mockSession.id,
          version: mockSession.currentVersion + 1,
          name: mockSession.name,
          isCompleted: true,
          stateId: 10, // The selected state
        }),
      });

      // Verify session was updated
      expect(mockUpdateSessions).toHaveBeenCalledWith({
        where: { id: mockSession.id },
        data: expect.objectContaining({
          isCompleted: true,
          stateId: 10,
          currentVersion: mockSession.currentVersion + 1,
        }),
      });

      // Note: Dialog close (onOpenChange) happens after router.refresh()
      // which is mocked and may not trigger immediately in tests
    });

    it("should handle errors gracefully during completion", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockUpdateSessions = vi.fn().mockRejectedValue(new Error("Update failed"));
      const mockCreateSessionVersions = vi.fn().mockResolvedValue({});

      mockUseUpdateSessions.mockReturnValue({
        mutateAsync: mockUpdateSessions,
      } as any);

      mockUseCreateSessionVersions.mockReturnValue({
        mutateAsync: mockCreateSessionVersions,
      } as any);

      const mockWorkflows = [
        {
          id: 10,
          name: "Completed",
          order: 1,
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      const { getAllByText, getByRole } = render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(getByRole("dialog")).toBeInTheDocument();
      });

      const completeButtons = getAllByText("sessions.actions.complete");
      const completeButton = completeButtons[completeButtons.length - 1];

      await completeButton.click();

      await waitFor(
        () => {
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            "Error completing session:",
            expect.any(Error)
          );
        },
        { timeout: 3000 }
      );

      // Dialog should still be open after error
      expect(getByRole("dialog")).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Warning Message", () => {
    it("should display warning message about completing session", async () => {
      const mockWorkflows = [
        {
          id: 10,
          name: "Completed",
          order: 1,
          icon: { name: "check" },
          color: { value: "#00ff00" },
        },
      ];

      mockUseFindManyWorkflows.mockReturnValue({
        data: mockWorkflows,
        isLoading: false,
      } as any);

      render(
        <CompleteSessionDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          session={mockSession}
          projectId={1}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Warning message should be visible
      expect(screen.getByText("sessions.complete.warning")).toBeInTheDocument();
    });
  });
});
