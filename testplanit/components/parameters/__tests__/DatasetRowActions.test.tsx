import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      datasetSelectedCount: "{count} selected",
      datasetClearSelection: "Clear selection",
      datasetDeleteSelected: "Delete selected",
      datasetBulkDeleteTitle: "Delete {count} rows?",
      datasetBulkDeleteDescription: "This action cannot be undone.",
      cancel: "Cancel",
      delete: "Delete",
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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  }),
}));

import { DatasetRowActions } from "@/components/parameters/DatasetRowActions";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("DatasetRowActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
  });

  it("Test 16: renders {count} selected + Delete + Clear buttons", () => {
    render(
      wrap(
        <DatasetRowActions
          caseId={1}
          selectedRowIds={[10, 11, 12]}
          onClear={vi.fn()}
        />
      )
    );
    expect(screen.getByTestId("dataset-row-actions-count")).toHaveTextContent(
      "3 selected"
    );
    expect(
      screen.getByTestId("dataset-row-actions-delete")
    ).toBeInTheDocument();
    expect(screen.getByTestId("dataset-row-actions-clear")).toBeInTheDocument();
  });

  it("Clear button calls onClear", () => {
    const onClear = vi.fn();
    render(
      wrap(
        <DatasetRowActions caseId={1} selectedRowIds={[10]} onClear={onClear} />
      )
    );
    fireEvent.click(screen.getByTestId("dataset-row-actions-clear"));
    expect(onClear).toHaveBeenCalled();
  });

  it("Test 17: Delete opens AlertDialog; confirm fires DELETE /dataset/rows", async () => {
    const onClear = vi.fn();
    render(
      wrap(
        <DatasetRowActions
          caseId={42}
          selectedRowIds={[10, 11]}
          onClear={onClear}
        />
      )
    );
    fireEvent.click(screen.getByTestId("dataset-row-actions-delete"));
    // AlertDialog confirm button rendered
    const confirm = await screen.findByTestId(
      "dataset-row-actions-confirm-delete"
    );
    fireEvent.click(confirm);
    // give microtasks a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/repository/cases/42/dataset/rows",
      expect.objectContaining({
        method: "DELETE",
      })
    );
    const body = (global.fetch as any).mock.calls[0][1].body;
    expect(JSON.parse(body)).toEqual({ rowIds: [10, 11] });
  });
});
