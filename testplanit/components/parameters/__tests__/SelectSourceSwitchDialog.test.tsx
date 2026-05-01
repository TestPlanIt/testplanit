import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (
    key: string,
    params?: Record<string, unknown>
  ) => {
    const parameters: Record<string, string> = {
      selectSourceWarningTitle:
        'Change SELECT source for "@{name}"?',
      selectSourceWarningDescription:
        "Existing dataset values for this parameter may not exist in the new list. {invalidCount, plural, =1 {# row will} other {# rows will}} need attention after this change. Continue?",
      selectSourceConfirm: "Change source",
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
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

import { SelectSourceSwitchDialog } from "@/components/parameters/SelectSourceSwitchDialog";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("SelectSourceSwitchDialog", () => {
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
        <SelectSourceSwitchDialog
          open={false}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          paramName="currency"
          invalidCount={0}
          newSource={{ allowedValuesJson: ["USD"], lookupDataSetId: null }}
        />
      )
    );
    expect(
      screen.queryByTestId("select-source-switch-dialog")
    ).toBeNull();
  });

  it("renders the warning title and confirm button when open and invalidCount > 0", () => {
    render(
      wrap(
        <SelectSourceSwitchDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          paramName="currency"
          invalidCount={3}
          newSource={{ allowedValuesJson: ["USD"], lookupDataSetId: null }}
        />
      )
    );
    expect(
      screen.getByTestId("select-source-switch-dialog")
    ).toBeInTheDocument();
    const confirmButton = screen.getByTestId("select-source-switch-confirm");
    // Default variant on confirm; never destructive.
    expect(confirmButton.className).not.toMatch(/bg-destructive/);
  });

  it("PATCH on confirm includes both allowedValuesJson and lookupDataSetId from the newSource prop", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
      calls.push({ url, body: init?.body });
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      wrap(
        <SelectSourceSwitchDialog
          open={true}
          onOpenChange={() => {}}
          caseId={10}
          paramId={1}
          paramName="currency"
          invalidCount={2}
          newSource={{ allowedValuesJson: null, lookupDataSetId: 7 }}
        />
      )
    );

    const button = screen.getByTestId("select-source-switch-confirm");
    button.click();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const body = JSON.parse(calls[0].body ?? "{}");
    expect(body.allowedValuesJson).toBeNull();
    expect(body.lookupDataSetId).toBe(7);
  });
});
