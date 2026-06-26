import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { AddRole } from "./AddRoles";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    if (namespace === "enums.ApplicationArea") {
      return (key: string) => key;
    }
    return (key: string) => (namespace ? `${namespace}.${key}` : key);
  },
}));

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

const { mockCreateRole, mockUpdateManyRoles, mockUpsertRolePermission } =
  vi.hoisted(() => ({
    mockCreateRole: vi.fn().mockResolvedValue({ id: 7 }),
    mockUpdateManyRoles: vi.fn().mockResolvedValue({}),
    mockUpsertRolePermission: vi.fn().mockResolvedValue({}),
  }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    roles: {
      useCreate: () => ({ mutateAsync: mockCreateRole }),
      useUpdateMany: () => ({ mutateAsync: mockUpdateManyRoles }),
    },
    rolePermission: {
      useUpsert: () => ({ mutateAsync: mockUpsertRolePermission }),
    },
  }),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const renderWithProvider = () => {
  const queryClient = makeQueryClient();
  const onClose = vi.fn();
  return {
    user: userEvent.setup(),
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <AddRole open={true} onClose={onClose} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateRole.mockResolvedValue({ id: 7 });
  mockUpdateManyRoles.mockResolvedValue({});
  mockUpsertRolePermission.mockResolvedValue({});
});

describe("AddRole", () => {
  describe("approve column", () => {
    test("renders the Approve column header", async () => {
      renderWithProvider();
      await waitFor(() => {
        expect(
          screen.getByLabelText("common.aria.selectDeselectAllApprove")
        ).toBeInTheDocument();
      });
    });

    test("renders a Switch in rows for TestCaseRepository / TestRuns / Sessions and dash placeholder elsewhere", async () => {
      renderWithProvider();
      await waitFor(() => {
        expect(screen.getByRole("table")).toBeInTheDocument();
      });

      const rows = screen.getAllByRole("row");
      for (const areaName of ["TestCaseRepository", "TestRuns", "Sessions"]) {
        const row = rows.find((r) => {
          if (!r.textContent) return false;
          if (
            areaName === "TestRuns" &&
            r.textContent.includes("ClosedTestRuns")
          )
            return false;
          if (
            areaName === "Sessions" &&
            (r.textContent.includes("ClosedSessions") ||
              r.textContent.includes("SessionsRestrictedFields") ||
              r.textContent.includes("SessionResults"))
          )
            return false;
          return r.textContent.includes(areaName);
        });
        expect(row, `expected row for ${areaName}`).toBeTruthy();
        const approveSwitches = row?.querySelectorAll(
          '[aria-label$="common.permissions.approve"]'
        );
        expect(approveSwitches?.length ?? 0).toBeGreaterThan(0);
      }

      const docRow = rows.find((r) => r.textContent?.includes("Documentation"));
      const docApprove = docRow?.querySelectorAll(
        '[aria-label$="common.permissions.approve"]'
      );
      expect(docApprove?.length ?? 0).toBe(0);
    });

    test("header checkbox toggles canApprove across the three review-relevant areas via handleSelectAll", async () => {
      const { user } = renderWithProvider();
      await waitFor(() => {
        expect(screen.getByRole("table")).toBeInTheDocument();
      });

      const nameInput = screen.getByPlaceholderText("common.name");
      await user.type(nameInput, "Reviewer");

      const approveHeader = screen.getByLabelText(
        "common.aria.selectDeselectAllApprove"
      );
      fireEvent.click(approveHeader);

      const submitButton = screen.getByRole("button", {
        name: "common.actions.submit",
      });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockUpsertRolePermission).toHaveBeenCalled();
      });
      const approvedAreas = mockUpsertRolePermission.mock.calls
        .filter((call) => call[0]?.create?.canApprove === true)
        .map((call) => call[0]?.create?.area as string);
      expect(approvedAreas.sort()).toEqual(
        ["Sessions", "TestCaseRepository", "TestRuns"].sort()
      );
    });

    test("form submit forwards canApprove field for each area to useUpsertRolePermission", async () => {
      const { user } = renderWithProvider();

      const nameInput = screen.getByPlaceholderText("common.name");
      await user.type(nameInput, "Approver");

      const submitButton = screen.getByRole("button", {
        name: "common.actions.submit",
      });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockUpsertRolePermission).toHaveBeenCalled();
      });
      for (const [args] of mockUpsertRolePermission.mock.calls) {
        expect(args.create).toHaveProperty("canApprove");
        expect(typeof args.create.canApprove).toBe("boolean");
      }
    });

    test("header checkbox toggles canReadSensitive across the two Restricted Fields areas via handleSelectAll", async () => {
      const { user } = renderWithProvider();
      await waitFor(() => {
        expect(screen.getByRole("table")).toBeInTheDocument();
      });

      const nameInput = screen.getByPlaceholderText("common.name");
      await user.type(nameInput, "Reader");

      const readSensitiveHeader = screen.getByLabelText(
        "common.aria.selectDeselectAllReadSensitive"
      );
      fireEvent.click(readSensitiveHeader);

      const submitButton = screen.getByRole("button", {
        name: "common.actions.submit",
      });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockUpsertRolePermission).toHaveBeenCalled();
      });
      const grantedAreas = mockUpsertRolePermission.mock.calls
        .filter((call) => call[0]?.create?.canReadSensitive === true)
        .map((call) => call[0]?.create?.area as string);
      expect(grantedAreas.sort()).toEqual(
        ["TestCaseRestrictedFields", "TestRunResultRestrictedFields"].sort()
      );
    });

    test("form submit forwards canReadSensitive field for each area to useUpsertRolePermission", async () => {
      const { user } = renderWithProvider();

      const nameInput = screen.getByPlaceholderText("common.name");
      await user.type(nameInput, "ReadSensitive");

      const submitButton = screen.getByRole("button", {
        name: "common.actions.submit",
      });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockUpsertRolePermission).toHaveBeenCalled();
      });
      for (const [args] of mockUpsertRolePermission.mock.calls) {
        expect(args.create).toHaveProperty("canReadSensitive");
        expect(typeof args.create.canReadSensitive).toBe("boolean");
      }
    });
  });
});
