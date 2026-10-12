import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRules,
  mockLogs,
  mockRefetch,
  mockTargets,
  mockSetEnabled,
  mockReorder,
  mockDelete,
  mockDialog,
  mockToastError,
} = vi.hoisted(() => ({
  mockRules: vi.fn(),
  mockLogs: vi.fn(),
  mockRefetch: vi.fn(),
  mockTargets: vi.fn(),
  mockSetEnabled: vi.fn(),
  mockReorder: vi.fn(),
  mockDelete: vi.fn(),
  mockDialog: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (ns?: string) => (key: string, params?: Record<string, unknown>) =>
      `${ns ? `${ns}.` : ""}${key}${params ? JSON.stringify(params) : ""}`,
  useLocale: () => "en-US",
}));
let dragEnd: ((event: any) => void) | undefined;
vi.mock("@dnd-kit/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dnd-kit/core")>()),
  DndContext: ({ children, onDragEnd }: any) => {
    dragEnd = onDragEnd;
    return children;
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) },
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    webhookAction: { useFindMany: (...a: unknown[]) => mockRules(...a) },
    webhookActionLog: { useFindMany: (...a: unknown[]) => mockLogs(...a) },
  }),
}));
vi.mock("@/components/runs/ExecuteAutomationButton", () => ({
  useExecutionTargetChoices: () => mockTargets(),
}));
vi.mock("~/app/actions/webhook-actions", () => ({
  setWebhookActionEnabled: (...a: unknown[]) => mockSetEnabled(...a),
  reorderWebhookActions: (...a: unknown[]) => mockReorder(...a),
  deleteWebhookAction: (...a: unknown[]) => mockDelete(...a),
}));
vi.mock("./webhook-action-dialog", () => ({
  WebhookActionDialog: (props: any) => {
    mockDialog(props);
    return props.open ? (
      <div data-testid="dialog-probe" data-rule={props.rule?.id ?? "new"} />
    ) : null;
  },
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      data-testid={rest["data-testid"]}
    />
  ),
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: any) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children, ...rest }: any) => (
    <div data-testid={rest["data-testid"]}>{children}</div>
  ),
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} data-testid={rest["data-testid"]}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
}));

import { WebhookActionsSection } from "./webhook-actions-section";

const prRule = {
  id: "act-1",
  order: 0,
  isEnabled: true,
  trigger: "CODE_PULL_REQUEST",
  action: "CREATE_RUN",
  filter: {},
  options: { minScore: 70, autoExecute: { targetId: 4 } },
};
const pushRule = {
  id: "act-2",
  order: 1,
  isEnabled: false,
  trigger: "CODE_PUSH",
  action: "CREATE_RUN",
  filter: {},
  options: {},
};

function renderSection(baseBranch: string | null = "main") {
  return render(
    <WebhookActionsSection
      projectId={42}
      webhookConfigId="whc-1"
      source="repository"
      baseBranch={baseBranch}
    />
  );
}

describe("WebhookActionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefetch.mockResolvedValue(undefined);
    mockRules.mockReturnValue({
      data: [prRule, pushRule],
      refetch: mockRefetch,
    });
    mockLogs.mockReturnValue({
      data: [
        {
          webhookActionId: "act-1",
          outcome: "run_created",
          testRunId: 300,
          createdAt: new Date(Date.now() - 5 * 60_000),
        },
        {
          webhookActionId: "act-1",
          outcome: "no_cases",
          testRunId: null,
          createdAt: new Date(Date.now() - 60 * 60_000),
        },
      ],
    });
    mockTargets.mockReturnValue({
      data: [{ id: 4, name: "Smoke suite", isEnabled: true }],
    });
    mockSetEnabled.mockResolvedValue({ success: true });
    mockReorder.mockResolvedValue({ success: true });
    mockDelete.mockResolvedValue({ success: true });
  });

  it("queries the webhook's rules in order and its recent rule logs", () => {
    renderSection();
    expect(mockRules).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { webhookConfigId: "whc-1" },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      })
    );
    expect(mockLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { webhookConfigId: "whc-1", webhookActionId: { not: null } },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("lists each rule with its trigger, action, badges and switch", () => {
    renderSection();

    const pr = screen.getByTestId("webhook-action-row-act-1");
    expect(pr).toHaveTextContent(
      "projects.settings.webhooks.codeRepos.eventPullRequest"
    );
    expect(pr).toHaveTextContent("repository.cases.createTestRun");
    expect(pr).toHaveTextContent("runs.impact.affected.minScore: 70");
    expect(pr).toHaveTextContent("automation.execute.target: Smoke suite");
    expect(screen.queryByTestId("webhook-action-problem-act-1")).toBeNull();
    expect(screen.getByTestId("webhook-action-enabled-act-1")).toBeChecked();

    const push = screen.getByTestId("webhook-action-row-act-2");
    expect(push).toHaveTextContent(
      'projects.settings.webhooks.codeRepos.eventPush{"branch":"main"}'
    );
    expect(push).not.toHaveTextContent("minScore");
    expect(
      screen.getByTestId("webhook-action-enabled-act-2")
    ).not.toBeChecked();
  });

  it("labels a push without a known base branch generically, and an unknown target with a dash", () => {
    mockTargets.mockReturnValue({ data: [] });
    renderSection(null);
    expect(screen.getByTestId("webhook-action-row-act-2")).toHaveTextContent(
      "projects.settings.webhooks.codeRepos.eventPushDefault"
    );
    expect(screen.getByTestId("webhook-action-row-act-1")).toHaveTextContent(
      "automation.execute.target: —"
    );
    expect(
      screen.getByTestId("webhook-action-problem-act-1")
    ).toHaveTextContent("automation.execute.target: —");
  });

  it("flags a disabled target as a problem but names it", () => {
    mockTargets.mockReturnValue({
      data: [{ id: 4, name: "Smoke suite", isEnabled: false }],
    });
    renderSection();
    expect(
      screen.getByTestId("webhook-action-problem-act-1")
    ).toHaveTextContent("automation.execute.target: Smoke suite");
  });

  it("flags nothing while the targets are still loading", () => {
    mockTargets.mockReturnValue({ data: undefined });
    renderSection();
    expect(screen.queryByTestId("webhook-action-problem-act-1")).toBeNull();
  });

  it("shows each rule's latest outcome with a link to its run, or never", () => {
    renderSection();

    const last = screen.getByTestId("webhook-action-last-act-1");
    expect(last).toHaveTextContent("repository.duplicates.lastRunLabel:");
    expect(last).toHaveTextContent("5 minutes ago");
    expect(last).toHaveTextContent(
      "projects.settings.webhooks.events.testRunCreated"
    );
    expect(last).not.toHaveTextContent("common.labels.noCases");
    expect(within(last).getByRole("link")).toHaveAttribute(
      "href",
      "/projects/runs/42/300"
    );
    expect(within(last).getByRole("link")).toHaveTextContent(
      "common.labels.viewTestRunDetails"
    );

    expect(screen.getByTestId("webhook-action-last-act-2")).toHaveTextContent(
      "repository.duplicates.lastRunLabel: common.never"
    );
  });

  it.each([
    ["no_cases", "common.labels.noCases"],
    ["no_workflow", "admin.imports.testmo.mapping.noWorkflowsAvailable"],
    ["error", "projects.settings.webhooks.filterStatusFailed"],
    [
      "already_composed",
      "projects.settings.webhooks.actions.outcome.already_composed",
    ],
    [
      "execute_failed",
      "projects.settings.webhooks.actions.outcome.execute_failed",
    ],
    ["something_new", "something_new"],
  ])("labels a %s outcome", (outcome, label) => {
    mockLogs.mockReturnValue({
      data: [
        {
          webhookActionId: "act-2",
          outcome,
          testRunId: null,
          createdAt: new Date(),
        },
      ],
    });
    renderSection();
    const last = screen.getByTestId("webhook-action-last-act-2");
    expect(last).toHaveTextContent(label);
    expect(within(last).queryByRole("link")).toBeNull();
  });

  it("labels an imported issue's outcome as an issue created", () => {
    mockLogs.mockReturnValue({
      data: [
        {
          webhookActionId: "act-2",
          outcome: "issue_imported",
          testRunId: null,
          createdAt: new Date(),
        },
      ],
    });
    renderSection();
    expect(screen.getByTestId("webhook-action-last-act-2")).toHaveTextContent(
      "projects.settings.webhooks.events.issueCreated"
    );
  });

  describe("tracker rules", () => {
    const statusRule = {
      id: "trk-1",
      order: 0,
      isEnabled: true,
      trigger: "ISSUE_STATUS_ENTERED",
      action: "CREATE_RUN",
      filter: {
        statuses: ["Ready for QA", "In Review"],
        issueTypeIds: ["10001", "10002", "10011"],
        issueTypeNames: { "10001": "Story", "10011": "Story" },
        labels: ["qa", "backend"],
        requirementsOnly: true,
      },
      options: { includeChildIssues: true },
    };
    const importRule = {
      id: "trk-2",
      order: 1,
      isEnabled: true,
      trigger: "ISSUE_EVENT",
      action: "IMPORT_ISSUE",
      filter: {},
      // An import rule never shows run options, even stored ones.
      options: { includeChildIssues: true },
    };

    function renderTracker() {
      return render(
        <WebhookActionsSection
          projectId={42}
          webhookConfigId="whc-2"
          source="tracker"
          baseBranch={null}
          integration={{ id: 3, provider: "JIRA" }}
        />
      );
    }

    beforeEach(() => {
      mockRules.mockReturnValue({
        data: [statusRule, importRule],
        refetch: mockRefetch,
      });
      mockLogs.mockReturnValue({ data: [] });
    });

    it("shows the filter and child-issue badges, naming issue types where it can", () => {
      renderTracker();

      const row = screen.getByTestId("webhook-action-row-trk-1");
      expect(row).toHaveTextContent(
        "projects.settings.webhooks.actions.trigger.ISSUE_STATUS_ENTERED"
      );
      expect(row).toHaveTextContent(
        "common.labels.statuses: Ready for QA, In Review"
      );
      expect(row).toHaveTextContent(
        "projects.settings.integrations.integration.requirementsConfig.issueTypesLabel: Story, 10002"
      );
      expect(row).toHaveTextContent(
        "projects.settings.integrations.integration.requirementsConfig.labelsLabel: qa, backend"
      );
      expect(row).toHaveTextContent(
        "projects.settings.webhooks.actions.requirementsOnly"
      );
      expect(row).toHaveTextContent(
        "projects.settings.webhooks.actions.includeChildIssues"
      );
    });

    it("shows no badges for an unfiltered import rule", () => {
      renderTracker();
      const row = screen.getByTestId("webhook-action-row-trk-2");
      expect(row).not.toHaveTextContent("includeChildIssues");
      expect(row).not.toHaveTextContent("common.labels.statuses");
    });

    it("hands the dialog the tracker source and the integration", () => {
      renderTracker();
      fireEvent.click(screen.getByTestId("webhook-action-edit-trk-1"));
      expect(mockDialog.mock.calls.at(-1)![0]).toMatchObject({
        webhookConfigId: "whc-2",
        source: "tracker",
        integration: { id: 3, provider: "JIRA" },
        rule: expect.objectContaining({ id: "trk-1" }),
      });
    });
  });

  it("shows the empty state when the webhook has no rules", () => {
    mockRules.mockReturnValue({ data: [], refetch: mockRefetch });
    mockLogs.mockReturnValue({ data: undefined });
    renderSection();
    expect(screen.getByTestId("webhook-actions-empty")).toHaveTextContent(
      "projects.settings.webhooks.actions.empty"
    );
  });

  it("opens the dialog to add a rule, and to edit one", () => {
    renderSection();
    expect(screen.queryByTestId("dialog-probe")).toBeNull();

    fireEvent.click(screen.getByTestId("webhook-action-add"));
    expect(screen.getByTestId("dialog-probe")).toHaveAttribute(
      "data-rule",
      "new"
    );
    expect(mockDialog.mock.calls.at(-1)![0]).toMatchObject({
      projectId: 42,
      webhookConfigId: "whc-1",
      source: "repository",
      baseBranch: "main",
      rule: null,
    });

    fireEvent.click(screen.getByTestId("webhook-action-edit-act-2"));
    expect(screen.getByTestId("dialog-probe")).toHaveAttribute(
      "data-rule",
      "act-2"
    );
  });

  it("toggles a rule and refetches", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("webhook-action-enabled-act-2"));
    await waitFor(() =>
      expect(mockSetEnabled).toHaveBeenCalledWith({
        projectId: 42,
        id: "act-2",
        isEnabled: true,
      })
    );
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  });

  it("toasts a failed toggle", async () => {
    mockSetEnabled.mockResolvedValue({ success: false, error: "Forbidden" });
    renderSection();
    fireEvent.click(screen.getByTestId("webhook-action-enabled-act-1"));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Forbidden")
    );
  });

  it("saves the order a rule is dragged into", async () => {
    renderSection();
    expect(screen.getByTestId("webhook-action-drag-act-1")).toHaveAttribute(
      "aria-label",
      "projects.settings.webhooks.actions.dragToReorder"
    );

    dragEnd!({ active: { id: "act-1" }, over: { id: "act-2" } });

    await waitFor(() =>
      expect(mockReorder).toHaveBeenCalledWith({
        projectId: 42,
        webhookConfigId: "whc-1",
        orderedIds: ["act-2", "act-1"],
      })
    );
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  });

  it("does nothing when a rule is dropped where it started", () => {
    renderSection();
    dragEnd!({ active: { id: "act-1" }, over: { id: "act-1" } });
    dragEnd!({ active: { id: "act-1" }, over: null });
    expect(mockReorder).not.toHaveBeenCalled();
  });

  it("deletes a rule after confirmation", async () => {
    renderSection();
    expect(screen.queryByTestId("webhook-action-delete-dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("webhook-action-delete-act-1"));
    const dialog = screen.getByTestId("webhook-action-delete-dialog");
    expect(dialog).toHaveTextContent("common.actions.confirmDelete");
    expect(dialog).toHaveTextContent("common.dialogs.delete.description");
    expect(mockDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("webhook-action-delete-confirm"));
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({ projectId: 42, id: "act-1" })
    );
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
    expect(screen.queryByTestId("webhook-action-delete-dialog")).toBeNull();
  });
});
