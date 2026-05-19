import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const dict: Record<string, string> = {
      emptyHeading: "No parameters yet",
      emptyBody: "Add your first parameter using the form above.",
    };
    return dict[key] ?? key;
  },
}));

// Stub the Add form + Row child components — those are tested in their
// own files; the Tab test only verifies orchestration.
vi.mock("@/components/parameters/ParameterAddForm", () => ({
  ParameterAddForm: () => <div data-testid="stub-add-form" />,
}));
vi.mock("@/components/parameters/ParameterRow", () => ({
  ParameterRow: ({ parameter }: { parameter: { id: number; name: string } }) => (
    <div data-testid={`stub-row-${parameter.id}`}>{parameter.name}</div>
  ),
}));

import { ParametersTab } from "@/components/parameters/ParametersTab";

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("ParametersTab", () => {
  it("renders the ParameterAddForm at the top", () => {
    render(
      wrap(<ParametersTab caseId={1} projectId={2} parameters={[]} />)
    );
    expect(screen.getByTestId("stub-add-form")).toBeInTheDocument();
  });

  it("renders the empty-state when no parameters exist", () => {
    render(
      wrap(<ParametersTab caseId={1} projectId={2} parameters={[]} />)
    );
    expect(screen.getByTestId("parameters-tab-empty")).toBeInTheDocument();
    expect(screen.getByText("No parameters yet")).toBeInTheDocument();
  });

  it("renders one row per existing parameter when the list is non-empty", () => {
    const params = [
      {
        id: 1,
        name: "username",
        type: "STRING",
        testCaseId: 1,
        order: 0,
        required: false,
        sensitive: false,
        isDeleted: false,
      },
      {
        id: 2,
        name: "amount",
        type: "INTEGER",
        testCaseId: 1,
        order: 1,
        required: true,
        sensitive: false,
        isDeleted: false,
      },
    ] as any;
    render(
      wrap(<ParametersTab caseId={1} projectId={2} parameters={params} />)
    );
    expect(screen.getByTestId("stub-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("stub-row-2")).toBeInTheDocument();
    expect(screen.queryByTestId("parameters-tab-empty")).toBeNull();
  });
});
