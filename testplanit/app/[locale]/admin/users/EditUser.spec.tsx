import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { EditUserModal } from "./EditUser";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "other-user-id", access: "ADMIN" } },
  }),
}));

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light" }),
}));

// Mock react-select as a simplified component
vi.mock("react-select", () => ({
  default: ({ options, onChange, value, isDisabled }: any) => (
    <div data-testid="react-select" data-disabled={isDisabled}>
      {options?.map((opt: any) => (
        <div key={opt.value} data-option-value={opt.value}>
          {opt.label}
        </div>
      ))}
      {value && Array.isArray(value) && value.map((v: any) => (
        <div key={v.value} data-selected-value={v.value}>
          {v.label}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange && onChange([])}
        data-testid="react-select-clear"
      >
        clear
      </button>
    </div>
  ),
}));

// Mock @tanstack/react-query useQueryClient
const mockRefetchQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQueryClient: () => ({ refetchQueries: mockRefetchQueries }),
  };
});

// Mock multiSelectStyles
vi.mock("~/styles/multiSelectStyles", () => ({
  getCustomStyles: () => ({}),
}));

// Mock HelpPopover to avoid complexity
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

// Mock the hooks
const mockCreateManyProjectAssignment = vi.fn().mockResolvedValue({});
const mockDeleteManyProjectAssignment = vi.fn().mockResolvedValue({});
const mockCreateManyGroupAssignment = vi.fn().mockResolvedValue({});
const mockDeleteManyGroupAssignment = vi.fn().mockResolvedValue({});

vi.mock("~/lib/hooks", () => ({
  useFindManyRoles: () => ({
    data: [{ id: 1, name: "Tester", isDeleted: false }],
  }),
  useFindManyProjects: () => ({
    data: [{ id: 1, name: "Project A", isDeleted: false }],
  }),
  useFindManyGroups: () => ({
    data: [{ id: 1, name: "Group A", isDeleted: false }],
  }),
  useCreateManyProjectAssignment: () => ({
    mutateAsync: mockCreateManyProjectAssignment,
  }),
  useDeleteManyProjectAssignment: () => ({
    mutateAsync: mockDeleteManyProjectAssignment,
  }),
  useCreateManyGroupAssignment: () => ({
    mutateAsync: mockCreateManyGroupAssignment,
  }),
  useDeleteManyGroupAssignment: () => ({
    mutateAsync: mockDeleteManyGroupAssignment,
  }),
}));

// Test user data
const testUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  isActive: true,
  access: "USER" as const,
  roleId: 1,
  isApi: false,
  projects: [{ projectId: 1 }],
  groups: [{ groupId: 1 }],
  // Required Prisma User fields
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerified: null,
  image: null,
  password: null,
  isDeleted: false,
  locale: "en_US" as const,
  theme: "System" as const,
  itemsPerPage: "P25" as const,
  dateFormat: "MM_DD_YYYY_SLASH" as const,
  timeFormat: "HH_MM" as const,
  twoFactorEnabled: false,
  twoFactorSecret: null,
  twoFactorBackupCodes: null,
};

// Helper to wrap component in QueryClientProvider
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const renderWithProvider = (props = { user: testUser as any }) => {
  const queryClient = makeQueryClient();
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <EditUserModal {...props} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
});

describe("EditUserModal", () => {
  test("renders the edit button", () => {
    renderWithProvider();
    // SquarePen icon button
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  test("opens dialog on button click and shows pre-filled name and email", async () => {
    const { user } = renderWithProvider();
    const editButton = screen.getByRole("button");
    await user.click(editButton);

    // Dialog title visible
    expect(
      screen.getByRole("heading", { name: "admin.users.edit.title" })
    ).toBeVisible();

    // Name and email pre-filled
    const nameInput = screen.getByDisplayValue("Test User");
    expect(nameInput).toBeInTheDocument();

    const emailInput = screen.getByDisplayValue("test@example.com");
    expect(emailInput).toBeInTheDocument();
  });

  test("shows validation error when name is empty and form is submitted", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    // Clear the name field
    const nameInput = screen.getByDisplayValue("Test User");
    await user.clear(nameInput);

    const submitButton = screen.getByTestId("edit-user-submit-button");
    await user.click(submitButton);

    // Validation error should appear (renders as a FormMessage <p> element)
    await waitFor(() => {
      expect(
        screen.getByText("common.fields.validation.nameRequired")
      ).toBeInTheDocument();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("submits form and calls fetch with PATCH when form is valid", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    const submitButton = screen.getByTestId("edit-user-submit-button");
    await user.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/users/${testUser.id}`,
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.name).toBe("Test User");
    expect(body.email).toBe("test@example.com");
  });

  test("isActive switch is disabled when editing self", async () => {
    const selfUser = { ...testUser, id: "other-user-id" };
    const { user } = renderWithProvider({ user: selfUser as any });
    await user.click(screen.getByRole("button"));

    // The isActive switch should be disabled when user.id === session.user.id
    // It's a Switch with checked state based on isActive
    await waitFor(() => {
      const switches = screen.getAllByRole("switch");
      // First switch is isActive
      const isActiveSwitch = switches[0];
      expect(isActiveSwitch).toBeDisabled();
    });
  });

  test("closes dialog when cancel is clicked", async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole("button"));

    // Dialog is open
    expect(
      screen.getByRole("heading", { name: "admin.users.edit.title" })
    ).toBeVisible();

    const cancelButton = screen.getByRole("button", {
      name: "common.cancel",
    });
    await user.click(cancelButton);

    // Dialog should be closed
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "admin.users.edit.title" })
      ).not.toBeInTheDocument();
    });
  });
});
