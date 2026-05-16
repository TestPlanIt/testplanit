import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "~/test/test-utils";

import type { IterationDTO, IterationStatusDTO } from "./types";

// ── Hooks mocks ───────────────────────────────────────────────────────
//
// IterationResultPanel pulls four ZenStack hooks: useFindFirstRepositoryCases,
// useFindFirstTestRuns, useFindFirstWorkflows, useFindManyStatus. Stub them
// so the panel can render without a query provider.

const mockTestCase = {
  id: 1,
  name: "Login flow",
  currentVersion: 1,
  steps: [],
};

const failureStatus = {
  id: 2,
  name: "Failed",
  color: { value: "rgb(255, 0, 0)" },
  isSuccess: false,
  isFailure: true,
  isCompleted: true,
  systemName: "failed",
};
const successStatus = {
  id: 1,
  name: "Passed",
  color: { value: "rgb(0, 200, 0)" },
  isSuccess: true,
  isFailure: false,
  isCompleted: true,
  systemName: "passed",
};
const skippedStatus = {
  id: 3,
  name: "Skipped",
  color: { value: "rgb(160, 160, 160)" },
  isSuccess: false,
  isFailure: false,
  isCompleted: true,
  systemName: "skipped",
};

vi.mock("~/lib/hooks", () => ({
  useFindFirstRepositoryCases: () => ({ data: mockTestCase }),
  useFindFirstTestRuns: () => ({
    data: { id: 42, configuration: null },
  }),
  useFindFirstWorkflows: () => ({ data: null }),
  useFindManyStatus: () => ({
    data: [successStatus, failureStatus, skippedStatus],
  }),
}));

vi.mock("~/lib/test-run-result-submit", () => ({
  submitTestRunResult: vi.fn(),
  isPermissionDeniedSubmitResultError: () => false,
}));

// AddResultModal is rendered conditionally — stub to avoid pulling its
// full dependency graph.
vi.mock("@/projects/repository/[projectId]/AddResultModal", () => ({
  AddResultModal: () => <div data-testid="add-result-modal" />,
}));

// Search-issues-dialog: capture the props so tests can assert against
// them (verifies the panel passes the correct iterationContext).
const searchIssuesDialogSpy = vi.fn();
vi.mock("@/components/issues/search-issues-dialog", () => ({
  SearchIssuesDialog: (props: any) => {
    searchIssuesDialogSpy(props);
    return props.open ? (
      <div
        data-testid="search-issues-dialog"
        data-iteration-id={props.iterationContext?.iterationId}
        data-test-run-id={props.iterationContext?.testRunId}
        data-test-run-case-id={props.iterationContext?.testRunCaseId}
      />
    ) : null;
  },
}));

import { IterationResultPanel } from "./IterationResultPanel";

// ── Render helper with QueryClientProvider ────────────────────────────
//
// The panel calls `useQueryClient()` to invalidate after submission; tests
// need a provider in scope or React Query throws.

function renderPanel(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

// ── Fixtures ──────────────────────────────────────────────────────────

function mkIteration(
  status: IterationStatusDTO | null,
  overrides: Partial<IterationDTO> = {},
): IterationDTO {
  return {
    id: 777,
    rowIndex: 2,
    label: "Bad password",
    valuesJson: { username: "alice", password: "x" },
    isCompleted: status?.isCompleted ?? false,
    status,
    ...overrides,
  };
}

const baseProps = {
  testRunId: 42,
  testRunCaseId: 88,
  caseId: 1,
  projectId: 7,
  totalIterations: 5,
  isDisabled: false,
  canAddEditResults: true,
};

describe("IterationResultPanel — Create linked Issue button (INT-05)", () => {
  it("renders Create linked Issue button when iteration status is a failure", () => {
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        iteration={mkIteration(failureStatus)}
      />,
    );
    expect(screen.getByTestId("create-linked-issue-button")).toBeTruthy();
  });

  it("does NOT render Create linked Issue button when iteration status is a success", () => {
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        iteration={mkIteration(successStatus)}
      />,
    );
    expect(screen.queryByTestId("create-linked-issue-button")).toBeNull();
  });

  it("does NOT render Create linked Issue button when iteration status is skipped", () => {
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        iteration={mkIteration(skippedStatus)}
      />,
    );
    expect(screen.queryByTestId("create-linked-issue-button")).toBeNull();
  });

  it("does NOT render Create linked Issue button when iteration has no status (not yet executed)", () => {
    renderPanel(
      <IterationResultPanel {...baseProps} iteration={mkIteration(null)} />,
    );
    expect(screen.queryByTestId("create-linked-issue-button")).toBeNull();
  });

  it("does NOT render Create linked Issue button when canAddEditResults is false", () => {
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        canAddEditResults={false}
        iteration={mkIteration(failureStatus)}
      />,
    );
    expect(screen.queryByTestId("create-linked-issue-button")).toBeNull();
  });

  it("clicking the button opens SearchIssuesDialog with iterationContext", async () => {
    const user = userEvent.setup();
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        iteration={mkIteration(failureStatus)}
      />,
    );
    const button = screen.getByTestId("create-linked-issue-button");
    await user.click(button);

    const dialog = await screen.findByTestId("search-issues-dialog");
    expect(dialog).toBeTruthy();
    // iterationContext prop values reflected in data attributes
    expect(dialog.getAttribute("data-iteration-id")).toBe("777");
    expect(dialog.getAttribute("data-test-run-id")).toBe("42");
    expect(dialog.getAttribute("data-test-run-case-id")).toBe("88");
  });

  it("dialog is not mounted on initial render (controlled-open pattern)", () => {
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        iteration={mkIteration(failureStatus)}
      />,
    );
    expect(screen.queryByTestId("search-issues-dialog")).toBeNull();
  });
});
