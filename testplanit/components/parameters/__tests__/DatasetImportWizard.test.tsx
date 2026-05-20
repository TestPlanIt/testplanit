import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// next-intl mock — surface the keys the wizard uses
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, params?: Record<string, unknown>) => {
      const parameters: Record<string, string> = {
        datasetImportCsv: "Import CSV",
        importStep1Heading: "Upload a CSV file",
        importStep1Body: "Choose a .csv file. Maximum size 5 MB.",
        importStep1Choose: "Choose CSV file",
        importStep1Label: "Upload",
        importStep2Heading: "Map CSV columns to parameters",
        importStep2HeaderCsv: "CSV column",
        importStep2HeaderParameter: "Parameter",
        importStep2SkipColumn: "Skip column",
        importStep2RequiredUnmapped:
          'Required parameter "@{name}" has no mapped CSV column.',
        importStep2Label: "Map columns",
        importStep3SummaryOk: "{totalRows} rows parsed, no errors.",
        importStep3SummaryErrors:
          "{totalRows} rows parsed; {errorCount} rows have errors.",
        importStep3PreviewLimit:
          "Showing first {limit} rows. All rows will be validated on the next step.",
        importStep3Label: "Preview",
        importStep4Heading: "Confirm import",
        importStep4Replace: "Replace all existing rows",
        importStep4ReplaceDescription:
          "Existing dataset rows ({existingCount}) will be deleted.",
        importStep4Append: "Append to existing rows",
        importStep4AppendDescription:
          "New rows will be added after row #{existingCount}.",
        importStep4ErrorBlock:
          "Resolve {errorCount} error(s) on the previous step before importing.",
        importStep4Label: "Confirm",
        confirmSummaryValid: "Valid rows: {count}",
        confirmSummaryErrors: "Errors: {count}",
        confirmSummaryMode: "Mode: {mode}",
        cancelUploadTitle: "Discard upload?",
        cancelUploadDescription: "The CSV data you uploaded will be lost.",
        importCommit: "Import",
        importSuccess: "Imported {count} rows",
        datasetSaveBlocked: "Fix {count} errors before continuing.",
      };
      const commonActions: Record<string, string> = {
        cancel: "Cancel",
        back: "Back",
        next: "Next",
      };
      const dict = namespace === "common.actions" ? commonActions : parameters;
      let v = dict[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, val]) => {
          v = v.replace(`{${k}}`, String(val));
        });
      }
      return v;
    },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: any[]) => toastSuccess(...a),
    error: (...a: any[]) => toastError(...a),
    message: vi.fn(),
  }),
}));

import { DatasetImportWizard } from "@/components/parameters/DatasetImportWizard";

const SAMPLE_PARAMS = [
  {
    id: 1,
    name: "username",
    type: "STRING" as const,
    sensitive: false,
    required: false,
  },
  {
    id: 2,
    name: "amount",
    type: "INTEGER" as const,
    sensitive: false,
    required: true,
  },
];

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, created: 2 }),
  }) as any;
});

const VALID_CSV = "username,amount\nalice,100\nbob,200\n";
const INVALID_CSV = "username,amount\nalice,not-a-number\n";

async function uploadCsv(text: string) {
  const input = screen.getByTestId(
    "dataset-import-wizard-file-input"
  ) as HTMLInputElement;
  const file = new File([text], "data.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(
      screen.getByTestId("dataset-import-wizard-step-map")
    ).toBeInTheDocument();
  });
}

describe("DatasetImportWizard", () => {
  it("Test 1: Renders shadcn Dialog with WizardStepIndicator and sm:max-w-4xl", () => {
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={vi.fn()}
          caseId={1}
          parameters={SAMPLE_PARAMS}
          existingRowCount={3}
        />
      )
    );
    const dialog = screen.getByTestId("dataset-import-wizard");
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain("sm:max-w-4xl");
    expect(screen.getByTestId("wizard-step-indicator")).toBeInTheDocument();
    // Starts on step 1 (Upload)
    expect(
      screen.getByTestId("dataset-import-wizard-step-upload")
    ).toBeInTheDocument();
  });

  it("Test 2: Closed wizard does not render step content", () => {
    render(
      wrap(
        <DatasetImportWizard
          open={false}
          onClose={vi.fn()}
          caseId={1}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    expect(screen.queryByTestId("dataset-import-wizard")).toBeNull();
  });

  it("Test 3: After valid file selected → advances to Map columns step", async () => {
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={vi.fn()}
          caseId={42}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    await uploadCsv(VALID_CSV);
    expect(
      screen.getByTestId("dataset-import-wizard-step-map")
    ).toBeInTheDocument();
  });

  it("Test 4: Map → Preview → Confirm flow + Import button enabled when no errors", async () => {
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={vi.fn()}
          caseId={42}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    await uploadCsv(VALID_CSV);
    // Next on Map (mapping was auto-applied; required 'amount' mapped)
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next"));
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-step-preview")
      ).toBeInTheDocument();
    });
    // Next on Preview
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next"));
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-step-confirm")
      ).toBeInTheDocument();
    });
    // Import button rendered + enabled
    const importBtn = screen.getByTestId("dataset-import-wizard-commit");
    expect(importBtn).toBeInTheDocument();
    expect(importBtn).not.toBeDisabled();
  });

  it("Test 5: Errors in Preview disable the Import button on Confirm", async () => {
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={vi.fn()}
          caseId={42}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    await uploadCsv(INVALID_CSV);
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next")); // Map -> Preview
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-step-preview")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next")); // Preview -> Confirm
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-step-confirm")
      ).toBeInTheDocument();
    });
    const importBtn = screen.getByTestId("dataset-import-wizard-commit");
    expect(importBtn).toBeDisabled();
  });

  it("Test 6: Successful Import POSTs to import-csv with mode + mapping + rows", async () => {
    const onClose = vi.fn();
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={onClose}
          caseId={77}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    await uploadCsv(VALID_CSV);
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next"));
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-step-preview")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next"));
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-commit")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-import-wizard-commit"));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/repository/cases/77/dataset/import-csv",
        expect.objectContaining({ method: "POST" })
      );
    });
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.mode).toBe("replace");
    expect(body.rows).toHaveLength(2);
    expect(body.mapping).toBeDefined();
    expect(toastSuccess).toHaveBeenCalled();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("Test 7: 400 response surfaces error toast and keeps wizard open", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Validation failed",
        errors: [{ rowIndex: 0, issues: ["bad"] }],
      }),
    }) as any;
    const onClose = vi.fn();
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={onClose}
          caseId={77}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    await uploadCsv(VALID_CSV);
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next"));
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-step-preview")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-import-wizard-next"));
    await waitFor(() => {
      expect(
        screen.getByTestId("dataset-import-wizard-commit")
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("dataset-import-wizard-commit"));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Test 8: Cancel after upload opens shadcn AlertDialog (no native confirm)", async () => {
    render(
      wrap(
        <DatasetImportWizard
          open={true}
          onClose={vi.fn()}
          caseId={1}
          parameters={SAMPLE_PARAMS}
          existingRowCount={0}
        />
      )
    );
    await uploadCsv(VALID_CSV); // now on Map step
    fireEvent.click(screen.getByTestId("dataset-import-wizard-cancel"));
    await waitFor(() => {
      expect(screen.getByText("Discard upload?")).toBeInTheDocument();
    });
    expect(
      screen.getByText("The CSV data you uploaded will be lost.")
    ).toBeInTheDocument();
  });
});
