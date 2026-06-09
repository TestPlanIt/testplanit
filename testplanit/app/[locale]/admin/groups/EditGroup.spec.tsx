import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { EditGroup } from "./EditGroup";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

// Mock HelpPopover to avoid complexity
vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

// Mock UserNameCell
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid={`user-name-cell-${userId}`}>{userId}</span>
  ),
}));

// Mock Combobox
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({
    onValueChange,
    placeholder,
    disabled,
    users,
  }: {
    onValueChange: (value: string | null) => void;
    placeholder?: string;
    disabled?: boolean;
    users?: any[];
  }) => (
    <div data-testid="combobox" data-disabled={disabled}>
      <span>{placeholder}</span>
      {users?.map((u) => (
        <button
          key={u.id}
          type="button"
          data-testid={`combobox-option-${u.id}`}
          onClick={() => onValueChange(u.id)}
        >
          {u.name}
        </button>
      ))}
    </div>
  ),
}));

// Use vi.hoisted() to create stable mock refs to prevent OOM from infinite re-renders
// (new array/object instances per render trigger infinite useEffect loops)
const {
  mockUpdateGroup,
  mockCreateManyGroupAssignment,
  mockDeleteManyGroupAssignment,
  stableAllUsers,
  stableGroupAssignments,
  stableEmptyAssignments,
} = vi.hoisted(() => {
  const stableAllUsers = [
    { id: "u1", name: "User One", isActive: true, isDeleted: false },
  ];
  const stableGroupAssignments = [{ userId: "u1", groupId: 1 }];
  const stableEmptyAssignments: { userId: string; groupId: number }[] = [];
  return {
    mockUpdateGroup: vi.fn().mockResolvedValue({}),
    mockCreateManyGroupAssignment: vi.fn().mockResolvedValue({}),
    mockDeleteManyGroupAssignment: vi.fn().mockResolvedValue({}),
    stableAllUsers,
    stableGroupAssignments,
    stableEmptyAssignments,
  };
});

// Track which assignment data variant to use per test
let useEmptyAssignments = false;

vi.mock("~/lib/hooks", () => ({
  useUpdateGroups: () => ({ mutateAsync: mockUpdateGroup }),
  useFindManyUser: () => ({
    data: stableAllUsers,
    isLoading: false,
  }),
  useFindManyGroupAssignment: () => ({
    data: useEmptyAssignments ? stableEmptyAssignments : stableGroupAssignments,
    isLoading: false,
  }),
  useCreateManyGroupAssignment: () => ({
    mutateAsync: mockCreateManyGroupAssignment,
  }),
  useDeleteManyGroupAssignment: () => ({
    mutateAsync: mockDeleteManyGroupAssignment,
  }),
}));

// Test group data
const testGroup = {
  id: 1,
  name: "Test Group",
  scimDisplayName: null,
  isDeleted: false,
  assignedUsers: [{ userId: "u1" }],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const renderWithProvider = (group = testGroup) => {
  const queryClient = makeQueryClient();
  const onClose = vi.fn();
  return {
    user: userEvent.setup(),
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <EditGroup group={group as any} open={true} onClose={onClose} />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  useEmptyAssignments = false;
  mockUpdateGroup.mockResolvedValue({});
  mockCreateManyGroupAssignment.mockResolvedValue({});
  mockDeleteManyGroupAssignment.mockResolvedValue({});
});

describe("EditGroup", () => {
  test("renders dialog with group name pre-filled", () => {
    renderWithProvider();
    expect(
      screen.getByRole("heading", { name: "admin.groups.edit.title" })
    ).toBeVisible();
    // Name input is pre-filled
    expect(screen.getByDisplayValue("Test Group")).toBeInTheDocument();
  });

  test("shows assigned users list when loaded", async () => {
    renderWithProvider();
    await waitFor(() => {
      // UserNameCell renders userId as text
      expect(screen.getByTestId("user-name-cell-u1")).toBeInTheDocument();
    });
  });

  test("shows no users assigned message when assignment list is empty", async () => {
    useEmptyAssignments = true;
    const emptyGroup = { ...testGroup, assignedUsers: [] };
    renderWithProvider(emptyGroup as any);
    await waitFor(() => {
      expect(
        screen.getByText("admin.groups.noUsersAssigned")
      ).toBeInTheDocument();
    });
  });

  test("validates empty group name on submit - mutation not called", async () => {
    const { user } = renderWithProvider();

    const nameInput = screen.getByDisplayValue("Test Group");
    await user.clear(nameInput);

    const submitButton = screen.getByRole("button", {
      name: "common.actions.save",
    });
    await user.click(submitButton);

    // Validation error means mutation should not be called
    await waitFor(() => {
      expect(mockUpdateGroup).not.toHaveBeenCalled();
    });
  });

  test("remove user button removes user from assigned list", async () => {
    const { user } = renderWithProvider();

    // User should be displayed
    await waitFor(() => {
      expect(screen.getByTestId("user-name-cell-u1")).toBeInTheDocument();
    });

    // Click the delete button for the user
    const deleteButton = screen.getByRole("button", {
      name: "common.actions.delete",
    });
    await user.click(deleteButton);

    // User should be removed from the list
    await waitFor(() => {
      expect(screen.queryByTestId("user-name-cell-u1")).not.toBeInTheDocument();
    });
  });

  test("submit calls updateGroup with correct data", async () => {
    const { user } = renderWithProvider();

    const submitButton = screen.getByRole("button", {
      name: "common.actions.save",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith({
        where: { id: testGroup.id },
        data: { name: testGroup.name },
      });
    });
  });
});
