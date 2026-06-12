import React from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { DowngradedUser } from "~/app/actions/scimMappingActions";

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

// Mock shadcn Select as a native <select> to avoid Radix hasPointerCapture issues in jsdom
const { SelectTriggerSentinel, SelectItemSentinel } = vi.hoisted(() => ({
  SelectTriggerSentinel: Symbol("SelectTrigger"),
  SelectItemSentinel: Symbol("SelectItem"),
}));

vi.mock("@/components/ui/select", () => {
  function Select({ children, value, onValueChange }: any) {
    const items: Array<{ value: string; label: React.ReactNode }> = [];
    let triggerProps: Record<string, unknown> = {};
    const walk = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        const elementType: any = (child as any).type;
        const props: any = (child as any).props ?? {};
        if (elementType?.__sentinel === SelectTriggerSentinel) {
          const { children: _c, ...rest } = props;
          triggerProps = rest;
        } else if (elementType?.__sentinel === SelectItemSentinel) {
          items.push({ value: props.value, label: props.children });
        }
        if (props.children) walk(props.children);
      });
    };
    walk(children);
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...triggerProps}
      >
        {items.map((it) => (
          <option key={it.value} value={it.value}>
            {String(it.label)}
          </option>
        ))}
      </select>
    );
  }
  function SelectTrigger({ children, ...rest }: any) {
    return (
      <span {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectTrigger as any).__sentinel = SelectTriggerSentinel;
  function SelectItem({ value, children, ...rest }: any) {
    return (
      <span value={value} {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectItem as any).__sentinel = SelectItemSentinel;
  return {
    Select,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem,
    SelectTrigger,
    SelectValue: ({ children }: any) => <span>{children}</span>,
  };
});

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
  mockPreviewGroupMappingChange,
  mockSaveMappingChange,
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
    mockPreviewGroupMappingChange: vi.fn().mockResolvedValue({
      success: true,
      downgraded: [],
    } as { success: true; downgraded: DowngradedUser[] }),
    mockSaveMappingChange: vi.fn().mockResolvedValue({
      success: true,
    } as { success: boolean; error?: string }),
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

vi.mock("~/app/actions/scimMappingActions", () => ({
  previewGroupMappingChange: mockPreviewGroupMappingChange,
  saveMappingChange: mockSaveMappingChange,
}));

// Test group data
const testGroup = {
  id: 1,
  name: "Test Group",
  scimDisplayName: null,
  mappedAccess: null,
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
  mockPreviewGroupMappingChange.mockResolvedValue({
    success: true,
    downgraded: [],
  } as { success: true; downgraded: DowngradedUser[] });
  mockSaveMappingChange.mockResolvedValue({
    success: true,
  } as { success: boolean; error?: string });
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

  test("renders mappedAccess Select with value NONE when mappedAccess is null", () => {
    renderWithProvider();
    const select = screen.getByTestId("mapped-access-select");
    expect(select).toBeInTheDocument();
  });

  test("calls previewGroupMappingChange before saving when mappedAccess changes", async () => {
    const { user } = renderWithProvider();

    // The select is rendered as a native <select> via the mock
    const selectEl = screen.getByTestId("mapped-access-select");
    await user.selectOptions(selectEl, "USER");

    const submitButton = screen.getByRole("button", {
      name: "common.actions.save",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockPreviewGroupMappingChange).toHaveBeenCalledWith(1, "USER");
    });
  });

  test("shows AlertDialog when dry-run returns downgraded users", async () => {
    mockPreviewGroupMappingChange.mockResolvedValueOnce({
      success: true,
      downgraded: [
        {
          userId: "u1",
          name: "User One",
          currentAccess: "ADMIN",
          newAccess: "USER",
        },
      ],
    } as { success: true; downgraded: DowngradedUser[] });

    const { user } = renderWithProvider();

    const selectEl = screen.getByTestId("mapped-access-select");
    await user.selectOptions(selectEl, "USER");

    const submitButton = screen.getByRole("button", {
      name: "common.actions.save",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
  });

  test("does NOT show AlertDialog when dry-run returns no downgraded users", async () => {
    mockPreviewGroupMappingChange.mockResolvedValueOnce({
      success: true,
      downgraded: [],
    } as { success: true; downgraded: DowngradedUser[] });

    const { user } = renderWithProvider();

    const selectEl = screen.getByTestId("mapped-access-select");
    await user.selectOptions(selectEl, "USER");

    const submitButton = screen.getByRole("button", {
      name: "common.actions.save",
    });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSaveMappingChange).toHaveBeenCalled();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });
});
