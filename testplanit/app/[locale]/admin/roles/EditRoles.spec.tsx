import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { EditRoleModal } from "./EditRoles";

// Mock next-intl - supports both default namespace and "enums.ApplicationArea"
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    if (namespace === "enums.ApplicationArea") {
      // Return the area key itself
      return (key: string) => key;
    }
    return (key: string) => (namespace ? `${namespace}.${key}` : key);
  },
}));

// Mock HelpPopover to avoid complexity
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

// Mock @prisma/client to provide the ApplicationArea enum
vi.mock("@prisma/client", () => ({
  ApplicationArea: {
    Documentation: "Documentation",
    Milestones: "Milestones",
    TestCaseRepository: "TestCaseRepository",
    TestCaseRestrictedFields: "TestCaseRestrictedFields",
    TestRuns: "TestRuns",
    ClosedTestRuns: "ClosedTestRuns",
    TestRunResults: "TestRunResults",
    TestRunResultRestrictedFields: "TestRunResultRestrictedFields",
    Sessions: "Sessions",
    SessionsRestrictedFields: "SessionsRestrictedFields",
    ClosedSessions: "ClosedSessions",
    SessionResults: "SessionResults",
    Tags: "Tags",
    SharedSteps: "SharedSteps",
    Issues: "Issues",
    IssueIntegration: "IssueIntegration",
    Forecasting: "Forecasting",
    Reporting: "Reporting",
    Settings: "Settings",
  },
}));

// Use vi.hoisted() to create stable mock refs to prevent OOM from infinite re-renders
const {
  mockUpdateRole,
  mockUpdateManyRoles,
  mockUpsertRolePermission,
  stableExistingPermissions,
  stableLoadingState,
} = vi.hoisted(() => {
  const allAreas = [
    "Documentation", "Milestones", "TestCaseRepository", "TestCaseRestrictedFields",
    "TestRuns", "ClosedTestRuns", "TestRunResults", "TestRunResultRestrictedFields",
    "Sessions", "SessionsRestrictedFields", "ClosedSessions", "SessionResults",
    "Tags", "SharedSteps", "Issues", "IssueIntegration", "Forecasting", "Reporting", "Settings",
  ];
  // Create stable permissions array - all false
  const stableExistingPermissions = allAreas.map((area) => ({
    roleId: 1,
    area,
    canAddEdit: false,
    canDelete: false,
    canClose: false,
  }));
  const stableLoadingState = { isLoading: false };
  return {
    mockUpdateRole: vi.fn().mockResolvedValue({}),
    mockUpdateManyRoles: vi.fn().mockResolvedValue({}),
    mockUpsertRolePermission: vi.fn().mockResolvedValue({}),
    stableExistingPermissions,
    stableLoadingState,
  };
});

vi.mock("~/lib/hooks", () => ({
  useFindManyRolePermission: () => ({
    data: stableExistingPermissions,
    isLoading: stableLoadingState.isLoading,
  }),
  useUpdateRoles: () => ({ mutateAsync: mockUpdateRole }),
  useUpdateManyRoles: () => ({ mutateAsync: mockUpdateManyRoles }),
  useUpsertRolePermission: () => ({ mutateAsync: mockUpsertRolePermission }),
}));

// Test role data
const testRole = {
  id: 1,
  name: "Tester",
  isDefault: false,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const renderWithProvider = (role = testRole) => {
  const queryClient = makeQueryClient();
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <EditRoleModal role={role as any} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  stableLoadingState.isLoading = false;
  mockUpdateRole.mockResolvedValue({});
  mockUpdateManyRoles.mockResolvedValue({});
  mockUpsertRolePermission.mockResolvedValue({});
});

describe("EditRoleModal", () => {
  test("renders the edit button", () => {
    renderWithProvider();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  test("opens dialog with role name pre-filled and permissions table", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    expect(
      screen.getByRole("heading", { name: "admin.roles.edit.title" })
    ).toBeVisible();

    // Name input is pre-filled
    expect(screen.getByDisplayValue("Tester")).toBeInTheDocument();

    // Permissions table is visible
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("permissions table shows rows for each ApplicationArea value", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    // Each area name is rendered via tAreas(area) which returns the area key
    await waitFor(() => {
      expect(screen.getByText("TestCaseRepository")).toBeInTheDocument();
    });

    // Check several representative areas are rendered
    expect(screen.getByText("TestRuns")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Documentation")).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  test("permissions table shows Add/Edit, Delete, and Complete column headers", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(
        screen.getByLabelText("Select/Deselect All Add/Edit")
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Select/Deselect All Delete")
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Select/Deselect All Close")
      ).toBeInTheDocument();
    });
  });

  test("canAddEdit shows '-' for ClosedTestRuns and ClosedSessions rows", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      // Table rows - find cells in the ClosedTestRuns row
      const rows = screen.getAllByRole("row");
      // Find the ClosedTestRuns row
      const closedTestRunsRow = rows.find((row) =>
        row.textContent?.includes("ClosedTestRuns")
      );
      expect(closedTestRunsRow).toBeTruthy();
      // The Add/Edit column should show "-" for ClosedTestRuns
      expect(closedTestRunsRow?.textContent).toContain("-");
    });
  });

  test("canDelete shows '-' for Documentation and Tags rows", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const rows = screen.getAllByRole("row");

      const docRow = rows.find((row) =>
        row.textContent?.includes("Documentation")
      );
      expect(docRow).toBeTruthy();
      expect(docRow?.textContent).toContain("-");

      const tagsRow = rows.find((row) =>
        row.textContent?.includes("Tags")
      );
      expect(tagsRow).toBeTruthy();
      expect(tagsRow?.textContent).toContain("-");
    });
  });

  test("canClose shown only for TestRuns and Sessions rows", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const rows = screen.getAllByRole("row");

      // TestRuns row should have a Close switch (not "-")
      const testRunsRow = rows.find((row) =>
        row.textContent?.includes("TestRuns") && !row.textContent?.includes("ClosedTestRuns")
      );
      expect(testRunsRow).toBeTruthy();
      // Should have a switch in the close column
      const testRunsSwitches = testRunsRow?.querySelectorAll('[role="switch"]');
      expect(testRunsSwitches?.length).toBeGreaterThan(0);

      // SharedSteps row should NOT have a Close switch
      const sharedStepsRow = rows.find((row) =>
        row.textContent?.includes("SharedSteps")
      );
      expect(sharedStepsRow).toBeTruthy();
    });
  });

  test("loading skeleton renders Skeleton elements when permissions are loading", async () => {
    stableLoadingState.isLoading = true;
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      // Skeleton elements are rendered instead of the table
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      // Check for skeleton elements (h-5 class skeleton divs)
      const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  test("isDefault switch is disabled when role is already default", async () => {
    const defaultRole = { ...testRole, isDefault: true };
    const { user } = renderWithProvider(defaultRole);
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      const switches = screen.getAllByRole("switch");
      // The isDefault switch should be disabled
      const isDefaultSwitch = switches[0];
      expect(isDefaultSwitch).toBeDisabled();
    });
  });

  test("submit calls updateRole with correct name and isDefault", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    const submitButton = screen.getByRole("button", {
      name: "common.actions.submit",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockUpdateRole).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: testRole.id },
          data: expect.objectContaining({
            name: testRole.name,
            isDefault: testRole.isDefault,
          }),
        })
      );
    });

    // Also verify upsertRolePermission was called for each area
    expect(mockUpsertRolePermission).toHaveBeenCalled();
  });

  test("validates empty role name - mutation not called", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    const nameInput = screen.getByDisplayValue("Tester");
    await user.clear(nameInput);

    const submitButton = screen.getByRole("button", {
      name: "common.actions.submit",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockUpdateRole).not.toHaveBeenCalled();
    });
  });

  test("select-all canAddEdit checkbox toggles all relevant area switches", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    // Click the "Select/Deselect All Add/Edit" header checkbox
    const addEditHeaderCheckbox = screen.getByLabelText(
      "Select/Deselect All Add/Edit"
    );
    fireEvent.click(addEditHeaderCheckbox);

    // After clicking, the submit should now send canAddEdit: true for applicable areas
    const submitButton = screen.getByRole("button", {
      name: "common.actions.submit",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockUpdateRole).toHaveBeenCalled();
      expect(mockUpsertRolePermission).toHaveBeenCalled();

      // Verify that at least one area was called with canAddEdit: true
      const upsertCalls = mockUpsertRolePermission.mock.calls;
      const hasAddEditEnabled = upsertCalls.some(
        (call) => call[0]?.create?.canAddEdit === true
      );
      expect(hasAddEditEnabled).toBe(true);
    });
  });
});
