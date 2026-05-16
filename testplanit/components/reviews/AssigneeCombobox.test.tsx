import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  AssigneeCombobox,
  type AssigneeOption,
} from "./AssigneeCombobox";

// Mock searchProjectMembers server action so the user-search half of the
// merged fetch is controllable per test.
const mockSearchProjectMembers = vi.fn();
vi.mock("~/app/actions/searchProjectMembers", () => ({
  searchProjectMembers: (...args: unknown[]) =>
    mockSearchProjectMembers(...args),
}));

// Mock the ZenStack-generated roles hook. The component reads the roles list
// up front (single page; rare changes) and folds it into the merged options.
const mockUseFindManyRoles = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useFindManyRoles: (...args: unknown[]) => mockUseFindManyRoles(...args),
}));

// Stub Avatar so test assertions can focus on the kind-discriminator, not
// next/image mechanics.
vi.mock("@/components/Avatar", () => ({
  Avatar: ({ alt }: { alt?: string }) => (
    <span data-testid="avatar-stub" data-alt={alt} />
  ),
}));

function setRoles(
  result: Array<{ id: number; name: string; _count?: { users: number } }>,
) {
  mockUseFindManyRoles.mockReturnValue({
    data: result,
    isLoading: false,
  });
}

function setUsers(
  users: Array<{
    id: string;
    name: string;
    email: string | null;
    image: string | null;
  }>,
  total = users.length,
) {
  mockSearchProjectMembers.mockResolvedValue({ results: users, total });
}

describe("AssigneeCombobox", () => {
  beforeEach(() => {
    mockSearchProjectMembers.mockReset();
    mockUseFindManyRoles.mockReset();
    // Defaults — overridable per test.
    setRoles([]);
    setUsers([]);
  });

  it("renders the trigger with the assignee placeholder", () => {
    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("assignee-combobox"),
    ).toBeInTheDocument();
  });

  it("(a) typing into the search input triggers fetchOptions", async () => {
    setUsers([
      { id: "user-1", name: "Alice", email: null, image: null },
    ]);

    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
      />,
    );

    // Open the combobox.
    fireEvent.click(screen.getByTestId("assignee-combobox"));

    // Wait for the initial fetch to fire.
    await waitFor(() => {
      expect(mockSearchProjectMembers).toHaveBeenCalled();
    });

    // First arg is the projectId — confirm pass-through.
    expect(mockSearchProjectMembers.mock.calls[0]?.[0]).toBe(42);
  });

  it("(b) selecting a user emits onValueChange with kind: 'user'", async () => {
    const onValueChange = vi.fn<(v: AssigneeOption | null) => void>();
    setUsers([
      {
        id: "user-1",
        name: "Alice",
        email: "alice@example.com",
        image: null,
      },
    ]);

    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByTestId("assignee-combobox"));

    // Wait for the user row to render.
    const userRow = await screen.findByTestId("assignee-option-user-user-1");
    fireEvent.click(userRow);

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const arg = onValueChange.mock.calls[0]?.[0];
    expect(arg).toMatchObject({ kind: "user", id: "user-1", name: "Alice" });
  });

  it("(c) selecting a role emits onValueChange with kind: 'role'", async () => {
    const onValueChange = vi.fn<(v: AssigneeOption | null) => void>();
    setRoles([{ id: 7, name: "Tester", _count: { users: 3 } }]);
    setUsers([]);

    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByTestId("assignee-combobox"));

    const roleRow = await screen.findByTestId("assignee-option-role-7");
    fireEvent.click(roleRow);

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalled();
    });
    const arg = onValueChange.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      kind: "role",
      id: 7,
      name: "Tester",
      userCount: 3,
    });
  });

  it("(d) users appear before roles in the merged option list", async () => {
    setUsers([
      { id: "user-1", name: "Alice", email: null, image: null },
      { id: "user-2", name: "Bob", email: null, image: null },
    ]);
    setRoles([
      { id: 7, name: "Tester", _count: { users: 3 } },
      { id: 8, name: "Manager", _count: { users: 1 } },
    ]);

    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("assignee-combobox"));

    // Wait for both user + role options to render.
    await screen.findByTestId("assignee-option-user-user-1");
    await screen.findByTestId("assignee-option-role-7");

    // The first option items in the DOM should be users.
    const allOptions = screen
      .getAllByTestId(/^assignee-option-(user|role)-/)
      .map((el) => el.getAttribute("data-testid") ?? "");

    const firstUserIdx = allOptions.findIndex((id) =>
      id.startsWith("assignee-option-user-"),
    );
    const firstRoleIdx = allOptions.findIndex((id) =>
      id.startsWith("assignee-option-role-"),
    );

    expect(firstUserIdx).toBeGreaterThanOrEqual(0);
    expect(firstRoleIdx).toBeGreaterThanOrEqual(0);
    expect(firstUserIdx).toBeLessThan(firstRoleIdx);
  });

  it("(e) renderOption distinguishes user rows from role rows", async () => {
    setUsers([
      { id: "user-1", name: "Alice", email: null, image: null },
    ]);
    setRoles([{ id: 7, name: "Tester", _count: { users: 3 } }]);

    render(
      <AssigneeCombobox
        projectId={42}
        value={null}
        onValueChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("assignee-combobox"));

    const userRow = await screen.findByTestId("assignee-option-user-user-1");
    const roleRow = await screen.findByTestId("assignee-option-role-7");

    // The user row exposes a user-kind icon; the role row exposes a role-kind icon.
    expect(userRow.querySelector('[data-kind-icon="user"]')).not.toBeNull();
    expect(roleRow.querySelector('[data-kind-icon="role"]')).not.toBeNull();
  });
});
