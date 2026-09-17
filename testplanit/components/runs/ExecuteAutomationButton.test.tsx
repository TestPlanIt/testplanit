import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";

const { mockListTargets, mockDialog } = vi.hoisted(() => ({
  mockListTargets: vi.fn(),
  mockDialog: vi.fn(),
}));

vi.mock("~/app/actions/execution-targets", () => ({
  listExecutionTargetChoices: mockListTargets,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && "count" in values ? `${key}:${String(values.count)}` : key,
}));

vi.mock("@/components/ui/action-bar", () => ({
  useActionBarCompact: () => false,
  collapsibleActionClass: () => "",
  ActionButtonContent: ({ label }: { label: string }) => <span>{label}</span>,
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

vi.mock("./ExecuteAutomationDialog", () => ({
  ExecuteAutomationDialog: mockDialog,
  readExecuteError: async () => "error",
}));

import {
  ExecuteAutomationButton,
  requestedCaseIdsOf,
} from "./ExecuteAutomationButton";

type DialogProps = {
  open: boolean;
  caseCount: number;
  subset?: boolean;
  skippedCount?: number;
  submit: (req: { targetId: number; ref?: string }) => Promise<string | null>;
};

function lastDialogProps(): DialogProps {
  const calls = mockDialog.mock.calls;
  return calls[calls.length - 1][0] as DialogProps;
}

function renderButton(
  props: Partial<React.ComponentProps<typeof ExecuteAutomationButton>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ExecuteAutomationButton
        runId={7}
        projectId={1}
        canAddEdit
        isCompleted={false}
        automatedCaseIds={[101, 102, 103]}
        activeExecution={null}
        onDispatched={() => {}}
        variant="labelled"
        {...props}
      />
    </QueryClientProvider>
  );
}

describe("ExecuteAutomationButton", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockListTargets.mockResolvedValue({
      success: true,
      targets: [{ id: 1, name: "CI", isEnabled: true, defaultRef: null }],
    });
    mockDialog.mockImplementation(({ open }: DialogProps) =>
      open ? <div data-testid="dialog-open" /> : null
    );
    fetchMock.mockResolvedValue({ status: 202 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("requests every automated case when nothing is selected", async () => {
    renderButton();
    const button = await screen.findByTestId("execute-automation-button");
    expect(button).toHaveTextContent("button");
    expect(button).toBeEnabled();

    await waitFor(() => expect(lastDialogProps().caseCount).toBe(3));
    expect(lastDialogProps().subset).toBe(false);
    expect(lastDialogProps().skippedCount).toBe(0);

    await lastDialogProps().submit({ targetId: 1 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ targetId: 1 });
  });

  it("offers only the automated cases among the selected rows", async () => {
    renderButton({
      selectedCaseCount: 3,
      selectedAutomatedCaseIds: [101, 103],
    });
    const button = await screen.findByTestId("execute-automation-button");
    expect(button).toHaveTextContent("buttonSelected:2");
    expect(button).toBeEnabled();

    await waitFor(() => expect(lastDialogProps().caseCount).toBe(2));
    expect(lastDialogProps().subset).toBe(true);
    expect(lastDialogProps().skippedCount).toBe(1);

    await lastDialogProps().submit({ targetId: 1, ref: "main" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ targetId: 1, ref: "main", caseIds: [101, 103] });
  });

  it("is disabled when none of the selected rows are automated", async () => {
    renderButton({ selectedCaseCount: 2, selectedAutomatedCaseIds: [] });
    const button = await screen.findByTestId("execute-automation-button");
    expect(button).toHaveTextContent("buttonSelected:0");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "noAutomatedSelected"
    );
  });

  it("is disabled when the run has no automated cases", async () => {
    renderButton({ automatedCaseIds: [] });
    const button = await screen.findByTestId("execute-automation-button");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "noAutomatedCases"
    );
  });

  it("replays a retried execution's subset, dropping cases no longer automated", async () => {
    const retryOf = {
      id: 3,
      requestedCaseIds: [102, 999],
      ref: "release",
      target: { id: 1, name: "CI", provider: "GENERIC_WEBHOOK" },
    } as unknown as TestRunExecutionRow;
    renderButton({
      retryOf,
      open: true,
      onOpenChange: () => {},
      selectedCaseCount: 2,
      selectedAutomatedCaseIds: [101, 103],
    });
    await screen.findByTestId("execute-automation-button");
    await waitFor(() => expect(lastDialogProps().caseCount).toBe(1));
    expect(lastDialogProps().subset).toBe(true);
    expect(lastDialogProps().skippedCount).toBe(0);

    await lastDialogProps().submit({ targetId: 1 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.caseIds).toEqual([102]);
  });

  it("opens the dialog from the button", async () => {
    renderButton();
    const button = await screen.findByTestId("execute-automation-button");
    await userEvent.click(button);
    expect(await screen.findByTestId("dialog-open")).toBeInTheDocument();
  });
});

describe("requestedCaseIdsOf", () => {
  it("keeps only positive integers and treats anything else as a whole-run execution", () => {
    expect(requestedCaseIdsOf(null)).toEqual([]);
    expect(requestedCaseIdsOf({ requestedCaseIds: null })).toEqual([]);
    expect(requestedCaseIdsOf({ requestedCaseIds: "x" })).toEqual([]);
    expect(
      requestedCaseIdsOf({ requestedCaseIds: [5, "6", 0, -1, 2.5, 8] })
    ).toEqual([5, 8]);
  });
});
