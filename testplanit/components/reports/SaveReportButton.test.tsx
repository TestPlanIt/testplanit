import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSaveLiveReport, mockCreateFrozenLink, toastSpies } = vi.hoisted(
  () => ({
    mockSaveLiveReport: vi.fn(),
    mockCreateFrozenLink: vi.fn(),
    toastSpies: { success: vi.fn(), error: vi.fn() },
  })
);

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
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
      reports: [],
      isLoading: false,
      saveLiveReport: mockSaveLiveReport,
      renameReport: vi.fn(),
      deleteReport: vi.fn(),
      isSaving: false,
      isMutating: false,
    }),
  };
});

vi.mock("~/hooks/useCreateFrozenReportLink", () => ({
  useCreateFrozenReportLink: () => ({
    createFrozenLink: mockCreateFrozenLink,
    isCreatingFrozen: false,
  }),
}));

import { SaveReportButton } from "./SaveReportButton";

const reportConfig = {
  reportType: "test-execution",
  dimensions: ["status"],
  metrics: ["count"],
  projectId: 999,
};

function openDialog(props: Partial<Parameters<typeof SaveReportButton>[0]>) {
  render(
    <SaveReportButton
      projectId={7}
      reportConfig={reportConfig}
      reportTitle="Execution by status"
      {...props}
    />
  );
  fireEvent.click(screen.getByTestId("save-report-button"));
  return screen.getByTestId("save-report-dialog");
}

describe("SaveReportButton", () => {
  beforeEach(() => {
    mockSaveLiveReport.mockReset().mockResolvedValue("saved-1");
    mockCreateFrozenLink.mockReset().mockResolvedValue({
      status: "created",
      link: { id: "frozen-1" },
    });
    toastSpies.success.mockReset();
    toastSpies.error.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("prefills the name with the report title", () => {
    openDialog({});

    expect(screen.getByTestId("save-report-name-input")).toHaveValue(
      "Execution by status"
    );
  });

  it("disables Save while the name is empty", () => {
    openDialog({});

    fireEvent.change(screen.getByTestId("save-report-name-input"), {
      target: { value: "   " },
    });

    expect(screen.getByTestId("save-report-submit")).toBeDisabled();
  });

  it("saves a live report, closes the dialog and toasts", async () => {
    openDialog({});

    fireEvent.change(screen.getByTestId("save-report-name-input"), {
      target: { value: "  My report  " },
    });
    fireEvent.change(screen.getByTestId("save-report-description-input"), {
      target: { value: "Notes" },
    });
    fireEvent.click(screen.getByTestId("save-report-submit"));

    await waitFor(() =>
      expect(mockSaveLiveReport).toHaveBeenCalledWith({
        name: "My report",
        description: "Notes",
        reportConfig,
      })
    );
    await waitFor(() =>
      expect(screen.queryByTestId("save-report-dialog")).not.toBeInTheDocument()
    );
    expect(toastSpies.success).toHaveBeenCalledWith("saved", {
      description: "savedDescription",
    });
    expect(mockCreateFrozenLink).not.toHaveBeenCalled();
  });

  it("saves a frozen report with the page's project stamped on the config", async () => {
    openDialog({});

    fireEvent.change(screen.getByTestId("save-report-description-input"), {
      target: { value: "  Frozen notes " },
    });
    fireEvent.click(screen.getByTestId("report-data-mode-frozen"));
    fireEvent.click(screen.getByTestId("save-report-submit"));

    await waitFor(() => expect(mockCreateFrozenLink).toHaveBeenCalledTimes(1));
    expect(mockCreateFrozenLink).toHaveBeenCalledWith({
      entityType: "SAVED_REPORT",
      reportConfig: { ...reportConfig, projectId: 7 },
      projectId: 7,
      title: "Execution by status",
      description: "Frozen notes",
      allowTruncate: false,
    });
    await waitFor(() =>
      expect(screen.queryByTestId("save-report-dialog")).not.toBeInTheDocument()
    );
    expect(toastSpies.success).toHaveBeenCalled();
    expect(mockSaveLiveReport).not.toHaveBeenCalled();
  });

  it("drops projectId from a cross-project frozen report's config", async () => {
    openDialog({ projectId: undefined });

    fireEvent.click(screen.getByTestId("report-data-mode-frozen"));
    fireEvent.click(screen.getByTestId("save-report-submit"));

    await waitFor(() => expect(mockCreateFrozenLink).toHaveBeenCalledTimes(1));
    const input = mockCreateFrozenLink.mock.calls[0][0];
    expect(input.projectId).toBeNull();
    expect(input.reportConfig).not.toHaveProperty("projectId");
    expect(input.reportConfig).toEqual({
      reportType: "test-execution",
      dimensions: ["status"],
      metrics: ["count"],
    });
    expect(input.description).toBeNull();
  });

  it("warns on truncation and resends with allowTruncate on confirm", async () => {
    mockCreateFrozenLink
      .mockResolvedValueOnce({
        status: "truncation-required",
        truncation: { totalRowCount: 9000, maxRows: 5000 },
      })
      .mockResolvedValueOnce({ status: "created", link: { id: "frozen-2" } });
    openDialog({});

    fireEvent.click(screen.getByTestId("report-data-mode-frozen"));
    fireEvent.click(screen.getByTestId("save-report-submit"));

    expect(
      await screen.findByTestId("frozen-truncation-warning")
    ).toBeInTheDocument();
    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-report-dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("frozen-truncation-confirm"));

    await waitFor(() => expect(mockCreateFrozenLink).toHaveBeenCalledTimes(2));
    expect(mockCreateFrozenLink.mock.calls[0][0].allowTruncate).toBe(false);
    expect(mockCreateFrozenLink.mock.calls[1][0].allowTruncate).toBe(true);
    await waitFor(() =>
      expect(screen.queryByTestId("save-report-dialog")).not.toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("frozen-truncation-warning")
    ).not.toBeInTheDocument();
    expect(toastSpies.success).toHaveBeenCalled();
  });

  it("closes only the truncation popup on Cancel", async () => {
    mockCreateFrozenLink.mockResolvedValueOnce({
      status: "truncation-required",
      truncation: { totalRowCount: 9000, maxRows: 5000 },
    });
    openDialog({});

    fireEvent.click(screen.getByTestId("report-data-mode-frozen"));
    fireEvent.click(screen.getByTestId("save-report-submit"));
    await screen.findByTestId("frozen-truncation-warning");

    fireEvent.click(screen.getByTestId("frozen-truncation-cancel"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("frozen-truncation-warning")
      ).not.toBeInTheDocument()
    );
    expect(screen.getByTestId("save-report-dialog")).toBeInTheDocument();
    expect(mockCreateFrozenLink).toHaveBeenCalledTimes(1);
    expect(toastSpies.success).not.toHaveBeenCalled();
  });

  it("toasts an error and keeps the dialog open when saving fails", async () => {
    mockSaveLiveReport.mockRejectedValueOnce(new Error("boom"));
    openDialog({});

    fireEvent.click(screen.getByTestId("save-report-submit"));

    await waitFor(() =>
      expect(toastSpies.error).toHaveBeenCalledWith("saveFailed")
    );
    expect(toastSpies.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("save-report-dialog")).toBeInTheDocument();
  });
});
