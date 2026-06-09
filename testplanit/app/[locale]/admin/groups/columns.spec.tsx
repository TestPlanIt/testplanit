import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ExtendedGroups, useColumns } from "./columns";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock GroupNameCell
vi.mock("~/components/tables/GroupNameCell", () => ({
  GroupNameCell: ({ groupId }: { groupId: string }) => (
    <span data-testid={`group-name-cell-${groupId}`}>{groupId}</span>
  ),
}));

// Mock UserListDisplay
vi.mock("@/components/tables/UserListDisplay", () => ({
  UserListDisplay: ({ users }: { users: { userId: string }[] }) => (
    <span data-testid="user-list-display">{users.length} users</span>
  ),
}));

// Mock ProjectListDisplay
vi.mock("@/components/tables/ProjectListDisplay", () => ({
  ProjectListDisplay: ({ projects }: { projects: { projectId: number }[] }) => (
    <span data-testid="project-list-display">{projects.length} projects</span>
  ),
}));

// Both EditGroup and DeleteGroup are no longer rendered inside the cell —
// the cell now renders Buttons that call the onEditGroup/onDeleteGroup
// callback props, so we don't need to mock either modal.

const mockTranslations = ((key: string) => key) as ReturnType<
  typeof import("next-intl").useTranslations<"common">
>;

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderCell(
  columns: ReturnType<typeof useColumns>,
  columnId: string,
  row: ExtendedGroups
) {
  const column = columns.find((c) => c.id === columnId);
  if (!column || !column.cell) {
    throw new Error(`Column "${columnId}" not found or has no cell renderer`);
  }

  const cellFn = column.cell as (info: any) => React.ReactNode;
  const queryClient = makeQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      {cellFn({ row: { original: row } })}
    </QueryClientProvider>
  );
}

const testGroup: ExtendedGroups = {
  id: 1,
  name: "Test Group",
  externalId: null,
  scimDisplayName: null,
  scimExtensions: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  url: null,
  note: null,
  isDeleted: false,
  assignedUsers: [{ userId: "u1" }, { userId: "u2" }],
  projectPermissions: [{ projectId: 10 }, { projectId: 20 }, { projectId: 30 }],
};

const emptyGroup: ExtendedGroups = {
  id: 2,
  name: "Empty Group",
  externalId: null,
  scimDisplayName: null,
  scimExtensions: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  url: null,
  note: null,
  isDeleted: false,
  assignedUsers: [],
  projectPermissions: [],
};

describe("Groups columns", () => {
  const { result } = renderHook(() =>
    useColumns(mockTranslations, mockTranslations as any)
  );
  const columns = result.current;

  describe("column definitions", () => {
    test("returns four columns in order: name, users, projects, actions", () => {
      expect(columns.map((c) => c.id)).toEqual([
        "name",
        "users",
        "projects",
        "actions",
      ]);
    });

    test("name column is pinned left and not hideable", () => {
      const nameCol = columns.find((c) => c.id === "name")!;
      expect(nameCol.enableHiding).toBe(false);
      expect((nameCol.meta as any)?.isPinned).toBe("left");
      expect(nameCol.enableSorting).toBe(true);
    });

    test("projects column is not sortable and is hideable", () => {
      const projectsCol = columns.find((c) => c.id === "projects")!;
      expect(projectsCol.enableSorting).toBe(false);
      expect(projectsCol.enableHiding).not.toBe(false);
    });

    test("actions column is pinned right and not hideable", () => {
      const actionsCol = columns.find((c) => c.id === "actions")!;
      expect(actionsCol.enableHiding).toBe(false);
      expect((actionsCol.meta as any)?.isPinned).toBe("right");
    });
  });

  describe("projects column cell", () => {
    test("renders ProjectListDisplay with project permissions", () => {
      renderCell(columns, "projects", testGroup);

      const display = screen.getByTestId("project-list-display");
      expect(display).toBeInTheDocument();
      expect(display).toHaveTextContent("3 projects");
    });

    test("renders ProjectListDisplay with empty permissions", () => {
      renderCell(columns, "projects", emptyGroup);

      const display = screen.getByTestId("project-list-display");
      expect(display).toBeInTheDocument();
      expect(display).toHaveTextContent("0 projects");
    });
  });

  describe("users column cell", () => {
    test("renders UserListDisplay with assigned users", () => {
      renderCell(columns, "users", testGroup);

      const display = screen.getByTestId("user-list-display");
      expect(display).toBeInTheDocument();
      expect(display).toHaveTextContent("2 users");
    });
  });

  describe("accessorFn", () => {
    test("projects accessorFn returns projectPermissions array", () => {
      const projectsCol = columns.find((c) => c.id === "projects")!;
      const accessorFn = (projectsCol as any).accessorFn;
      expect(accessorFn(testGroup)).toBe(testGroup.projectPermissions);
    });

    test("users accessorFn returns assignedUsers array", () => {
      const usersCol = columns.find((c) => c.id === "users")!;
      const accessorFn = (usersCol as any).accessorFn;
      expect(accessorFn(testGroup)).toBe(testGroup.assignedUsers);
    });
  });
});
