import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSave, mockTargets, mockToastError } = vi.hoisted(() => ({
  mockSave: vi.fn(),
  mockTargets: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = (key: string, values: Record<string, any>) =>
      values.link ? values.link(key) : key;
    return t;
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) },
}));
vi.mock("~/app/actions/webhook-config", () => ({
  updateCodeRepositoryWebhookAutoExecute: (...a: unknown[]) => mockSave(...a),
}));
vi.mock("@/components/runs/ExecuteAutomationButton", () => ({
  useExecutionTargetChoices: () => mockTargets(),
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
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
  Select: ({ value, onValueChange, children }: any) => {
    const parts = React.Children.toArray(children) as any[];
    const trigger = parts.find((c) => c.props?.["data-testid"]);
    const content = parts.find((c) => !c.props?.["data-testid"]);
    return (
      <select
        data-testid={trigger?.props["data-testid"]}
        value={value}
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
vi.mock("@/components/automation/ExecutionParamFields", () => ({
  ExecutionParamFields: ({ params, values, onChange }: any) => (
    <div data-testid="params">
      {params.map((p: any) => (
        <input
          key={p.name}
          data-testid={`param-${p.name}`}
          value={values[p.name] ?? ""}
          onChange={(e) =>
            onChange((cur: any) => ({ ...cur, [p.name]: e.target.value }))
          }
        />
      ))}
    </div>
  ),
}));

import {
  RepositoryWebhookAutoExecute,
  type AutoExecuteSettings,
} from "./repository-webhook-auto-execute";

const smoke = {
  id: 4,
  name: "Smoke suite",
  provider: "GITHUB_ACTIONS" as const,
  defaultRef: "main",
  isEnabled: true,
  paramSchema: [
    { name: "env", label: "Env", type: "text" as const, default: "staging" },
  ],
};
const nightly = {
  id: 5,
  name: "Nightly",
  provider: "GITLAB_CI" as const,
  defaultRef: null,
  isEnabled: true,
  paramSchema: [],
};
const off: AutoExecuteSettings = {
  autoExecuteEnabled: false,
  autoExecuteTargetId: null,
  autoExecuteRef: null,
  autoExecuteInputs: {},
};

function renderSection(settings: AutoExecuteSettings = off) {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <RepositoryWebhookAutoExecute
      projectId={42}
      webhookConfigId="whc-1"
      settings={settings}
      onChanged={onChanged}
    />
  );
  return { onChanged };
}

describe("RepositoryWebhookAutoExecute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockResolvedValue({ success: true });
  });

  it("is disabled, with a link to add a target, when the project has none", () => {
    mockTargets.mockReturnValue({ data: [], isLoading: false });
    renderSection();

    expect(
      screen.getByTestId("webhook-repository-auto-execute-switch")
    ).toBeDisabled();
    const hint = screen.getByTestId(
      "webhook-repository-auto-execute-no-targets"
    );
    expect(hint.querySelector("a")?.getAttribute("href")).toBe(
      "/projects/settings/42/automation"
    );
  });

  it("counts only enabled targets as available", () => {
    mockTargets.mockReturnValue({
      data: [{ ...smoke, isEnabled: false }],
      isLoading: false,
    });
    renderSection();

    expect(
      screen.getByTestId("webhook-repository-auto-execute-switch")
    ).toBeDisabled();
  });

  it("preselects the only target and saves its ref and parameter defaults", async () => {
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    const { onChanged } = renderSection();

    fireEvent.click(screen.getByTestId("webhook-repository-auto-execute-switch"));
    expect(
      (
        screen.getByTestId(
          "webhook-repository-auto-execute-target"
        ) as HTMLSelectElement
      ).value
    ).toBe("4");
    expect(
      (
        screen.getByTestId(
          "webhook-repository-auto-execute-ref"
        ) as HTMLInputElement
      ).value
    ).toBe("main");

    fireEvent.click(screen.getByTestId("webhook-repository-auto-execute-save"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        projectId: 42,
        webhookConfigId: "whc-1",
        enabled: true,
        targetId: 4,
        ref: "main",
        inputs: { env: "staging" },
      })
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("needs a target chosen before it can be saved when several exist", () => {
    mockTargets.mockReturnValue({ data: [smoke, nightly], isLoading: false });
    renderSection();

    fireEvent.click(screen.getByTestId("webhook-repository-auto-execute-switch"));

    expect(
      screen.getByTestId("webhook-repository-auto-execute-save")
    ).toBeDisabled();
    fireEvent.change(
      screen.getByTestId("webhook-repository-auto-execute-target"),
      { target: { value: "5" } }
    );
    expect(
      screen.getByTestId("webhook-repository-auto-execute-save")
    ).toBeEnabled();
  });

  it("shows the saved inputs for the saved target and no Save until edited", () => {
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    renderSection({
      autoExecuteEnabled: true,
      autoExecuteTargetId: 4,
      autoExecuteRef: "release",
      autoExecuteInputs: { env: "prod" },
    });

    expect(
      (screen.getByTestId("param-env") as HTMLInputElement).value
    ).toBe("prod");
    expect(
      screen.queryByTestId("webhook-repository-auto-execute-save")
    ).toBeNull();

    fireEvent.change(screen.getByTestId("param-env"), {
      target: { value: "qa" },
    });
    expect(
      screen.getByTestId("webhook-repository-auto-execute-save")
    ).toBeInTheDocument();
  });

  it("keeps a deleted target's setting on and warns that nothing is requested", () => {
    mockTargets.mockReturnValue({ data: [nightly], isLoading: false });
    renderSection({
      autoExecuteEnabled: true,
      autoExecuteTargetId: 99,
      autoExecuteRef: null,
      autoExecuteInputs: {},
    });

    expect(
      screen.getByTestId("webhook-repository-auto-execute-switch")
    ).toBeChecked();
    expect(
      screen.getByTestId("webhook-repository-auto-execute-target-missing")
    ).toBeInTheDocument();
  });

  it("can still be turned off when every target is gone", async () => {
    mockTargets.mockReturnValue({ data: [], isLoading: false });
    renderSection({
      autoExecuteEnabled: true,
      autoExecuteTargetId: 99,
      autoExecuteRef: null,
      autoExecuteInputs: {},
    });

    const toggle = screen.getByTestId("webhook-repository-auto-execute-switch");
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("webhook-repository-auto-execute-save"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false, targetId: 99 })
      )
    );
  });

  it("toasts the server's error and keeps Save visible", async () => {
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    mockSave.mockResolvedValueOnce({
      success: false,
      error: "Execution target is disabled",
    });
    renderSection();

    fireEvent.click(screen.getByTestId("webhook-repository-auto-execute-switch"));
    fireEvent.click(screen.getByTestId("webhook-repository-auto-execute-save"));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        "Execution target is disabled"
      )
    );
    expect(
      screen.getByTestId("webhook-repository-auto-execute-save")
    ).toBeInTheDocument();
  });
});
