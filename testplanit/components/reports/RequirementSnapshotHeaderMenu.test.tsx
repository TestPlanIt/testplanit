// The Requirements page header's Snapshots menu: "Save snapshot" first
// (managers only), then one row per snapshot — the row opens it in the
// traceability report, and the trash deletes (delete rights only). Radix Popover is stubbed to render
// inline; the list hook is stubbed with a mutable fixture.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, invalidateQueries, toastSuccess, toastError, listData } =
  vi.hoisted(() => ({
    fetchMock: vi.fn(),
    invalidateQueries: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    listData: { current: [] as any[], isLoading: false },
  }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  useLocale: () => "en-US",
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("~/hooks/useRequirementSnapshotList", () => ({
  useRequirementSnapshotList: () => ({
    options: listData.current,
    isLoading: listData.isLoading,
  }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children, ...props }: any) => (
    <div data-testid={props["data-testid"]}>{children}</div>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
}));

vi.mock("./RequirementSnapshotSaveDialog", () => ({
  RequirementSnapshotSaveDialog: ({ open }: any) =>
    open ? <div data-testid="stub-save-dialog" /> : null,
}));

import { RequirementSnapshotHeaderMenu } from "./RequirementSnapshotHeaderMenu";

const snapshots = [
  {
    id: 12,
    name: "Release 2.4 sign-off",
    capturedAt: "2026-08-15T09:00:00.000Z",
    requirementCount: 3,
    uncoveredCount: 1,
    caseLinkCount: 5,
    capturedBy: { name: "Riley" },
  },
  {
    id: 7,
    name: "Sprint 40",
    capturedAt: "2026-07-01T09:00:00.000Z",
    requirementCount: 2,
    uncoveredCount: 2,
    caseLinkCount: 0,
    capturedBy: null,
  },
];

function renderMenu(
  props: Partial<
    React.ComponentProps<typeof RequirementSnapshotHeaderMenu>
  > = {}
) {
  const onOpen = vi.fn();
  render(
    <RequirementSnapshotHeaderMenu
      projectId={42}
      canManage={false}
      canDelete={false}
      onOpen={onOpen}
      {...props}
    />
  );
  return { onOpen };
}

describe("RequirementSnapshotHeaderMenu", () => {
  beforeEach(() => {
    listData.current = snapshots;
    listData.isLoading = false;
    fetchMock.mockReset();
    invalidateQueries.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("lists every snapshot as a row that opens it in the report", () => {
    const { onOpen } = renderMenu();
    expect(
      screen.getByTestId("requirements-snapshots-open-12")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirements-snapshots-open-7")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("requirements-snapshots-open-7"));
    expect(onOpen).toHaveBeenCalledWith(7);
    // Viewers get neither the capture nor the delete actions.
    expect(screen.queryByTestId("requirements-snapshots-save")).toBeNull();
    expect(screen.queryByTestId("requirements-snapshots-delete-12")).toBeNull();
  });

  it("puts Save snapshot first for managers and opens the capture dialog", () => {
    renderMenu({ canManage: true });
    const menu = screen.getByTestId("requirements-snapshots-menu");
    expect(menu.firstElementChild).toBe(
      screen.getByTestId("requirements-snapshots-save")
    );
    fireEvent.click(screen.getByTestId("requirements-snapshots-save"));
    expect(screen.getByTestId("stub-save-dialog")).toBeInTheDocument();
  });

  it("soft-deletes a row through the delete route after confirmation", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 7 }) });
    renderMenu({ canDelete: true });
    fireEvent.click(screen.getByTestId("requirements-snapshots-delete-7"));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByTestId("requirements-snapshots-delete-confirm")
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/42/requirements/snapshots/7",
      { method: "DELETE" }
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("snapshotDeleted")
    );
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it("toasts when the delete is refused", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    renderMenu({ canDelete: true });
    fireEvent.click(screen.getByTestId("requirements-snapshots-delete-12"));
    fireEvent.click(
      screen.getByTestId("requirements-snapshots-delete-confirm")
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("snapshotDeleteFailed")
    );
  });

  it("shows the empty hint when the project has no snapshots", () => {
    listData.current = [];
    renderMenu({ canManage: true });
    expect(screen.getByText("noSnapshots")).toBeInTheDocument();
    expect(screen.queryByTestId("requirements-snapshots-list")).toBeNull();
    expect(
      screen.getByTestId("requirements-snapshots-save")
    ).toBeInTheDocument();
  });
});
