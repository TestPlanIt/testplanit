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
      renameTitle: 'Rename "@{oldName}" to "@{newName}"?',
      renameDescriptionLead:
        "This will rewrite {totalCount, plural, =1 {# reference} other {# references}}:",
      renameDescriptionStepCount:
        "{stepCount, plural, =1 {# step text reference} other {# step text references}}",
      renameDescriptionExpectedCount:
        "{expectedCount, plural, =1 {# expected-result reference} other {# expected-result references}}",
      renameDescriptionRowCount:
        "{rowCount, plural, =1 {# dataset row} other {# dataset rows}}",
      renameDescriptionVersion:
        "This will create version {nextVersion} of this test case.",
      renameConfirm: "Rename",
      renameNoRefsToast: "Parameter renamed (no existing references)",
      updateSuccess: "Parameter saved",
      toastVersionBumped: "Saved · created version {version}",
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
const toastMessage = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    message: (...args: any[]) => toastMessage(...args),
    error: (...args: any[]) => toastError(...args),
  },
}));

import { ParameterRenameDialog } from "@/components/parameters/ParameterRenameDialog";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("ParameterRenameDialog", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("on open with refs > 0, renders the dialog with the constructive (non-destructive) confirm button", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ stepCount: 1, expectedCount: 0, rowCount: 0 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <ParameterRenameDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          oldName="user"
          newName="username"
          currentCaseVersion={2}
          onComplete={() => {}}
        />
      )
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByTestId("parameter-rename-dialog")).toBeInTheDocument();
    const confirmButton = screen.getByTestId("parameter-rename-confirm");
    // Default variant uses bg-primary; destructive uses bg-destructive.
    expect(confirmButton.className).not.toMatch(/bg-destructive/);
  });

  it("when scan returns zero references, fires PATCH directly without showing the dialog body", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("scan-references")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ stepCount: 0, expectedCount: 0, rowCount: 0 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          parameter: { testCase: { currentVersion: 3 } },
        }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const onOpenChange = vi.fn();
    const onComplete = vi.fn();
    render(
      wrap(
        <ParameterRenameDialog
          open={true}
          onOpenChange={onOpenChange}
          caseId={10}
          paramId={1}
          oldName="user"
          newName="username"
          currentCaseVersion={2}
          onComplete={onComplete}
        />
      )
    );

    await waitFor(() => {
      const patchCall = calls.find((c) => c.method === "PATCH");
      expect(patchCall).toBeDefined();
    });
    await waitFor(() => {
      expect(toastMessage).toHaveBeenCalled();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clicking confirm fires PATCH with the new name", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body,
      });
      if (url.includes("scan-references")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ stepCount: 1, expectedCount: 0, rowCount: 0 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          parameter: { testCase: { currentVersion: 3 } },
        }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <ParameterRenameDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          oldName="user"
          newName="username"
          currentCaseVersion={2}
          onComplete={() => {}}
        />
      )
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("parameter-rename-confirm"));

    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch!.body).toContain('"name":"username"');
    });
  });
});
