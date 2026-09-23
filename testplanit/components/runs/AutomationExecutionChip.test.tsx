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
  it("offers a parameters icon whose tooltip labels the chosen values", () => {
    renderChip([execution()]);
    expect(
      screen.getByTestId("automation-execution-inputs-trigger")
    ).toBeInTheDocument();
    const list = screen.getByTestId("automation-execution-inputs");
    expect(list).toHaveTextContent("Browser:edge");
    expect(list).toHaveTextContent("Tags:smoke, regression");
  });

  it("lists other inputs the job received but never the reserved ids", () => {
    renderChip([
      execution({
        inputs: {
          BROWSER: "edge",
          FAIL_EVERY: "3",
          TESTPLANIT_RUN_ID: "60",
        },
      }),
    ]);
    const list = screen.getByTestId("automation-execution-inputs");
    expect(list).toHaveTextContent("Browser:edge");
    expect(list).toHaveTextContent("FAIL_EVERY:3");
    expect(list).not.toHaveTextContent("TESTPLANIT_RUN_ID");
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

  it("renders no parameters icon for an execution without inputs", () => {
    renderChip([execution({ inputs: {} })]);
    expect(
      screen.queryByTestId("automation-execution-inputs-trigger")
    ).toBeNull();
    expect(screen.queryByTestId("automation-execution-inputs")).toBeNull();
  });
});
