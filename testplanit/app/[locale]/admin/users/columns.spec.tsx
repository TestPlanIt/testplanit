import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, test, vi } from "vitest";

import { ExtendedUser, useColumns } from "./columns";

// Mock next-intl — return the key so assertions can match on the path.
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock navigation primitives that downstream cells use.
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock UserNameCell so the Name cell renders deterministically.
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid={`user-name-cell-${userId}`}>{userId}</span>
  ),
}));

// Mock the rest of the heavy cell components so the column renderer is
// trivially testable in isolation.
vi.mock("@/components/EmailDisplay", () => ({
  EmailCell: ({ email }: { email: string }) => <span>{email}</span>,
}));
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: () => <span data-testid="date-formatter" />,
}));
vi.mock("@/components/tables/AccessLevelDisplay", () => ({
  AccessLevelDisplay: ({ accessLevel }: { accessLevel: string }) => (
    <span>{accessLevel}</span>
  ),
}));
vi.mock("@/components/tables/RoleNameCell", () => ({
  RoleNameCell: ({ roleId }: { roleId: string }) => <span>{roleId}</span>,
}));
vi.mock("@/components/tables/GroupListDisplay", () => ({
  GroupListDisplay: () => <span data-testid="group-list" />,
}));
vi.mock("@/components/tables/UserProjectsDisplay", () => ({
  UserProjectsDisplay: () => <span data-testid="user-projects" />,
}));
vi.mock("~/components/LastActiveDisplay", () => ({
  LastActiveDisplay: () => <span data-testid="last-active" />,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, disabled }: { checked: boolean; disabled?: boolean }) => (
    <input
      type="checkbox"
      defaultChecked={checked}
      disabled={disabled}
      data-testid="switch"
    />
  ),
}));

const tCommon = ((key: string) => `common.${key}`) as ReturnType<
  typeof import("next-intl").useTranslations<"common">
>;
const tAdmin = ((key: string) => `admin.users.${key}`) as ReturnType<
  typeof import("next-intl").useTranslations<"admin.users">
>;
const userPreferences = {
  user: {
    id: "current-admin",
    preferences: { dateFormat: "MM_DD_YYYY_DASH", timezone: "Etc/UTC" },
  },
};

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderCell(
  columns: ReturnType<typeof useColumns>,
  columnId: string,
  row: ExtendedUser
) {
  const column = columns.find((c) => c.id === columnId);
  if (!column || !column.cell) {
    throw new Error(`Column "${columnId}" not found or has no cell renderer`);
  }
  const cellFn = column.cell as (info: any) => React.ReactNode;
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {cellFn({
        row: { original: row },
        getValue: () =>
          row[(column as any).accessorKey as keyof ExtendedUser] as unknown,
      })}
    </QueryClientProvider>
  );
}

const scimUser = {
  id: "system-scim-user",
  name: "SCIM Provisioner",
  email: "scim@__system__",
  isActive: false,
  access: "USER",
  roleId: 1,
  isApi: false,
  authMethod: "INTERNAL",
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerified: null,
  emailVerifToken: null,
  emailTokenExpires: null,
  password: null,
  image: null,
  isDeleted: false,
  lastActiveAt: null,
  createdBy: null,
  role: { name: "Tester" },
  groups: [],
  projects: [],
} as unknown as ExtendedUser;

const normalUser = {
  ...scimUser,
  id: "u-001",
  name: "Real User",
  email: "real@example.com",
  isActive: true,
} as unknown as ExtendedUser;

describe("admin/users columns — SCIM Provisioner badge", () => {
  const { result } = renderHook(() =>
    useColumns(
      userPreferences,
      vi.fn(),
      tCommon,
      tAdmin,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )
  );
  const columns = result.current;

  test("Name cell renders the SCIM Provisioner badge for the synthetic __scim__ row", () => {
    renderCell(columns, "name", scimUser);
    const badge = screen.getByTestId("scim-provisioner-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("admin.users.scimProvisionerBadge");
  });

  test("Name cell does NOT render the badge for a regular user row", () => {
    renderCell(columns, "name", normalUser);
    expect(screen.queryByTestId("scim-provisioner-badge")).toBeNull();
  });

  test("Actions cell disables Edit menu item for the synthetic SCIM row", async () => {
    const user = userEvent.setup();
    renderCell(columns, "actions", scimUser);
    await user.click(screen.getByRole("button"));
    const editItem = await screen.findByText("common.actions.edit");
    // Radix renders disabled via data-disabled attribute on the
    // DropdownMenuItem element when the disabled prop is true.
    const menuItem = editItem.closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    expect(menuItem).toHaveAttribute("data-disabled");
  });

  test("Actions cell hides Delete menu item for the synthetic SCIM row", async () => {
    const user = userEvent.setup();
    renderCell(columns, "actions", scimUser);
    await user.click(screen.getByRole("button"));
    // The menu opens; if Delete were present the text would render.
    await screen.findByText("common.actions.edit");
    expect(screen.queryByText("common.actions.delete")).toBeNull();
  });

  test("Actions cell keeps Edit enabled for a regular user row", async () => {
    const user = userEvent.setup();
    renderCell(columns, "actions", normalUser);
    await user.click(screen.getByRole("button"));
    const editItem = await screen.findByText("common.actions.edit");
    const menuItem = editItem.closest('[role="menuitem"]');
    expect(menuItem).not.toBeNull();
    expect(menuItem).not.toHaveAttribute("data-disabled");
  });
});
