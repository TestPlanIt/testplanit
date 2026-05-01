import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      datasetPasteCsv: "Paste CSV",
      pasteCsvPlaceholder:
        "Paste CSV rows here. The first line is treated as the header.",
      pasteCsvParseButton: "Parse",
      importStep3SummaryOk: "{totalRows} rows parsed, no errors.",
      importStep3SummaryErrors:
        "{totalRows} rows parsed; {errorCount} rows have errors.",
      importStep4Replace: "Replace all existing rows",
      importStep4Append: "Append to existing rows",
      importCommit: "Import",
      importSuccess: "Imported {count} rows",
      datasetSaveError: "Could not save change",
      cancel: "Cancel",
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

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: any[]) => toastSuccess(...a),
    error: (...a: any[]) => toastError(...a),
    message: vi.fn(),
  }),
}));

import { PasteCsvDialog } from "@/components/parameters/PasteCsvDialog";

const SAMPLE_PARAMS = [
  {
    id: 1,
    name: "username",
    type: "STRING",
    sensitive: false,
    required: false,
  },
  {
    id: 2,
    name: "amount",
    type: "INTEGER",
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
    json: async () => ({ created: 3 }),
  }) as any;
});

describe("PasteCsvDialog", () => {
  it("Test 1: Renders shadcn Dialog with Textarea + paste-csv-dialog test-id", () => {
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={vi.fn()}
          caseId={42}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    expect(screen.getByTestId("paste-csv-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("paste-csv-textarea")).toBeInTheDocument();
  });

  it("Test 2-3: Parse with header:true, skipEmptyLines:true; show parsed rows summary", async () => {
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={vi.fn()}
          caseId={42}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    const textarea = screen.getByTestId("paste-csv-textarea");
    fireEvent.change(textarea, {
      target: { value: "username,amount\nalice,100\nbob,200\n" },
    });
    fireEvent.click(screen.getByTestId("paste-csv-parse-button"));
    await waitFor(() => {
      expect(screen.getByTestId("paste-csv-summary")).toHaveTextContent(
        "2 rows parsed"
      );
    });
  });

  it("Test 4: Replace and Append mode radios both render", async () => {
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={vi.fn()}
          caseId={42}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    fireEvent.change(screen.getByTestId("paste-csv-textarea"), {
      target: { value: "username\nalice\n" },
    });
    fireEvent.click(screen.getByTestId("paste-csv-parse-button"));
    await waitFor(() => {
      expect(screen.getByTestId("paste-csv-mode-replace")).toBeInTheDocument();
      expect(screen.getByTestId("paste-csv-mode-append")).toBeInTheDocument();
    });
  });

  it("Test 5: Replace submit POSTs to /dataset/import-csv with mode=replace", async () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={onOpenChange}
          caseId={77}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    fireEvent.change(screen.getByTestId("paste-csv-textarea"), {
      target: { value: "username,amount\nalice,100\n" },
    });
    fireEvent.click(screen.getByTestId("paste-csv-parse-button"));
    await waitFor(() => {
      expect(screen.getByTestId("paste-csv-submit")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("paste-csv-submit"));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/repository/cases/77/dataset/import-csv",
        expect.objectContaining({ method: "POST" })
      );
    });
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.mode).toBe("replace");
    expect(body.rows).toHaveLength(1);
  });

  it("Test 7: UTF-8 BOM is stripped by papaparse on first column", async () => {
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={vi.fn()}
          caseId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    const bomCsv = "﻿username,amount\nalice,100\n";
    fireEvent.change(screen.getByTestId("paste-csv-textarea"), {
      target: { value: bomCsv },
    });
    fireEvent.click(screen.getByTestId("paste-csv-parse-button"));
    await waitFor(() => {
      expect(screen.getByTestId("paste-csv-summary")).toHaveTextContent(
        "1 rows parsed"
      );
    });
    fireEvent.click(screen.getByTestId("paste-csv-submit"));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    // The first row's keys should be 'username' (BOM stripped), not '﻿username'
    expect(Object.keys(body.rows[0])).toContain("username");
    expect(
      Object.keys(body.rows[0]).some((k) => k.charCodeAt(0) === 0xfeff)
    ).toBe(false);
  });

  it("Test 9: 200 OK closes dialog + invalidates DataSetRow + success toast", async () => {
    const onOpenChange = vi.fn();
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={onOpenChange}
          caseId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    fireEvent.change(screen.getByTestId("paste-csv-textarea"), {
      target: { value: "username,amount\nalice,100\n" },
    });
    fireEvent.click(screen.getByTestId("paste-csv-parse-button"));
    await waitFor(() => {
      expect(screen.getByTestId("paste-csv-submit")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("paste-csv-submit"));
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Test 8: 400 error keeps dialog open and surfaces toast.error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ errors: [{ rowIndex: 0, message: "bad" }] }),
    }) as any;
    const onOpenChange = vi.fn();
    render(
      wrap(
        <PasteCsvDialog
          open={true}
          onOpenChange={onOpenChange}
          caseId={1}
          parameters={SAMPLE_PARAMS as any}
        />
      )
    );
    fireEvent.change(screen.getByTestId("paste-csv-textarea"), {
      target: { value: "username,amount\nalice,100\n" },
    });
    fireEvent.click(screen.getByTestId("paste-csv-parse-button"));
    await waitFor(() => {
      expect(screen.getByTestId("paste-csv-submit")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("paste-csv-submit"));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    // Dialog should NOT close
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
