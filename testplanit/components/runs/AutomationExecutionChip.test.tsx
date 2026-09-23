import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: string | Date }) => (
    <span>{String(date)}</span>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { AutomationExecutionChip } from "./AutomationExecutionChip";

function execution(
  overrides: Partial<TestRunExecutionRow> = {}
): TestRunExecutionRow {
  return {
    id: 5,
    status: "SUCCEEDED",
    provider: "GENERIC_WEBHOOK",
    ref: null,
    externalRunId: null,
    externalUrl: null,
    externalStatus: null,
    error: null,
    selectionCount: 1,
    requestedCaseIds: [42],
    inputs: { BROWSER: "edge", TAGS: "smoke,regression" },
    dispatchedAt: null,
    resultsReceivedAt: null,
    completedAt: null,
    createdAt: "2026-09-23T10:00:00.000Z",
    target: {
      id: 3,
      name: "Jenkins",
      provider: "GENERIC_WEBHOOK",
      paramSchema: [
        {
          name: "BROWSER",
          label: "Browser",
          type: "select",
          values: ["chrome", "edge"],
          default: "chrome",
        },
        {
          name: "TAGS",
          label: "Tags",
          type: "multiselect",
          values: ["smoke", "regression"],
          default: [],
        },
      ],
    },
    requestedBy: { id: "u1", name: "Ada", email: null },
    ...overrides,
  };
}

function renderChip(executions: TestRunExecutionRow[]) {
  return render(
    <AutomationExecutionChip
      runId={7}
      executions={executions}
      canAddEdit
      isCompleted={false}
      onChanged={() => {}}
      onRetry={() => {}}
    />
  );
}

describe("AutomationExecutionChip parameters", () => {
  it("shows the chosen values inline and labels them in the tooltip", () => {
    renderChip([execution()]);
    expect(
      screen.getByTestId("automation-execution-inputs-summary")
    ).toHaveTextContent("edge · smoke, regression");
    const list = screen.getByTestId("automation-execution-inputs");
    expect(list).toHaveTextContent("Browser:edge");
    expect(list).toHaveTextContent("Tags:smoke, regression");
  });

  it("falls back to the input key when the target no longer declares it", () => {
    renderChip([
      execution({
        inputs: { SUITE: "api" },
        target: { id: 3, name: "Jenkins", provider: "GENERIC_WEBHOOK" },
      }),
    ]);
    expect(screen.getByTestId("automation-execution-inputs")).toHaveTextContent(
      "SUITE:api"
    );
  });

  it("renders no parameter block for an execution without inputs", () => {
    renderChip([execution({ inputs: {} })]);
    expect(
      screen.queryByTestId("automation-execution-inputs-summary")
    ).toBeNull();
    expect(screen.queryByTestId("automation-execution-inputs")).toBeNull();
  });
});
