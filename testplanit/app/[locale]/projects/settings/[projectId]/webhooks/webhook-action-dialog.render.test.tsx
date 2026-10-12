import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSave, mockTargets, mockToastError } = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockTargets: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => {
    const t = (key: string, params?: Record<string, unknown>) =>
      `${ns ? `${ns}.` : ""}${key}${params ? JSON.stringify(params) : ""}`;
    t.rich = (key: string, values: Record<string, any>) =>
      values.link ? values.link(key) : key;
    return t;
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) },
}));
vi.mock("~/app/actions/webhook-actions", () => ({
  saveWebhookAction: (...a: unknown[]) => mockSave(...a),
}));
vi.mock("@/components/runs/ExecuteAutomationButton", () => ({
  useExecutionTargetChoices: () => mockTargets(),
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/automation/ExecutionParamFields", () => ({
  ExecutionParamFields: () => null,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...rest }: any) => (
    <div data-testid={rest["data-testid"]}>{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      data-testid={rest["data-testid"]}
    />
  ),
}));
// A native select stands in for Radix Select; it takes the trigger's test id.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => {
    const parts = React.Children.toArray(children) as any[];
    const trigger = parts.find((c) => c.props?.["data-testid"]);
    const content = parts.find((c) => !c.props?.["data-testid"]);
    return (
      <select
        data-testid={trigger?.props["data-testid"]}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
      >
        <option value="" />
        {content?.props.children}
      </select>
    );
  },
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => (
    <option value={value}>{children}</option>
  ),
}));

import {
  WebhookActionDialog,
  type WebhookActionRow,
} from "./webhook-action-dialog";

const smoke = {
  id: 4,
  name: "Smoke suite",
  provider: "GITHUB_ACTIONS" as const,
  defaultRef: "main",
  isEnabled: true,
  paramSchema: [],
};
const nightly = { ...smoke, id: 5, name: "Nightly", defaultRef: null };

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof WebhookActionDialog>> = {}
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: 42,
    webhookConfigId: "whc-1",
    source: "repository" as const,
    rule: null,
    baseBranch: "main",
    onSaved: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const utils = render(<WebhookActionDialog {...props} />);
  return { ...utils, props };
}

function optionValues(testId: string) {
  return within(screen.getByTestId(testId))
    .getAllByRole("option")
    .map((o) => (o as HTMLOptionElement).value)
    .filter(Boolean);
}

describe("WebhookActionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    mockSave.mockResolvedValue({ success: true, id: "act-new" });
  });

  it("renders nothing while closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("webhook-action-dialog")).toBeNull();
  });

  it("offers a repository webhook's events and only Create test run", () => {
    renderDialog();

    expect(
      screen.getByText("projects.settings.webhooks.actions.addTitle")
    ).toBeInTheDocument();
    expect(optionValues("webhook-action-trigger")).toEqual([
      "CODE_PULL_REQUEST",
      "CODE_PUSH",
      "CODE_BRANCH_PUSH",
    ]);
    expect(
      screen.getByRole("option", {
        name: 'projects.settings.webhooks.codeRepos.eventPush{"branch":"main"}',
      })
    ).toBeInTheDocument();
    expect(
      (screen.getByTestId("webhook-action-trigger") as HTMLSelectElement).value
    ).toBe("CODE_PULL_REQUEST");
    expect(optionValues("webhook-action-type")).toEqual(["CREATE_RUN"]);
    expect(screen.getByTestId("webhook-action-type")).toBeDisabled();
    expect(screen.getByTestId("webhook-action-min-score")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-action-auto-execute")
    ).toBeInTheDocument();
  });

  it("offers a tracker webhook's events, switching the action when the event can't perform it", () => {
    renderDialog({ source: "tracker" });

    expect(optionValues("webhook-action-trigger")).toEqual([
      "ISSUE_EVENT",
      "ISSUE_CREATED",
      "ISSUE_STATUS_ENTERED",
    ]);
    expect(optionValues("webhook-action-type")).toEqual(["IMPORT_ISSUE"]);
    expect(screen.queryByTestId("webhook-action-min-score")).toBeNull();
    expect(screen.queryByTestId("webhook-action-auto-execute")).toBeNull();

    fireEvent.change(screen.getByTestId("webhook-action-trigger"), {
      target: { value: "ISSUE_CREATED" },
    });
    expect(optionValues("webhook-action-type")).toEqual([
      "IMPORT_ISSUE",
      "CREATE_RUN",
      "DRAFT_CASES",
    ]);
    fireEvent.change(screen.getByTestId("webhook-action-type"), {
      target: { value: "CREATE_RUN" },
    });
    // tracker rules have no minimum score but can execute
    expect(screen.queryByTestId("webhook-action-min-score")).toBeNull();
    expect(
      screen.getByTestId("webhook-action-auto-execute")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("webhook-action-trigger"), {
      target: { value: "ISSUE_EVENT" },
    });
    expect(
      (screen.getByTestId("webhook-action-type") as HTMLSelectElement).value
    ).toBe("IMPORT_ISSUE");
  });

  it("saves a new rule with its minimum score and closes", async () => {
    const { props } = renderDialog();

    fireEvent.change(screen.getByTestId("webhook-action-trigger"), {
      target: { value: "CODE_BRANCH_PUSH" },
    });
    fireEvent.change(screen.getByTestId("webhook-action-min-score"), {
      target: { value: "70" },
    });
    fireEvent.click(screen.getByTestId("webhook-action-save"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        projectId: 42,
        webhookConfigId: "whc-1",
        id: undefined,
        trigger: "CODE_BRANCH_PUSH",
        action: "CREATE_RUN",
        filter: {},
        options: { minScore: 70 },
      })
    );
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(["101", "-1", "12.5"])(
    "refuses a minimum score of %s",
    async (value) => {
      renderDialog();
      fireEvent.change(screen.getByTestId("webhook-action-min-score"), {
        target: { value },
      });
      fireEvent.click(screen.getByTestId("webhook-action-save"));
      expect(mockToastError).toHaveBeenCalledWith(
        "projects.settings.webhooks.codeRepos.minScoreInvalid"
      );
      expect(mockSave).not.toHaveBeenCalled();
    }
  );

  it("saves the auto-execute target and ref with the rule", async () => {
    renderDialog();

    fireEvent.click(screen.getByTestId("webhook-action-auto-execute-switch"));
    fireEvent.change(screen.getByTestId("webhook-action-auto-execute-ref"), {
      target: { value: "release" },
    });
    fireEvent.click(screen.getByTestId("webhook-action-save"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { autoExecute: { targetId: 4, ref: "release" } },
        })
      )
    );
  });

  it("can't be saved while execution is on without a target", () => {
    mockTargets.mockReturnValue({ data: [smoke, nightly], isLoading: false });
    renderDialog();

    fireEvent.click(screen.getByTestId("webhook-action-auto-execute-switch"));
    expect(screen.getByTestId("webhook-action-save")).toBeDisabled();

    fireEvent.change(screen.getByTestId("webhook-action-auto-execute-target"), {
      target: { value: "5" },
    });
    expect(screen.getByTestId("webhook-action-save")).toBeEnabled();
  });

  it("starts from the saved rule when editing and saves it by id", async () => {
    const rule: WebhookActionRow = {
      id: "act-1",
      order: 0,
      isEnabled: true,
      trigger: "CODE_PUSH",
      action: "CREATE_RUN",
      filter: {},
      options: { minScore: 40, autoExecute: { targetId: 4, ref: "hotfix" } },
    };
    renderDialog({ rule });

    expect(
      screen.getByText("projects.settings.webhooks.actions.editTitle")
    ).toBeInTheDocument();
    expect(
      (screen.getByTestId("webhook-action-trigger") as HTMLSelectElement).value
    ).toBe("CODE_PUSH");
    expect(
      (screen.getByTestId("webhook-action-min-score") as HTMLInputElement).value
    ).toBe("40");
    expect(
      screen.getByTestId("webhook-action-auto-execute-switch")
    ).toBeChecked();

    fireEvent.change(screen.getByTestId("webhook-action-min-score"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("webhook-action-save"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        projectId: 42,
        webhookConfigId: "whc-1",
        id: "act-1",
        trigger: "CODE_PUSH",
        action: "CREATE_RUN",
        filter: {},
        options: { autoExecute: { targetId: 4, ref: "hotfix" } },
      })
    );
  });

  it("keeps the stored filter and the options it doesn't edit", async () => {
    renderDialog({
      rule: {
        id: "act-2",
        order: 0,
        isEnabled: true,
        trigger: "CODE_PUSH",
        action: "CREATE_RUN",
        filter: { statuses: ["Ready"] },
        options: { minScore: 10, includeChildIssues: true },
      },
    });

    fireEvent.click(screen.getByTestId("webhook-action-save"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "act-2",
          filter: { statuses: ["Ready"] },
          options: { minScore: 10, includeChildIssues: true },
        })
      )
    );
  });

  it("keeps the dialog open and toasts the server's error", async () => {
    mockSave.mockResolvedValue({
      success: false,
      error: "Execution target is disabled",
    });
    const { props } = renderDialog();

    fireEvent.click(screen.getByTestId("webhook-action-save"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Execution target is disabled"
      )
    );
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("webhook-action-save")).toBeEnabled();
  });
});
