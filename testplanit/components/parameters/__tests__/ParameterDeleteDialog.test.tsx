import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (
    key: string,
    params?: Record<string, unknown>
  ) => {
    const parameters: Record<string, string> = {
      deleteTitle: 'Delete parameter "{name}"?',
      deleteDescription:
        "This parameter is referenced in {stepCount} step(s) and {rowCount} dataset row(s). Deleting will leave those references as plain text and bump this case to version {nextVersion}.",
      deleteConfirm: "Delete parameter",
      deleteSuccess: 'Parameter "{name}" deleted',
    };
    const common: Record<string, string> = { cancel: "Cancel" };
    const dict = namespace === "common" ? common : parameters;
    let value = dict[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    error: (...args: any[]) => toastError(...args),
    message: vi.fn(),
  },
}));

import { ParameterDeleteDialog } from "@/components/parameters/ParameterDeleteDialog";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("ParameterDeleteDialog", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("does not render when open is false", () => {
    render(
      wrap(
        <ParameterDeleteDialog
          open={false}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          paramName="username"
          currentCaseVersion={2}
        />
      )
    );
    expect(screen.queryByTestId("parameter-delete-dialog")).toBeNull();
  });

  it("on open, calls scan-references and shows the destructive Delete confirm button", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stepCount: 2, expectedCount: 1, rowCount: 4 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <ParameterDeleteDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          paramName="username"
          currentCaseVersion={2}
        />
      )
    );
    expect(
      screen.getByTestId("parameter-delete-dialog")
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/scan-references");
    const confirmButton = screen.getByTestId("parameter-delete-confirm");
    expect(confirmButton.className).toMatch(/bg-destructive/);
  });

  it("clicking confirm fires DELETE and toasts success", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("scan-references")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ stepCount: 0, expectedCount: 0, rowCount: 0 }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <ParameterDeleteDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          paramName="username"
          currentCaseVersion={2}
        />
      )
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId("parameter-delete-confirm"));
    await waitFor(() => {
      const deleteCall = calls.find(
        (c) => c.method === "DELETE" && c.url.endsWith("/parameters/1")
      );
      expect(deleteCall).toBeDefined();
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
  });
});
