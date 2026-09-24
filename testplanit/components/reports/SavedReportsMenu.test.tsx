import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savedReportHref, type SavedReport } from "~/hooks/useSavedReports";

const { holder, mockRenameReport, mockDeleteReport, toastSpies } = vi.hoisted(
  () => ({
    holder: { reports: [] as any[], isLoading: false },
    mockRenameReport: vi.fn(),
    mockDeleteReport: vi.fn(),
    toastSpies: { success: vi.fn(), error: vi.fn() },
  })
);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const last = key.split(".").pop() ?? key;
    return params?.name !== undefined ? `${last} ${params.name}` : last;
  },
}));

vi.mock("sonner", () => ({
  toast: { success: toastSpies.success, error: toastSpies.error },
}));

vi.mock("@/actions/share-links", () => ({
  auditShareLinkCreation: vi.fn(),
  prepareShareLinkData: vi.fn(),
}));

vi.mock("~/hooks/useSavedReports", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/hooks/useSavedReports")>();
  return {
    ...actual,
    useSavedReports: () => ({
      reports: holder.reports,
      isLoading: holder.isLoading,
      saveLiveReport: vi.fn(),
      renameReport: mockRenameReport,
      deleteReport: mockDeleteReport,
      isSaving: false,
      isMutating: false,
    }),
  };
});

import { SavedReportsMenu } from "./SavedReportsMenu";

const liveReport: SavedReport = {
  id: "live-1",
  shareKey: "live-key",
  title: "Live pass rate",
  description: "Updated daily",
  config: { reportType: "test-execution", projectId: 7 },
  projectId: 7,
  frozen: null,
};

const frozenReport: SavedReport = {
  id: "frozen-1",
  shareKey: "frozen-key",
  title: "Release 1.0 snapshot",
  description: null,
  config: { reportType: "test-execution", projectId: 7 },
  projectId: 7,
  frozen: { capturedAt: new Date("2026-09-01T00:00:00Z"), truncated: false },
};

const originalLocation = window.location;

function openMenu() {
  render(<SavedReportsMenu projectId={7} />);
  fireEvent.click(screen.getByTestId("saved-reports-trigger"));
  return screen.getByTestId("saved-reports-menu");
}

function itemFor(title: string) {
  return screen
    .getAllByTestId("saved-report-item")
    .find((item) => item.textContent?.includes(title))!;
}

function rowFor(title: string) {
  return itemFor(title).closest("li")!;
}

describe("SavedReportsMenu", () => {
  const assignSpy = vi.fn();
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    holder.reports = [liveReport, frozenReport];
    holder.isLoading = false;
    mockRenameReport.mockReset().mockResolvedValue(undefined);
    mockDeleteReport.mockReset().mockResolvedValue(undefined);
    toastSpies.success.mockReset();
    toastSpies.error.mockReset();
    assignSpy.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign: assignSpy },
    });
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  it("shows the empty state when there are no saved reports", () => {
    holder.reports = [];
    openMenu();

    expect(screen.getByTestId("saved-reports-empty")).toHaveTextContent(
      "empty"
    );
    expect(screen.queryByTestId("saved-reports-list")).not.toBeInTheDocument();
  });

  it("lists live and frozen reports, marking the frozen one", () => {
    openMenu();

    const items = screen.getAllByTestId("saved-report-item");
    expect(items).toHaveLength(2);
    expect(itemFor("Live pass rate")).toBeInTheDocument();
    expect(itemFor("Release 1.0 snapshot")).toBeInTheDocument();
    expect(
      itemFor("Release 1.0 snapshot").querySelector(
        '[aria-label="frozenBadge"]'
      )
    ).not.toBeNull();
    expect(
      itemFor("Live pass rate").querySelector('[aria-label="frozenBadge"]')
    ).toBeNull();
    expect(itemFor("Live pass rate")).toHaveAttribute("title", "Updated daily");
  });

  it("opens a live report in place on the Reports page", () => {
    openMenu();

    fireEvent.click(itemFor("Live pass rate"));

    const href = savedReportHref(liveReport);
    expect(href).toContain("/projects/reports/7?");
    expect(href).toContain("savedReport=live-1");
    expect(assignSpy).toHaveBeenCalledWith(href);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("opens a frozen report in a new tab", () => {
    openMenu();

    fireEvent.click(itemFor("Release 1.0 snapshot"));

    expect(openSpy).toHaveBeenCalledWith(
      "/share/frozen-key",
      "_blank",
      "noopener,noreferrer"
    );
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("renames a report from a prefilled dialog", async () => {
    openMenu();

    fireEvent.click(
      rowFor("Live pass rate").querySelector(
        '[data-testid="saved-report-rename"]'
      )!
    );

    const input = await screen.findByTestId("saved-report-rename-input");
    expect(input).toHaveValue("Live pass rate");
    expect(screen.getByDisplayValue("Updated daily")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Renamed report" } });
    fireEvent.change(screen.getByDisplayValue("Updated daily"), {
      target: { value: "New notes" },
    });
    fireEvent.click(screen.getByTestId("saved-report-rename-submit"));

    await waitFor(() =>
      expect(mockRenameReport).toHaveBeenCalledWith({
        id: "live-1",
        name: "Renamed report",
        description: "New notes",
      })
    );
    await waitFor(() =>
      expect(toastSpies.success).toHaveBeenCalledWith("renamed")
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("saved-report-rename-input")
      ).not.toBeInTheDocument()
    );
  });

  it("toasts an error and keeps the rename dialog open when renaming fails", async () => {
    mockRenameReport.mockRejectedValueOnce(new Error("nope"));
    openMenu();

    fireEvent.click(
      rowFor("Release 1.0 snapshot").querySelector(
        '[data-testid="saved-report-rename"]'
      )!
    );
    const input = await screen.findByTestId("saved-report-rename-input");
    expect(input).toHaveValue("Release 1.0 snapshot");
    fireEvent.click(screen.getByTestId("saved-report-rename-submit"));

    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("renameFailed")
    );
    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("saved-report-rename-input")).toBeInTheDocument();
  });

  it("deletes a report after confirmation", async () => {
    openMenu();

    fireEvent.click(
      rowFor("Release 1.0 snapshot").querySelector(
        '[data-testid="saved-report-delete"]'
      )!
    );

    expect(
      await screen.findByText("deleteConfirm Release 1.0 snapshot")
    ).toBeInTheDocument();
    expect(mockDeleteReport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("saved-report-delete-confirm"));

    await waitFor(() =>
      expect(mockDeleteReport).toHaveBeenCalledWith("frozen-1")
    );
    await waitFor(() =>
      expect(toastSpies.success).toHaveBeenCalledWith("deleted")
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("saved-report-delete-confirm")
      ).not.toBeInTheDocument()
    );
  });
});
