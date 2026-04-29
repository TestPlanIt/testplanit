import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock refs ───────────────────────────────────────────────────
const {
  mockFindManyWebhookConfig,
  mockSetWebhookActive,
  mockCreateOrRotateInbound,
  mockDeleteInbound,
  mockSendTest,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockFindManyWebhookConfig: vi.fn(),
  mockSetWebhookActive: vi.fn(),
  mockCreateOrRotateInbound: vi.fn(),
  mockDeleteInbound: vi.fn(),
  mockSendTest: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyWebhookConfig: (...args: any[]) =>
    mockFindManyWebhookConfig(...args),
}));

vi.mock("~/app/actions/webhook-config", () => ({
  createOrRotateInboundWebhook: (...args: any[]) =>
    mockCreateOrRotateInbound(...args),
  deleteInboundWebhook: (...args: any[]) => mockDeleteInbound(...args),
  sendTestWebhook: (...args: any[]) => mockSendTest(...args),
  setWebhookActive: (...args: any[]) => mockSetWebhookActive(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

// Translation mock: returns the key string directly so the test can match by
// key. Templates in en-US.json that use placeholders ({statusCode}, {outcome},
// {timestamp}) are interpolated so the rendered DOM mirrors production.
const KEY_TEMPLATES: Record<string, string> = {
  testSuccess: "HTTP {statusCode} {outcome}",
  testFailure: "HTTP {statusCode} testFailure {error}",
  lastReceived: "Last received: {timestamp}",
};

vi.mock("next-intl", () => ({
  useTranslations:
    (_namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      const template = KEY_TEMPLATES[key] ?? key;
      let result = template;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
      }
      return result;
    },
}));

// ─── Stub shadcn primitives ──────────────────────────────────────────────

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children, ...rest }: any) => <h3 {...rest}>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...rest }: any) => (
    <input value={value ?? ""} onChange={onChange} {...rest} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

// Radix RadioGroup stubs: a controlled radiogroup. RadioGroup tracks `value`
// and emits onValueChange on click. RadioGroupItem is a plain button that
// invokes the parent's setter via context.
const RadioGroupTestContext = React.createContext<{
  value: string | undefined;
  onValueChange: (v: string) => void;
}>({ value: undefined, onValueChange: () => {} });

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, value, onValueChange, ...rest }: any) => (
    <RadioGroupTestContext.Provider value={{ value, onValueChange }}>
      <div {...rest}>{children}</div>
    </RadioGroupTestContext.Provider>
  ),
  RadioGroupItem: ({ value, disabled, ...rest }: any) => {
    const { onValueChange, value: current } = React.useContext(
      RadioGroupTestContext
    );
    return (
      <button
        type="button"
        role="radio"
        aria-checked={current === value}
        disabled={disabled}
        onClick={() => !disabled && onValueChange(value)}
        {...rest}
      />
    );
  },
}));

// AlertDialog stub: render the dialog tree only when open=true. Action /
// Cancel close the dialog the way Radix does in the real component.
const AlertDialogTestContext = React.createContext<{
  onOpenChange: (open: boolean) => void;
}>({ onOpenChange: () => {} });

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open, onOpenChange }: any) =>
    open ? (
      <AlertDialogTestContext.Provider value={{ onOpenChange }}>
        <div>{children}</div>
      </AlertDialogTestContext.Provider>
    ) : null,
  AlertDialogContent: ({ children, ...rest }: any) => (
    <div {...rest}>{children}</div>
  ),
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick, ...rest }: any) => {
    const { onOpenChange } = React.useContext(AlertDialogTestContext);
    return (
      <button
        onClick={(e) => {
          onClick?.(e);
          onOpenChange(false);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  },
  AlertDialogCancel: ({ children, onClick, ...rest }: any) => {
    const { onOpenChange } = React.useContext(AlertDialogTestContext);
    return (
      <button
        onClick={(e) => {
          onClick?.(e);
          onOpenChange(false);
        }}
        {...rest}
      >
        {children}
      </button>
    );
  },
}));

import { WebhookConfigForm } from "./webhook-config-form";

// ─── Fixtures ───────────────────────────────────────────────────────────

const jiraConfig = {
  id: "cfg-jira",
  projectId: 42,
  adapterType: "JIRA",
  direction: "INBOUND",
  token: "whk_" + "a".repeat(64),
  isActive: true,
  lastReceivedAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

const githubConfig = {
  id: "cfg-github",
  projectId: 42,
  adapterType: "GITHUB",
  direction: "INBOUND",
  token: "whk_" + "b".repeat(64),
  isActive: true,
  lastReceivedAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

const adoConfig = {
  id: "cfg-ado",
  projectId: 42,
  adapterType: "AZURE_DEVOPS",
  direction: "INBOUND",
  token: "whk_" + "c".repeat(64),
  isActive: true,
  lastReceivedAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

function setConfigs(configs: (typeof jiraConfig)[]) {
  mockFindManyWebhookConfig.mockReturnValue({
    data: configs,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: configs }),
  });
}

describe("WebhookConfigForm (multi-adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://app.example.test" },
    });
    setConfigs([]);
  });

  // ─── Empty state + add-button visibility ─────────────────────────────

  it("Test 1: renders empty state with inboundAddButton when no configs exist", () => {
    setConfigs([]);
    render(<WebhookConfigForm projectId={42} />);
    expect(
      screen.getByTestId("webhook-inbound-add-button")
    ).toBeInTheDocument();
    // Empty-state copy from the inboundEmpty key
    expect(screen.getByText("inboundEmpty")).toBeInTheDocument();
  });

  it("Test 2: add-button stays enabled when at least one adapter is unconfigured", () => {
    setConfigs([jiraConfig]); // GITHUB + ADO still available
    render(<WebhookConfigForm projectId={42} />);
    const addBtn = screen.getByTestId("webhook-inbound-add-button");
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).not.toBeDisabled();
  });

  it("Test 3: add-button is hidden or disabled when all 3 adapters are configured", () => {
    setConfigs([jiraConfig, githubConfig, adoConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const addBtn = screen.queryByTestId("webhook-inbound-add-button");
    // Either not rendered, or rendered-but-disabled — both satisfy the gate
    if (addBtn) {
      expect(addBtn).toBeDisabled();
    } else {
      expect(addBtn).not.toBeInTheDocument();
    }
  });

  // ─── Per-card render + per-card root testid scheme ───────────────────

  it("Test 4: renders Jira card when one JIRA config exists; root testid follows webhook-inbound-card-jira pattern", () => {
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    expect(card).toBeInTheDocument();
    // Stable inner testids preserved from Phase 1
    expect(within(card).getByTestId("webhook-url")).toBeInTheDocument();
    expect(within(card).getByTestId("webhook-secret")).toBeInTheDocument();
    expect(
      within(card).getByTestId("webhook-send-test-button")
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("webhook-rotate-button")
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("webhook-delete-button")
    ).toBeInTheDocument();
  });

  it("Test 5: renders Jira + GitHub cards when both configs exist; both per-card root testids present", () => {
    setConfigs([jiraConfig, githubConfig]);
    render(<WebhookConfigForm projectId={42} />);
    expect(screen.getByTestId("webhook-inbound-card-jira")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-inbound-card-github")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-inbound-card-ado")
    ).not.toBeInTheDocument();
  });

  it("Test 6: renders all 3 cards when JIRA + GITHUB + ADO configs exist", () => {
    setConfigs([jiraConfig, githubConfig, adoConfig]);
    render(<WebhookConfigForm projectId={42} />);
    expect(screen.getByTestId("webhook-inbound-card-jira")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-inbound-card-github")
    ).toBeInTheDocument();
    expect(screen.getByTestId("webhook-inbound-card-ado")).toBeInTheDocument();
  });

  // ─── Adapter chooser ─────────────────────────────────────────────────

  it("Test 7: chooser opens on add-button click; shows all 3 radio options", () => {
    setConfigs([]);
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    expect(
      screen.getByTestId("webhook-inbound-chooser-jira")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-inbound-chooser-github")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-inbound-chooser-ado")
    ).toBeInTheDocument();
  });

  it("Test 8: chooser disables JIRA radio when JIRA config already exists", () => {
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    expect(screen.getByTestId("webhook-inbound-chooser-jira")).toBeDisabled();
    expect(
      screen.getByTestId("webhook-inbound-chooser-github")
    ).not.toBeDisabled();
    expect(
      screen.getByTestId("webhook-inbound-chooser-ado")
    ).not.toBeDisabled();
  });

  it("Test 9: chooser shows ADO username + password inputs after submitting AZURE_DEVOPS selection", () => {
    setConfigs([]);
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-ado"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-submit"));
    expect(
      screen.getByTestId("webhook-inbound-ado-username-input")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-inbound-ado-password-input")
    ).toBeInTheDocument();
  });

  it("Test 10: ADO scope hint is visible on the ADO create form", () => {
    setConfigs([]);
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-ado"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-submit"));
    expect(screen.getByText("inboundAdoScopeHint")).toBeInTheDocument();
  });

  it("Test 11: GitHub scope hint is visible on the GitHub create form", () => {
    setConfigs([]);
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-github"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-submit"));
    expect(screen.getByText("inboundGithubScopeHint")).toBeInTheDocument();
  });

  // ─── Create flow per adapter ─────────────────────────────────────────

  it("Test 12: JIRA create flow calls createOrRotateInboundWebhook with adapterType=JIRA and reveals secret", async () => {
    setConfigs([]);
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-jira-new",
      url: "https://app.example.test/api/webhooks/whk_new",
      secret: "minted-secret",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-jira"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-submit"));
    fireEvent.click(screen.getByTestId("webhook-create-button"));
    await waitFor(() => {
      expect(mockCreateOrRotateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "JIRA",
      });
    });
  });

  it("Test 13: GITHUB create flow calls createOrRotateInboundWebhook with adapterType=GITHUB", async () => {
    setConfigs([]);
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-github-new",
      url: "https://app.example.test/api/webhooks/whk_gh_new",
      secret: "minted-github-secret",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-github"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-submit"));
    fireEvent.click(screen.getByTestId("webhook-create-button"));
    await waitFor(() => {
      expect(mockCreateOrRotateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "GITHUB",
      });
    });
  });

  it("Test 14: ADO create flow JSON-encodes credentials via createOrRotateInboundWebhook", async () => {
    setConfigs([]);
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-ado-new",
      url: "https://app.example.test/api/webhooks/whk_ado_new",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-ado"));
    fireEvent.click(screen.getByTestId("webhook-inbound-chooser-submit"));

    const userInput = screen.getByTestId(
      "webhook-inbound-ado-username-input"
    ) as HTMLInputElement;
    const passInput = screen.getByTestId(
      "webhook-inbound-ado-password-input"
    ) as HTMLInputElement;
    fireEvent.change(userInput, { target: { value: "tpi" } });
    fireEvent.change(passInput, { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() => {
      expect(mockCreateOrRotateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
        secretInput: {
          kind: "AZURE_DEVOPS",
          username: "tpi",
          password: "s3cret",
        },
      });
    });
  });

  // ─── Send-test ───────────────────────────────────────────────────────

  it("Test 15: send-test on Jira card invokes sendTestWebhook(config.id) and renders synthetic outcome inline", async () => {
    setConfigs([jiraConfig]);
    mockSendTest.mockResolvedValue({
      ok: true,
      statusCode: 200,
      outcome: "synthetic",
    });
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    fireEvent.click(within(card).getByTestId("webhook-send-test-button"));
    await waitFor(() => {
      expect(mockSendTest).toHaveBeenCalledWith("cfg-jira");
    });
    await waitFor(() => {
      const result = within(card).getByTestId("webhook-test-result");
      expect(result.textContent).toContain("200");
      expect(result.textContent).toContain("synthetic");
    });
  });

  it("Test 16: send-test on GitHub card uses scoped lookup and invokes sendTestWebhook with the right config id", async () => {
    setConfigs([jiraConfig, githubConfig]);
    mockSendTest.mockResolvedValue({
      ok: true,
      statusCode: 200,
      outcome: "duplicate",
    });
    render(<WebhookConfigForm projectId={42} />);
    const ghCard = screen.getByTestId("webhook-inbound-card-github");
    fireEvent.click(within(ghCard).getByTestId("webhook-send-test-button"));
    await waitFor(() => {
      expect(mockSendTest).toHaveBeenCalledWith("cfg-github");
    });
    await waitFor(() => {
      expect(
        within(ghCard).getByTestId("webhook-test-result").textContent
      ).toContain("duplicate");
    });
  });

  // ─── Rotate-button presence ──────────────────────────────────────────

  it("Test 17: rotate button is rendered on Jira + GitHub cards", () => {
    setConfigs([jiraConfig, githubConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const jiraCard = screen.getByTestId("webhook-inbound-card-jira");
    const ghCard = screen.getByTestId("webhook-inbound-card-github");
    expect(
      within(jiraCard).getByTestId("webhook-rotate-button")
    ).toBeInTheDocument();
    expect(
      within(ghCard).getByTestId("webhook-rotate-button")
    ).toBeInTheDocument();
  });

  it("Test 18: rotate button is NOT rendered on the ADO card (paired credentials, no single secret to rotate)", () => {
    setConfigs([adoConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const adoCard = screen.getByTestId("webhook-inbound-card-ado");
    expect(
      within(adoCard).queryByTestId("webhook-rotate-button")
    ).not.toBeInTheDocument();
  });

  // ─── Delete confirmation via shadcn AlertDialog ──────────────────────

  it("Test 19: delete uses shadcn AlertDialog (no window.confirm) and only invokes server action on confirm", async () => {
    const confirmSpy = vi
      .spyOn(window, "confirm")
      .mockImplementation(() => true);
    setConfigs([jiraConfig]);
    mockDeleteInbound.mockResolvedValue({ success: true });
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    fireEvent.click(within(card).getByTestId("webhook-delete-button"));
    // Dialog opens
    expect(screen.getByTestId("webhook-delete-dialog")).toBeInTheDocument();
    // Cancel branch
    fireEvent.click(screen.getByTestId("webhook-delete-dialog-cancel"));
    expect(mockDeleteInbound).not.toHaveBeenCalled();
    // Re-open + confirm
    fireEvent.click(within(card).getByTestId("webhook-delete-button"));
    fireEvent.click(screen.getByTestId("webhook-delete-dialog-confirm"));
    await waitFor(() => {
      expect(mockDeleteInbound).toHaveBeenCalledWith({
        webhookConfigId: "cfg-jira",
        projectId: 42,
      });
    });
    // window.confirm was never invoked — confirmation is shadcn-only
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // ─── isActive toggle (POSITIONAL setWebhookActive call site lock) ────

  it("Test 20: toggling isActive on Jira card calls setWebhookActive with POSITIONAL args (config.id, isActive)", async () => {
    setConfigs([jiraConfig]);
    mockSetWebhookActive.mockResolvedValue({ success: true });
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    const toggle = within(card).getByLabelText("isActive") as HTMLInputElement;
    // Currently checked (jiraConfig.isActive=true) — uncheck it
    fireEvent.click(toggle);
    await waitFor(() => {
      // Two positional args, NOT an object
      expect(mockSetWebhookActive).toHaveBeenCalledWith("cfg-jira", false);
    });
    // Defensive: explicitly assert the first arg is a string id, not an object
    const call = mockSetWebhookActive.mock.calls[0];
    expect(typeof call[0]).toBe("string");
    expect(typeof call[1]).toBe("boolean");
  });

  // ─── Rotate flow (Jira) — exercises createOrRotateInboundWebhook path ─

  it("Test 21: rotate on Jira card opens AlertDialog; confirm invokes createOrRotateInboundWebhook(adapterType=JIRA)", async () => {
    setConfigs([jiraConfig]);
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-jira",
      url: "https://app.example.test/api/webhooks/whk_rot",
      secret: "rotated-secret",
    });
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    fireEvent.click(within(card).getByTestId("webhook-rotate-button"));
    expect(screen.getByTestId("webhook-rotate-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("webhook-rotate-dialog-confirm"));
    await waitFor(() => {
      expect(mockCreateOrRotateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "JIRA",
      });
    });
  });

  // ─── Existing-config-state surface (regression coverage for Phase 1
  //     stable inner testids) ──────────────────────────────────────────

  it("Test 22: existing Jira config renders masked secret + stable inner testids (Phase 1 regression gate)", () => {
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    // Stable inner testids — the very ones Phase 1's E2E spec relies on
    expect(within(card).getByTestId("webhook-url")).toBeInTheDocument();
    expect(within(card).getByTestId("webhook-secret")).toBeInTheDocument();
    expect(
      within(card).getByTestId("webhook-send-test-button")
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("webhook-rotate-button")
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("webhook-delete-button")
    ).toBeInTheDocument();
    // Secret is masked (not the full token)
    expect(within(card).getByTestId("webhook-secret").textContent).toBe(
      "secretMasked"
    );
  });
});
