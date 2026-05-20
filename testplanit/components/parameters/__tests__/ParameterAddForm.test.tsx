import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-file next-intl mock returning concrete English copy.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      formName: "Name",
      formType: "Type",
      formDefault: "Default",
      formOrder: "Order",
      formRequired: "Required",
      formRequiredHelp: "Iterations missing this value will fail validation.",
      formSensitive: "Sensitive",
      formSensitiveHelp:
        "Hide value in audit logs and from users without read-sensitive permission.",
      formAdd: "Add parameter",
      selectSourceInline: "Inline list",
      selectSourceLookup: "Lookup dataset",
      selectAllowedValuesLabel: "Allowed values (one per line)",
      selectLookupDataSetLabel: "Lookup dataset",
      addSuccess: 'Parameter "{name}" added',
      addError: "Could not add parameter",
      toastVersionBumped: "Saved · created version {version}",
    };
    let value = dict[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
}));

// Mock data-set hook (used for the SELECT lookup combobox).
vi.mock("~/lib/hooks", () => ({
  useFindManyDataSet: () => ({ data: [] }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastMessage = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => toastSuccess(...args),
    error: (...args: any[]) => toastError(...args),
    message: (...args: any[]) => toastMessage(...args),
  },
}));

import { ParameterAddForm } from "@/components/parameters/ParameterAddForm";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("ParameterAddForm", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders Name, Type, Default, Required, Sensitive fields and submit button", () => {
    render(wrap(<ParameterAddForm caseId={1} projectId={2} />));
    expect(screen.getByTestId("parameter-form-name")).toBeInTheDocument();
    expect(screen.getByTestId("parameter-form-type")).toBeInTheDocument();
    expect(screen.getByTestId("parameter-form-default")).toBeInTheDocument();
    expect(screen.getByTestId("parameter-form-required")).toBeInTheDocument();
    expect(screen.getByTestId("parameter-form-sensitive")).toBeInTheDocument();
    expect(screen.getByTestId("parameter-form-submit")).toBeInTheDocument();
  });

  it("submit button has variant='default' (primary CTA on the tab)", () => {
    render(wrap(<ParameterAddForm caseId={1} projectId={2} />));
    const btn = screen.getByTestId("parameter-form-submit");
    // Variant=default produces 'bg-primary' in the buttonVariants cva.
    expect(btn.className).toMatch(/bg-primary/);
  });

  it("on valid submit POSTs to the parameters endpoint and toasts success + version-bump", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        parameter: {
          id: 99,
          name: "username",
          testCase: { currentVersion: 4 },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(wrap(<ParameterAddForm caseId={42} projectId={2} />));

    fireEvent.input(screen.getByTestId("parameter-form-name"), {
      target: { value: "username" },
    });
    fireEvent.click(screen.getByTestId("parameter-form-submit"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/repository/cases/42/parameters");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.name).toBe("username");
    expect(body.type).toBe("STRING");

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(toastMessage).toHaveBeenCalled();
  });

  it("on 400 server response toasts error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Validation failed" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(wrap(<ParameterAddForm caseId={1} projectId={2} />));
    fireEvent.input(screen.getByTestId("parameter-form-name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByTestId("parameter-form-submit"));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
  });

  it("does not submit when name is empty (Zod minLength enforced via zodResolver)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(wrap(<ParameterAddForm caseId={1} projectId={2} />));
    fireEvent.click(screen.getByTestId("parameter-form-submit"));

    // Give react-hook-form a tick to run validation
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
