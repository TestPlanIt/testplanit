import { render, renderHook, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, test, vi } from "vitest";

import { ExtendedAuditLog, useColumns } from "./columns";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: () => <span data-testid="date-formatter" />,
}));

const tAuditLogs = ((key: string) => `admin.auditLogs.${key}`) as ReturnType<
  typeof import("next-intl").useTranslations<"admin.auditLogs">
>;
const tCommon = ((key: string) => `common.${key}`) as ReturnType<
  typeof import("next-intl").useTranslations<"common">
>;
const tUserMenu = ((key: string) => `userMenu.${key}`) as ReturnType<
  typeof import("next-intl").useTranslations<"userMenu">
>;
const userPreferences = {
  user: { preferences: { timezone: "Etc/UTC" } },
};

function renderCell(
  columns: ReturnType<typeof useColumns>,
  columnId: string,
  row: ExtendedAuditLog
) {
  const column = columns.find((c) => c.id === columnId);
  if (!column || !column.cell) {
    throw new Error(`Column "${columnId}" not found or has no cell renderer`);
  }
  const cellFn = column.cell as (info: any) => React.ReactNode;
  return render(
    <>
      {cellFn({
        row: { original: row },
        getValue: () =>
          row[(column as any).accessorKey as keyof ExtendedAuditLog] as unknown,
      })}
    </>
  );
}

const baseLog = {
  id: "log-001",
  action: "CREATE" as any,
  entityType: "User",
  entityId: "u-1",
  entityName: "Alice",
  userId: "user-001",
  userName: "Admin",
  userEmail: "admin@example.com",
  timestamp: new Date(),
  changes: null,
  metadata: null,
  projectId: null,
  project: null,
} as unknown as ExtendedAuditLog;

describe("admin/audit-logs columns — SCIM source badge", () => {
  const { result } = renderHook(() =>
    useColumns(userPreferences, vi.fn(), tAuditLogs, tCommon, tUserMenu)
  );
  const columns = result.current;

  test("source column exists in the column set", () => {
    const ids = columns.map((c) => c.id);
    expect(ids).toContain("source");
  });

  test("source cell renders the SCIM badge when metadata.source === 'scim'", () => {
    const scimLog = {
      ...baseLog,
      metadata: { source: "scim", scimTokenId: "tok-abc" } as any,
    };
    renderCell(columns, "source", scimLog);
    const badge = screen.getByTestId("audit-log-source-scim-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("admin.auditLogs.sourceScim");
  });

  test("source cell does NOT render the SCIM badge for metadata.source === 'api'", () => {
    const apiLog = {
      ...baseLog,
      metadata: { source: "api" } as any,
    };
    renderCell(columns, "source", apiLog);
    expect(screen.queryByTestId("audit-log-source-scim-badge")).toBeNull();
  });

  test("source cell does NOT render the SCIM badge for metadata.source === 'mcp'", () => {
    const mcpLog = {
      ...baseLog,
      metadata: { source: "mcp" } as any,
    };
    renderCell(columns, "source", mcpLog);
    expect(screen.queryByTestId("audit-log-source-scim-badge")).toBeNull();
  });

  test("source cell renders nothing visible when metadata is null", () => {
    renderCell(columns, "source", baseLog);
    expect(screen.queryByTestId("audit-log-source-scim-badge")).toBeNull();
  });
});
