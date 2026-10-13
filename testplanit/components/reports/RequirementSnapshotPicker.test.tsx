// The Snapshot menu shared by the requirement reports (the saved-searches
// menu shape: "Save snapshot" first, then the choices with a per-row
// delete). Radix Popover is stubbed to render its content inline so the
// rows are always in the DOM; the seams under test are the choice set
// (live entry only in "live" mode), the selection plumbing, the two-line
// record under the trigger, the manage actions (capture through the
// dialog, soft-delete through the route), and the meta-line structure
// the collapse relies on.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, invalidateQueries, toastSuccess, toastError, findManyData } =
  vi.hoisted(() => ({
    fetchMock: vi.fn(),
    invalidateQueries: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    findManyData: { current: [] as any[] },
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
    options: findManyData.current,
    isLoading: false,
  }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children, ...props }: any) => (
    <div data-testid={props["data-testid"]}>{children}</div>
  ),
}));

vi.mock("./RequirementSnapshotSaveDialog", () => ({
  RequirementSnapshotSaveDialog: ({ open, onSaved }: any) =>
    open ? (
      <button
        data-testid="stub-save-dialog"
        onClick={() => onSaved({ id: 99, name: "Fresh", capturedAt: "x" })}
      >
        stub
      </button>
    ) : null,
}));

import { RequirementSnapshotPicker } from "./RequirementSnapshotPicker";

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

function renderPicker(
  props: Partial<React.ComponentProps<typeof RequirementSnapshotPicker>> = {}
) {
  const onValueChange = vi.fn();
  const utils = render(
    <RequirementSnapshotPicker
      projectId={42}
      value={null}
      onValueChange={onValueChange}
      label="Snapshot"
      {...props}
    />
  );
  return { ...utils, onValueChange };
}

describe("RequirementSnapshotPicker", () => {
  beforeEach(() => {
    findManyData.current = snapshots;
    fetchMock.mockReset();
    invalidateQueries.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("offers the live entry only in live mode, and labels the trigger by mode", () => {
    const { unmount } = renderPicker({ nullMode: "live" });
    expect(screen.getByTestId("requirement-snapshot-live")).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-snapshot-option-12")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-snapshot-option-7")
    ).toBeInTheDocument();
    expect(screen.getByTestId("requirement-snapshot-trigger").textContent).toBe(
      "snapshotLive"
    );
    unmount();

    renderPicker({ nullMode: "none", testIdPrefix: "baseline" });
    expect(screen.queryByTestId("baseline-live")).toBeNull();
    expect(screen.getByTestId("baseline-option-12")).toBeInTheDocument();
    expect(screen.getByTestId("baseline-trigger").textContent).toBe(
      "snapshotPlaceholder"
    );
  });

  it("chooses a snapshot by id and the live entry as null, marking the current choice", () => {
    const { onValueChange, rerender } = renderPicker();
    fireEvent.click(screen.getByTestId("requirement-snapshot-option-12"));
    expect(onValueChange).toHaveBeenLastCalledWith(12);
    fireEvent.click(screen.getByTestId("requirement-snapshot-live"));
    expect(onValueChange).toHaveBeenLastCalledWith(null);

    rerender(
      <RequirementSnapshotPicker
        projectId={42}
        value={12}
        onValueChange={onValueChange}
        label="Snapshot"
      />
    );
    expect(
      screen
        .getByTestId("requirement-snapshot-option-12")
        .getAttribute("aria-current")
    ).toBe("true");
    expect(
      screen
        .getByTestId("requirement-snapshot-live")
        .getAttribute("aria-current")
    ).toBeNull();
    expect(screen.getByTestId("requirement-snapshot-trigger").textContent).toBe(
      "Release 2.4 sign-off"
    );
  });

  it("shows the selected snapshot's record on two lines and hides manage actions for viewers", () => {
    renderPicker({ value: 12 });
    const captured = screen.getByTestId("requirement-snapshot-captured");
    expect(captured.firstElementChild!.textContent).toMatch(
      /^snapshotCapturedBy:.*Riley$/
    );
    expect(
      screen.getByTestId("requirement-snapshot-captured-counts").textContent
    ).toBe("snapshotRequirementsCount:3 · snapshotUncoveredCount:1");
    expect(screen.queryByTestId("requirement-snapshot-save")).toBeNull();
    expect(screen.queryByTestId("requirement-snapshot-delete-12")).toBeNull();
  });

  it("puts Save snapshot first for managers and opens the capture dialog from it", () => {
    renderPicker({ canManage: true });
    const menu = screen.getByTestId("requirement-snapshot-menu");
    expect(menu.firstElementChild).toBe(
      screen.getByTestId("requirement-snapshot-save")
    );
    fireEvent.click(screen.getByTestId("requirement-snapshot-save"));
    expect(screen.getByTestId("stub-save-dialog")).toBeInTheDocument();
  });

  it("soft-deletes any row through the delete route after confirmation, clearing the selection only if it was the deleted one", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 7 }) });
    const { onValueChange } = renderPicker({ value: 12, canManage: true });
    fireEvent.click(screen.getByTestId("requirement-snapshot-delete-7"));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("requirement-snapshot-delete-confirm"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/42/requirements/snapshots/7",
      { method: "DELETE" }
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("snapshotDeleted")
    );
    expect(invalidateQueries).toHaveBeenCalled();
    // Snapshot 12 is still the selection; deleting 7 must not clear it.
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("clears the selection when the selected snapshot itself is deleted", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 12 }) });
    const { onValueChange } = renderPicker({ value: 12, canManage: true });
    fireEvent.click(screen.getByTestId("requirement-snapshot-delete-12"));
    fireEvent.click(screen.getByTestId("requirement-snapshot-delete-confirm"));
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith(null));
  });

  it("shows the delete action only with delete rights", () => {
    renderPicker({ value: 12, canManage: true, canDelete: false });
    expect(screen.getByTestId("requirement-snapshot-save")).toBeInTheDocument();
    expect(screen.queryByTestId("requirement-snapshot-delete-12")).toBeNull();
  });

  it("keeps the selection and toasts when the delete is refused", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const { onValueChange } = renderPicker({ value: 12, canManage: true });
    fireEvent.click(screen.getByTestId("requirement-snapshot-delete-12"));
    fireEvent.click(screen.getByTestId("requirement-snapshot-delete-confirm"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("snapshotDeleteFailed")
    );
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("selects a freshly captured snapshot only once the refetched list contains it", () => {
    const { onValueChange, rerender } = renderPicker({ canManage: true });
    fireEvent.click(screen.getByTestId("requirement-snapshot-save"));
    fireEvent.click(screen.getByTestId("stub-save-dialog"));
    expect(onValueChange).not.toHaveBeenCalled();

    findManyData.current = [
      {
        id: 99,
        name: "Fresh",
        capturedAt: "2026-09-01T10:00:00.000Z",
        requirementCount: 1,
        uncoveredCount: 0,
        capturedBy: null,
      },
      ...snapshots,
    ];
    rerender(
      <RequirementSnapshotPicker
        projectId={42}
        value={null}
        onValueChange={onValueChange}
        label="Snapshot"
        canManage
      />
    );
    expect(onValueChange).toHaveBeenCalledWith(99);
  });

  it("shows the empty hint when there are no snapshots in a baseline menu", () => {
    findManyData.current = [];
    renderPicker({ nullMode: "none", testIdPrefix: "baseline" });
    expect(screen.getByText("noSnapshots")).toBeInTheDocument();
    expect(screen.queryByTestId("baseline-list")).toBeNull();
  });
});

describe("meta line collapse", () => {
  it("lays the meta parts out date-first on a single hidden-overflow wrap row", () => {
    findManyData.current = snapshots;
    renderPicker({ value: 12 });
    // jsdom does no layout; pin the structure the collapse relies on: a
    // one-line-high wrapping row hides whatever overflows, so parts drop
    // last-first (uncovered, then requirements). The date is first, never
    // a drop candidate, and ellipsizes rather than wrapping.
    const date = screen.getAllByTestId("requirement-snapshot-meta-date")[0];
    const requirements = screen.getAllByTestId(
      "requirement-snapshot-meta-requirements"
    )[0];
    const uncovered = screen.getAllByTestId(
      "requirement-snapshot-meta-uncovered"
    )[0];
    const row = date.parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).toContain("overflow-hidden");
    expect(row.className).toContain("max-h-4");
    expect([...row.children]).toEqual([date, requirements, uncovered]);
    expect(date.className).toContain("truncate");
    expect(requirements.className).toContain("shrink-0");
    expect(uncovered.className).toContain("shrink-0");
    expect(date.textContent).toMatch(/2026/);
    expect(requirements.textContent).toContain("snapshotRequirementsCount:3");
    expect(uncovered.textContent).toContain("snapshotUncoveredCount:1");
  });
});
