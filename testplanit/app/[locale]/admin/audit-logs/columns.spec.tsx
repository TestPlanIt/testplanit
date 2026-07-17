import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useColumns } from "./columns";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: () => null,
}));

// The record-key config hook reads AppConfig via React Query; stub it so the
// columns hook renders without a QueryClient (feature-off: formatKey → null).
vi.mock("~/hooks/useRecordKeyConfig", () => ({
  useRecordKeyConfig: () => ({ formatKey: () => null }),
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

describe("admin/audit-logs columns", () => {
  const { result } = renderHook(() =>
    useColumns(userPreferences, vi.fn(), tAuditLogs, tCommon, tUserMenu)
  );
  const columns = result.current;

  test("does not include a SCIM source column (surfaced in the detail modal instead)", () => {
    expect(columns.map((c) => c.id)).not.toContain("source");
  });

  test("the view-details (actions) column is not sortable", () => {
    const actions = columns.find((c) => c.id === "actions");
    expect(actions?.enableSorting).toBe(false);
  });
});
