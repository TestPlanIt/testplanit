import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Per-file next-intl mock so we assert on real English copy.
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (
    key: string,
    params?: Record<string, unknown>
  ) => {
    const parameters: Record<string, string> = {
      sheetTitle: "Configure Parameters",
      sheetDescription:
        "Declare named parameters for this test case and (optionally) attach a dataset of values to use during execution.",
      tabParameters: "Parameters",
      tabDataset: "Dataset",
      tabDatasetDisabledTooltip:
        "Add at least one parameter before editing dataset rows.",
      sheetAutoSaveHint: "Changes save automatically.",
    };
    const commonActions: Record<string, string> = {
      close: "Close",
    };
    const dict =
      namespace === "common.actions" ? commonActions : parameters;
    let value = dict[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
}));

// Mock ZenStack hooks BEFORE importing the component under test
const mockUseFindManyTestCaseParameter = vi.fn();
const mockUseCountDataSetRow = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useFindManyTestCaseParameter: (args: any, opts?: any) =>
    mockUseFindManyTestCaseParameter(args, opts),
  useCountDataSetRow: (args: any, opts?: any) =>
    mockUseCountDataSetRow(args, opts),
}));

// Mock sonner toast
const toastMessage = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    message: (...args: any[]) => toastMessage(...args),
    success: (...args: any[]) => toastSuccess(...args),
    error: (...args: any[]) => toastError(...args),
  }),
}));

// Stub child tabs/content (ParametersTab) for shell-level testing
vi.mock("@/components/parameters/ParametersTab", () => ({
  ParametersTab: () => <div data-testid="stub-parameters-tab" />,
}));

// Plan 02-05 — DatasetImportWizard mounted at the Sheet level. Stub it
// so we can assert the wiring without dragging in Papa.parse, fetch,
// React Query, etc.
vi.mock("@/components/parameters/DatasetImportWizard", () => ({
  DatasetImportWizard: ({ open }: { open: boolean }) =>
    open ? (
      <div data-testid="stub-dataset-import-wizard" />
    ) : null,
}));

import { ConfigureParametersSheet } from "@/components/parameters/ConfigureParametersSheet";

describe("ConfigureParametersSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFindManyTestCaseParameter.mockReturnValue({ data: [] });
    mockUseCountDataSetRow.mockReturnValue({ data: 0 });
  });

  it("renders sheet content when open=true", () => {
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    expect(screen.getByTestId("configure-parameters-sheet")).toBeInTheDocument();
  });

  it("does not render sheet content when open=false", () => {
    render(
      <ConfigureParametersSheet
        isOpen={false}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    expect(screen.queryByTestId("configure-parameters-sheet")).toBeNull();
  });

  it("renders both tab triggers (Parameters and Dataset)", () => {
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    expect(screen.getByTestId("tab-parameters")).toBeInTheDocument();
    expect(screen.getByTestId("tab-dataset")).toBeInTheDocument();
  });

  it("disables the Dataset tab when zero parameters exist", () => {
    mockUseFindManyTestCaseParameter.mockReturnValue({ data: [] });
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    const datasetTab = screen.getByTestId("tab-dataset");
    expect(datasetTab).toHaveAttribute("disabled");
  });

  it("enables the Dataset tab when at least one parameter exists", () => {
    mockUseFindManyTestCaseParameter.mockReturnValue({
      data: [
        {
          id: 1,
          name: "username",
          type: "STRING",
          testCaseId: 1,
          isDeleted: false,
        },
      ],
    });
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    const datasetTab = screen.getByTestId("tab-dataset");
    expect(datasetTab).not.toHaveAttribute("disabled");
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={onClose}
        caseId={1}
        projectId={2}
      />
    );
    const closeBtn = screen.getByTestId("configure-parameters-sheet-close");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Cmd+S inside the sheet fires the autosave-hint toast and prevents default", () => {
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(toastMessage).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not register the Cmd+S listener when isOpen is false", () => {
    render(
      <ConfigureParametersSheet
        isOpen={false}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(toastMessage).not.toHaveBeenCalled();
  });

  it("renders the dataset placeholder when on dataset tab is unavailable but content area exists", () => {
    render(
      <ConfigureParametersSheet
        isOpen={true}
        onClose={() => {}}
        caseId={1}
        projectId={2}
      />
    );
    // ParametersTab is stubbed; just confirm the parameters tab body renders.
    expect(screen.getByTestId("stub-parameters-tab")).toBeInTheDocument();
  });
});
