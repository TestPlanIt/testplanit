import { fireEvent, render, screen } from "@testing-library/react";
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

type SessionLike = { user: { id: string; access: string } } | null;
let currentSession: SessionLike = {
  user: { id: "user-1", access: "ADMIN" },
};
let currentSessionStatus: "loading" | "authenticated" | "unauthenticated" =
  "authenticated";

// The virtualized DataTable's row windowing needs layout jsdom cannot give it;
// render every row instead (same pass-through as DataTable.virtualized.test).
vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: { count: number }) => ({
    scrollRef: () => {},
    sentinelRef: { current: null },
    virtualizer: { scrollToIndex: vi.fn() },
    virtualItems: Array.from({ length: opts.count }, (_, i) => ({
      key: i,
      index: i,
      start: i * 44,
      size: 44,
      end: (i + 1) * 44,
      lane: 0,
    })),
    totalSize: opts.count * 44,
    measureElement: () => {},
    maxHeight: null,
  }),
}));

// `Filter` debounces its input; collapse that so a typed value applies at once.
vi.mock("@/components/Debounce", () => ({
  useDebounce: (value: string) => value,
}));

// The canonical user cell fetches its own user row; it has its own coverage,
// so it is stubbed to the id it was asked for.
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid={`user-name-${userId}`}>{userId}</span>
  ),
}));

const mockPush = vi.fn();
vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// `useRequireAuth` reaches for the locale-aware router, which needs a mounted
// app router; the page only reads the session and status from it.
vi.mock("~/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: currentSession,
    status: currentSessionStatus,
    isLoading: currentSessionStatus === "loading",
    isAuthenticated: currentSessionStatus === "authenticated",
  }),
}));

let mockProjectData: { id: number; name: string; iconUrl: null } | undefined = {
  id: 42,
  name: "Apollo",
  iconUrl: null,
};
let mockProjectLoading = false;
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindFirst: () => ({
        data: mockProjectData,
        isLoading: mockProjectLoading,
      }),
    },
  }),
}));

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

type RosterEntry = {
  userId: string;
  name: string;
  email: string | null;
  image: string | null;
  systemAccess: "ADMIN" | "PROJECTADMIN" | "USER";
  effectiveRole: { id: number; name: string } | null;
  source: string;
};
let mockRoster: RosterEntry[] | undefined = [];
let mockRosterLoading = false;
let mockRosterError: Error | null = null;
const mockUseRoster = vi.fn();
vi.mock("~/hooks/useProjectAccessRoster", () => ({
  useProjectAccessRoster: (...args: unknown[]) => {
    mockUseRoster(...args);
    return {
      data: mockRoster,
      isLoading: mockRosterLoading,
      error: mockRosterError,
    };
  },
}));

import AccessPage from "./page";

const roster: RosterEntry[] = [
  {
    userId: "admin-1",
    name: "Ada Admin",
    email: "ada@example.com",
    image: null,
    systemAccess: "ADMIN",
    effectiveRole: null,
    source: "SYSTEM_ADMIN",
  },
  {
    userId: "user-9",
    name: "Tess Tester",
    email: "tess@example.com",
    image: null,
    systemAccess: "USER",
    effectiveRole: { id: 3, name: "Tester" },
    source: "GROUP_PERMISSION",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ProjectAccessPage (Project → Settings → Access)", () => {
  beforeEach(() => {
    mockNotFound.mockReset();
    mockUseRoster.mockReset();
    mockPush.mockReset();
    currentSession = { user: { id: "user-1", access: "ADMIN" } };
    currentSessionStatus = "authenticated";
    mockProjectData = { id: 42, name: "Apollo", iconUrl: null };
    mockProjectLoading = false;
    mockIsProjectAdmin = true;
    mockPermissionsLoading = false;
    mockRoster = roster;
    mockRosterLoading = false;
    mockRosterError = null;
  });

  it("lists every user with system access, effective role and source", () => {
    render(<AccessPage />);
    expect(screen.getByTestId("project-access-title")).toBeInTheDocument();

    // The test i18n mock echoes unknown keys back, so the reused keys are
    // asserted by name.
    const adminRow = screen.getByTestId("project-access-row-admin-1");
    expect(
      adminRow.querySelector('[data-testid="user-name-admin-1"]')
    ).not.toBeNull();
    expect(adminRow).toHaveTextContent("ada@example.com");
    expect(adminRow).toHaveTextContent("common.access.admin");
    expect(adminRow).toHaveTextContent("common.fields.systemAccess");

    const userRow = screen.getByTestId("project-access-row-user-9");
    expect(userRow).toHaveTextContent("Tester");
    expect(userRow).toHaveTextContent(
      "admin.projects.edit.labels.groupPermissions"
    );
    expect(
      userRow.querySelector('[data-testid="user-name-user-9"]')
    ).not.toBeNull();
    expect(
      userRow.querySelector('a[href="mailto:tess@example.com"]')
    ).not.toBeNull();
  });

  it("offers a system ADMIN an Edit Project Access button into Edit Project's Users tab", () => {
    render(<AccessPage />);
    const button = screen.getByTestId("project-access-edit-button");
    expect(button).toHaveTextContent("projects.settings.access.editButton");
    fireEvent.click(button);
    expect(mockPush).toHaveBeenCalledWith("/admin/projects?edit=42&tab=users");
    expect(screen.queryByTestId("project-access-admin-note")).toBeNull();
  });

  it("tells a non-ADMIN settings holder that only administrators change access", () => {
    currentSession = { user: { id: "user-1", access: "PROJECTADMIN" } };
    render(<AccessPage />);
    expect(screen.getByTestId("project-access-admin-note")).toHaveTextContent(
      "projects.settings.access.adminOnlyNote"
    );
    expect(screen.queryByTestId("project-access-edit-button")).toBeNull();
  });

  it("only fetches the roster once project-admin authority is confirmed", () => {
    mockIsProjectAdmin = false;
    mockPermissionsLoading = true;
    render(<AccessPage />);
    expect(mockUseRoster).toHaveBeenCalledWith(42, { enabled: false });
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("sends a user without project-admin authority to notFound()", () => {
    currentSession = { user: { id: "user-1", access: "USER" } };
    mockIsProjectAdmin = false;
    expect(() => render(<AccessPage />)).toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalled();
  });

  it("filters the roster by name or email", () => {
    render(<AccessPage />);
    expect(
      screen.getByTestId("project-access-row-admin-1")
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-access-row-user-9")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("project-access-filter"), {
      target: { value: "tess@" },
    });

    expect(screen.queryByTestId("project-access-row-admin-1")).toBeNull();
    expect(screen.getByTestId("project-access-row-user-9")).toBeInTheDocument();
  });

  it("shows the empty state when nobody can access the project", () => {
    mockRoster = [];
    render(<AccessPage />);
    // DataTable's own empty state (`common.labels.noResults` in the test mock).
    expect(screen.getByText("No results yet")).toBeInTheDocument();
  });

  it("surfaces a roster load failure", () => {
    mockRoster = undefined;
    mockRosterError = new Error("Forbidden");
    render(<AccessPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "common.errors.unknown"
    );
    expect(screen.queryByTestId("project-access-table")).toBeNull();
  });
});
