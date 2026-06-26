import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: { useFindFirst: () => ({ data: mockTestCase }) },
    testRuns: {
      useFindFirst: () => ({
        data: { id: 42, configuration: null },
      }),
    },
    workflows: { useFindFirst: () => ({ data: null }) },
    status: {
      useFindMany: () => ({
        data: [successStatus, failureStatus, skippedStatus],
      }),
    },
    templateResultAssignment: { useFindMany: () => ({ data: [] }) },
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
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────

function mkIteration(
  status: IterationStatusDTO | null,
  overrides: Partial<IterationDTO> = {}
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

describe("IterationResultPanel — issue-linking lives in Add Result, not here", () => {
  // INT-05 originally added a standalone "Create linked Issue" button to
  // this panel. The button has been removed in favour of routing issue
  // creation through the existing Add Result form's Link Issue path:
  //
  //   1. One entry point for both parameterized and non-parameterized
  //      cases (consistency with the rest of the app).
  //   2. Forgot to link at submit time? Use Edit Result — same dialog,
  //      same Link Issue button.
  //   3. The Add Result form supports per-step linking, which the
  //      standalone button could not.
  //
  // The body builder + deep-link wiring + iteration-context plumbing
  // remain — they're now consumed via UnifiedIssueManager →
  // ManageExternalIssues → SearchIssuesDialog from inside Add Result.

  it.each([
    ["failure", failureStatus],
    ["success", successStatus],
    ["skipped", skippedStatus],
    ["no status yet", null],
  ] as const)(
    "does NOT render a Create-linked-Issue button regardless of iteration status (%s)",
    (_label, status) => {
      renderPanel(
        <IterationResultPanel {...baseProps} iteration={mkIteration(status)} />
      );
      expect(screen.queryByTestId("create-linked-issue-button")).toBeNull();
    }
  );

  it("does NOT mount SearchIssuesDialog from this panel", () => {
    renderPanel(
      <IterationResultPanel
        {...baseProps}
        iteration={mkIteration(failureStatus)}
      />
    );
    expect(screen.queryByTestId("search-issues-dialog")).toBeNull();
  });
});
