import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      importStep1Heading: "Upload a CSV file",
      importStep1Body: "Choose a .csv file. Maximum size 5 MB.",
      importStep1Choose: "Choose CSV file",
      importStep1ErrorTooBig: "File is too large. Maximum is 5 MB.",
      importStep1ErrorWrongType: "Only .csv files are supported.",
      importStep2Heading: "Map CSV columns to parameters",
      importStep2HeaderCsv: "CSV column",
      importStep2HeaderParameter: "Parameter",
      importStep2SkipColumn: "Skip column",
      importStep2RequiredUnmapped:
        'Required parameter "@{name}" has no mapped CSV column.',
      importStep3SummaryOk: "{totalRows} rows parsed, no errors.",
      importStep3SummaryErrors:
        "{totalRows} rows parsed; {errorCount} rows have errors.",
      importStep3PreviewLimit:
        "Showing first {limit} rows. All rows will be validated on the next step.",
      importStep4Heading: "Confirm import",
      importStep4Replace: "Replace all existing rows",
      importStep4ReplaceDescription:
        "Existing dataset rows ({existingCount}) will be deleted.",
      importStep4Append: "Append to existing rows",
      importStep4AppendDescription:
        "New rows will be added after row #{existingCount}.",
      importStep4ErrorBlock:
        "Resolve {errorCount} error(s) on the previous step before importing.",
      confirmSummaryValid: "Valid rows: {count}",
      confirmSummaryErrors: "Errors: {count}",
      confirmSummaryMode: "Mode: {mode}",
    };
    let v = dict[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, val]) => {
        v = v.replace(`{${k}}`, String(val));
      });
    }
    return v;
  },
}));

import { ConfirmStep } from "@/components/parameters/wizard/ConfirmStep";
import { MapColumnsStep } from "@/components/parameters/wizard/MapColumnsStep";
import { PreviewStep } from "@/components/parameters/wizard/PreviewStep";
import { UploadStep } from "@/components/parameters/wizard/UploadStep";

beforeEach(() => {
  vi.clearAllMocks();
});

// ----------------------------- UploadStep ---------------------------------
describe("UploadStep", () => {
  it("Test 1: renders heading + body + file input with .csv accept", () => {
    render(<UploadStep onFileSelected={vi.fn()} />);
    expect(
      screen.getByTestId("dataset-import-wizard-step-upload"),
    ).toBeInTheDocument();
    expect(screen.getByText("Upload a CSV file")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a .csv file. Maximum size 5 MB."),
    ).toBeInTheDocument();
    const input = screen.getByTestId(
      "dataset-import-wizard-file-input",
    ) as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toContain(".csv");
  });

  it("Test 2: rejects wrong extension and does NOT call onFileSelected", async () => {
    const onFileSelected = vi.fn();
    render(<UploadStep onFileSelected={onFileSelected} />);
    const input = screen.getByTestId(
      "dataset-import-wizard-file-input",
    ) as HTMLInputElement;
    const txt = new File(["hello"], "foo.txt", { type: "text/plain" });
    // fireEvent bypasses the input.accept filter that userEvent.upload enforces.
    fireEvent.change(input, { target: { files: [txt] } });
    await waitFor(() => {
      expect(
        screen.getByText("Only .csv files are supported."),
      ).toBeInTheDocument();
    });
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("Test 3: rejects oversize file and does NOT call onFileSelected", async () => {
    const onFileSelected = vi.fn();
    render(<UploadStep onFileSelected={onFileSelected} />);
    const input = screen.getByTestId(
      "dataset-import-wizard-file-input",
    ) as HTMLInputElement;
    // 6 MB CSV
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.csv", {
      type: "text/csv",
    });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => {
      expect(
        screen.getByText("File is too large. Maximum is 5 MB."),
      ).toBeInTheDocument();
    });
    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it("Test 4: valid CSV → onFileSelected(file, csvText)", async () => {
    const onFileSelected = vi.fn();
    render(<UploadStep onFileSelected={onFileSelected} />);
    const input = screen.getByTestId(
      "dataset-import-wizard-file-input",
    ) as HTMLInputElement;
    const csv = new File(["a,b\n1,2\n"], "ok.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [csv] } });
    await waitFor(() => {
      expect(onFileSelected).toHaveBeenCalledTimes(1);
    });
    const [calledFile, calledText] = onFileSelected.mock.calls[0];
    expect(calledFile.name).toBe("ok.csv");
    expect(calledText).toBe("a,b\n1,2\n");
  });
});

// --------------------------- MapColumnsStep --------------------------------
describe("MapColumnsStep", () => {
  const params = [
    { name: "username", required: false },
    { name: "amount", required: true },
  ];

  it("Test 5: renders test-id + one row per CSV header", () => {
    render(
      <MapColumnsStep
        csvHeaders={["col_user", "col_amt"]}
        parameters={params}
        mapping={{ col_user: "username", col_amt: "amount" }}
        onMappingChange={vi.fn()}
        onValidityChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("dataset-import-wizard-step-map"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dataset-import-wizard-map-row-col_user"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("dataset-import-wizard-map-row-col_amt"),
    ).toBeInTheDocument();
    expect(screen.getByText("col_user")).toBeInTheDocument();
    expect(screen.getByText("col_amt")).toBeInTheDocument();
  });

  it("Test 6: auto-maps headers case-insensitively on mount when mapping is empty", async () => {
    const onMappingChange = vi.fn();
    render(
      <MapColumnsStep
        csvHeaders={["UserName", "Amount"]}
        parameters={params}
        mapping={{}}
        onMappingChange={onMappingChange}
        onValidityChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(onMappingChange).toHaveBeenCalled();
    });
    const lastCall = onMappingChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({
      UserName: "username",
      Amount: "amount",
    });
  });

  it("Test 7: required-but-unmapped warning fires onValidityChange(false)", () => {
    const onValidityChange = vi.fn();
    render(
      <MapColumnsStep
        csvHeaders={["username"]}
        parameters={params}
        mapping={{ username: "username" }} // 'amount' (required) is NOT mapped
        onMappingChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenCalledWith(false);
    // Warning text is rendered
    expect(
      screen.getByText(/Required parameter "@amount"/),
    ).toBeInTheDocument();
  });

  it("Test 8: all required mapped → onValidityChange(true)", () => {
    const onValidityChange = vi.fn();
    render(
      <MapColumnsStep
        csvHeaders={["username", "amount"]}
        parameters={params}
        mapping={{ username: "username", amount: "amount" }}
        onMappingChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    expect(onValidityChange).toHaveBeenCalledWith(true);
  });
});

// ----------------------------- PreviewStep ---------------------------------
describe("PreviewStep", () => {
  const params = [
    {
      name: "username",
      type: "STRING" as const,
      required: false,
    },
    {
      name: "amount",
      type: "INTEGER" as const,
      required: true,
    },
  ];

  it("Test 9: renders test-id + summary banner with totals when no errors", () => {
    render(
      <PreviewStep
        rows={[
          { username: "alice", amount: "100" },
          { username: "bob", amount: "200" },
        ]}
        mapping={{ username: "username", amount: "amount" }}
        parameters={params}
        onValidityChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("dataset-import-wizard-step-preview"),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 rows parsed/)).toBeInTheDocument();
  });

  it("Test 10: invokes onValidityChange with errorCount when rows fail validation", async () => {
    const onValidityChange = vi.fn();
    render(
      <PreviewStep
        rows={[
          { username: "alice", amount: "not-a-number" }, // bad INTEGER
          { username: "bob", amount: "200" },
        ]}
        mapping={{ username: "username", amount: "amount" }}
        parameters={params}
        onValidityChange={onValidityChange}
      />,
    );
    await waitFor(() => {
      expect(onValidityChange).toHaveBeenCalled();
    });
    const errCount = onValidityChange.mock.calls.at(-1)?.[0];
    expect(errCount).toBeGreaterThan(0);
  });

  it("Test 11: shows preview-limit copy and applies skip mapping", () => {
    render(
      <PreviewStep
        rows={[{ username: "alice", amount: "100", extra: "skipme" }]}
        mapping={{
          username: "username",
          amount: "amount",
          extra: "__skip__",
        }}
        parameters={params}
        onValidityChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Showing first 50 rows/),
    ).toBeInTheDocument();
    // The "extra" CSV column should not appear as a header
    expect(screen.queryByText("@extra")).not.toBeInTheDocument();
  });
});

// ----------------------------- ConfirmStep ---------------------------------
describe("ConfirmStep", () => {
  it("Test 12: renders RadioGroup with replace + append; default replace selected", () => {
    render(
      <ConfirmStep
        validRowCount={3}
        errorRowCount={0}
        existingRowCount={5}
        mode="replace"
        onModeChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("dataset-import-wizard-step-confirm"),
    ).toBeInTheDocument();
    expect(screen.getByText("Replace all existing rows")).toBeInTheDocument();
    expect(screen.getByText("Append to existing rows")).toBeInTheDocument();
    // Replace description has the existing count interpolated
    expect(
      screen.getByText(/Existing dataset rows \(5\) will be deleted/),
    ).toBeInTheDocument();
  });

  it("Test 13: when errorRowCount > 0, shows the error block alert", () => {
    render(
      <ConfirmStep
        validRowCount={1}
        errorRowCount={2}
        existingRowCount={0}
        mode="replace"
        onModeChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/Resolve 2 error\(s\)/),
    ).toBeInTheDocument();
  });

  it("Test 14: switching mode calls onModeChange", () => {
    const onModeChange = vi.fn();
    render(
      <ConfirmStep
        validRowCount={3}
        errorRowCount={0}
        existingRowCount={5}
        mode="replace"
        onModeChange={onModeChange}
      />,
    );
    const appendRadio = screen.getByLabelText("Append to existing rows");
    fireEvent.click(appendRadio);
    expect(onModeChange).toHaveBeenCalledWith("append");
  });
});
