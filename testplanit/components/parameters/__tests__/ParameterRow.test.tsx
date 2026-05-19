import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const dict: Record<string, string> = {
      editAria: "Edit parameter",
      deleteAria: "Delete parameter",
      formRequired: "Required",
      formSensitive: "Sensitive",
    };
    return dict[key] ?? key;
  },
}));

// Stub the dialogs so the row test focuses on display-only contract.
vi.mock("@/components/parameters/ParameterDeleteDialog", () => ({
  ParameterDeleteDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="stub-delete-dialog" /> : null,
}));
vi.mock("@/components/parameters/ParameterRenameDialog", () => ({
  ParameterRenameDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="stub-rename-dialog" /> : null,
}));
vi.mock("@/components/parameters/SelectSourceSwitchDialog", () => ({
  SelectSourceSwitchDialog: () => null,
}));

import { ParameterRow } from "@/components/parameters/ParameterRow";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const baseParameter = {
  id: 1,
  name: "username",
  description: null,
  type: "STRING",
  defaultValue: null,
  order: 0,
  required: false,
  sensitive: false,
  testCaseId: 10,
  allowedValuesJson: null,
  lookupDataSetId: null,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("ParameterRow", () => {
  it("renders the parameter name and a drag handle (GripVertical svg)", () => {
    render(
      wrap(
        <ParameterRow
          parameter={baseParameter as any}
          caseId={10}
          projectId={2}
        />
      )
    );
    expect(
      screen.getByTestId(`parameter-row-${baseParameter.id}`)
    ).toBeInTheDocument();
    const handle = screen.getByTestId("parameter-row-drag-handle");
    expect(handle).toBeInTheDocument();
    expect(handle.querySelector("svg")).not.toBeNull();
  });

  it("renders edit and delete buttons", () => {
    render(
      wrap(
        <ParameterRow
          parameter={baseParameter as any}
          caseId={10}
          projectId={2}
        />
      )
    );
    expect(
      screen.getByTestId("parameter-row-edit-button")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("parameter-row-delete-button")
    ).toBeInTheDocument();
  });

  it("shows a Required badge when parameter.required is true", () => {
    render(
      wrap(
        <ParameterRow
          parameter={{ ...baseParameter, required: true } as any}
          caseId={10}
          projectId={2}
        />
      )
    );
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("shows a Sensitive badge when parameter.sensitive is true", () => {
    render(
      wrap(
        <ParameterRow
          parameter={{ ...baseParameter, sensitive: true } as any}
          caseId={10}
          projectId={2}
        />
      )
    );
    expect(screen.getByText("Sensitive")).toBeInTheDocument();
  });

  it("renders the type chip 'STRING' for a STRING parameter", () => {
    render(
      wrap(
        <ParameterRow
          parameter={baseParameter as any}
          caseId={10}
          projectId={2}
        />
      )
    );
    expect(screen.getByText("STRING")).toBeInTheDocument();
  });

  it("renders the type chip 'SELECT (inline)' for a SELECT inline parameter", () => {
    render(
      wrap(
        <ParameterRow
          parameter={
            {
              ...baseParameter,
              type: "SELECT",
              allowedValuesJson: ["USD", "EUR"],
            } as any
          }
          caseId={10}
          projectId={2}
        />
      )
    );
    expect(screen.getByText("SELECT (inline)")).toBeInTheDocument();
  });
});
