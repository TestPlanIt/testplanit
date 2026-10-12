import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTargets } = vi.hoisted(() => ({
  mockTargets: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = (key: string, values: Record<string, any>) =>
      values.link ? values.link(key) : key;
    return t;
  },
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
  WebhookAutoExecuteFields,
  autoExecuteDraftFrom,
  autoExecuteFromDraft,
  type AutoExecuteDraft,
} from "./webhook-auto-execute-fields";

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
const off: AutoExecuteDraft = {
  enabled: false,
  targetId: null,
  ref: "",
  inputs: {},
};

/** The fields are controlled; the harness keeps the draft like the dialog does. */
function renderFields(
  initial: AutoExecuteDraft = off,
  savedTargetId: number | null = null
) {
  const changes: AutoExecuteDraft[] = [];
  function Harness() {
    const [value, setValue] = React.useState(initial);
    return (
      <WebhookAutoExecuteFields
        projectId={42}
        idPrefix="rule"
        savedTargetId={savedTargetId}
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { latest: () => changes[changes.length - 1], changes };
}

describe("autoExecuteDraftFrom / autoExecuteFromDraft", () => {
  it("reads a saved option into a draft and an absent one as off", () => {
    expect(autoExecuteDraftFrom(null)).toEqual(off);
    expect(autoExecuteDraftFrom(undefined)).toEqual(off);
    expect(
      autoExecuteDraftFrom({ targetId: 4, ref: "main", inputs: { a: "1" } })
    ).toEqual({ enabled: true, targetId: 4, ref: "main", inputs: { a: "1" } });
    expect(autoExecuteDraftFrom({ targetId: 4 })).toEqual({
      enabled: true,
      targetId: 4,
      ref: "",
      inputs: {},
    });
  });

  it("stores nothing when off or without a target, and drops an empty ref and inputs", () => {
    expect(autoExecuteFromDraft(off)).toBeNull();
    expect(
      autoExecuteFromDraft({ ...off, enabled: true, targetId: null })
    ).toBeNull();
    expect(
      autoExecuteFromDraft({
        enabled: false,
        targetId: 4,
        ref: "x",
        inputs: {},
      })
    ).toBeNull();
    expect(
      autoExecuteFromDraft({
        enabled: true,
        targetId: 4,
        ref: "  ",
        inputs: {},
      })
    ).toEqual({ targetId: 4 });
    expect(
      autoExecuteFromDraft({
        enabled: true,
        targetId: 4,
        ref: " release ",
        inputs: { env: "qa" },
      })
    ).toEqual({ targetId: 4, ref: "release", inputs: { env: "qa" } });
  });
});

describe("WebhookAutoExecuteFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is disabled, with a link to add a target, when the project has none", () => {
    mockTargets.mockReturnValue({ data: [], isLoading: false });
    renderFields();

    expect(
      screen.getByTestId("webhook-action-auto-execute-switch")
    ).toBeDisabled();
    const hint = screen.getByTestId("webhook-action-auto-execute-no-targets");
    expect(hint.querySelector("a")?.getAttribute("href")).toBe(
      "/projects/settings/42/automation"
    );
  });

  it("counts only enabled targets as available", () => {
    mockTargets.mockReturnValue({
      data: [{ ...smoke, isEnabled: false }],
      isLoading: false,
    });
    renderFields();

    expect(
      screen.getByTestId("webhook-action-auto-execute-switch")
    ).toBeDisabled();
  });

  it("preselects the only target with its ref and parameter defaults", () => {
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    const { latest } = renderFields();

    fireEvent.click(screen.getByTestId("webhook-action-auto-execute-switch"));

    expect(
      (
        screen.getByTestId(
          "webhook-action-auto-execute-target"
        ) as HTMLSelectElement
      ).value
    ).toBe("4");
    expect(
      (
        screen.getByTestId(
          "webhook-action-auto-execute-ref"
        ) as HTMLInputElement
      ).value
    ).toBe("main");
    expect(latest()).toEqual({
      enabled: true,
      targetId: 4,
      ref: "main",
      inputs: { env: "staging" },
    });
  });

  it("leaves the target unchosen when several exist, and takes the one picked", () => {
    mockTargets.mockReturnValue({ data: [smoke, nightly], isLoading: false });
    const { latest } = renderFields();

    fireEvent.click(screen.getByTestId("webhook-action-auto-execute-switch"));
    expect(latest()).toMatchObject({ enabled: true, targetId: null });

    fireEvent.change(screen.getByTestId("webhook-action-auto-execute-target"), {
      target: { value: "5" },
    });
    expect(latest()).toMatchObject({ enabled: true, targetId: 5, inputs: {} });
  });

  it("starts the saved target from the saved inputs and reports edits", () => {
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    const { latest } = renderFields(
      { enabled: true, targetId: 4, ref: "release", inputs: { env: "prod" } },
      4
    );

    expect((screen.getByTestId("param-env") as HTMLInputElement).value).toBe(
      "prod"
    );
    fireEvent.change(screen.getByTestId("param-env"), {
      target: { value: "qa" },
    });
    expect(latest()).toMatchObject({
      targetId: 4,
      ref: "release",
      inputs: { env: "qa" },
    });

    fireEvent.change(screen.getByTestId("webhook-action-auto-execute-ref"), {
      target: { value: "hotfix" },
    });
    expect(latest()).toMatchObject({ ref: "hotfix", inputs: { env: "qa" } });
  });

  it("keeps a deleted target's setting on and warns that nothing is requested", () => {
    mockTargets.mockReturnValue({ data: [nightly], isLoading: false });
    renderFields({ enabled: true, targetId: 99, ref: "", inputs: {} }, 99);

    expect(
      screen.getByTestId("webhook-action-auto-execute-switch")
    ).toBeChecked();
    expect(
      screen.getByTestId("webhook-action-auto-execute-target-missing")
    ).toBeInTheDocument();
  });

  it("does not warn while the targets are still loading", () => {
    mockTargets.mockReturnValue({ data: undefined, isLoading: true });
    renderFields({ enabled: true, targetId: 99, ref: "", inputs: {} }, 99);

    expect(
      screen.queryByTestId("webhook-action-auto-execute-target-missing")
    ).toBeNull();
  });

  it("turns execution off and disables the switch when every target is gone", () => {
    mockTargets.mockReturnValue({ data: [], isLoading: false });
    const { latest } = renderFields(
      { enabled: true, targetId: 99, ref: "", inputs: { A: "1" } },
      99
    );

    expect(latest()).toEqual({
      enabled: false,
      targetId: null,
      ref: "",
      inputs: {},
    });
    const toggle = screen.getByTestId("webhook-action-auto-execute-switch");
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByTestId("webhook-action-auto-execute-target-missing")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-action-auto-execute-no-targets")
    ).toBeInTheDocument();
  });

  it("clears a gone target but keeps execution on when another target can be chosen", () => {
    mockTargets.mockReturnValue({ data: [smoke], isLoading: false });
    const { latest } = renderFields(
      { enabled: true, targetId: 99, ref: "main", inputs: {} },
      99
    );

    expect(latest()).toMatchObject({ enabled: true, targetId: null });
    expect(
      screen.getByTestId("webhook-action-auto-execute-switch")
    ).toBeEnabled();
    expect(
      screen.getByTestId("webhook-action-auto-execute-target-missing")
    ).toBeInTheDocument();
  });
});
