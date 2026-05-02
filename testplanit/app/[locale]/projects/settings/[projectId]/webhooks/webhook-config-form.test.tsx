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
  mockFindFirstProjectIntegration,
  mockSetWebhookActive,
  mockCreateOrRotateInbound,
  mockDeleteInbound,
  mockSendTest,
  mockReEnableWebhookConfig,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockFindManyWebhookConfig: vi.fn(),
  mockFindFirstProjectIntegration: vi.fn(),
  mockSetWebhookActive: vi.fn(),
  mockCreateOrRotateInbound: vi.fn(),
  mockDeleteInbound: vi.fn(),
  mockSendTest: vi.fn(),
  mockReEnableWebhookConfig: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyWebhookConfig: (...args: any[]) =>
    mockFindManyWebhookConfig(...args),
  useFindFirstProjectIntegration: (...args: any[]) =>
    mockFindFirstProjectIntegration(...args),
}));

// `~/lib/navigation` wraps `next-intl`'s `createNavigation` which probes
// `next/navigation` at module load. Stub the wrapper's `Link` directly
// so the form's empty-state link renders as a plain `<a>` for testing.
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("~/app/actions/webhook-config", () => ({
  createOrRotateInboundWebhook: (...args: any[]) =>
    mockCreateOrRotateInbound(...args),
  deleteInboundWebhook: (...args: any[]) => mockDeleteInbound(...args),
  sendTestWebhook: (...args: any[]) => mockSendTest(...args),
  setWebhookActive: (...args: any[]) => mockSetWebhookActive(...args),
  reEnableWebhookConfig: (...args: any[]) => mockReEnableWebhookConfig(...args),
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

vi.mock("next-intl", () => {
  function makeT() {
    const t = (key: string, params?: Record<string, unknown>) => {
      const template = KEY_TEMPLATES[key] ?? key;
      let result = template;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
      }
      return result;
    };
    // `t.rich(key, tags)` renders any registered tags by invoking each
    // chunk function with the tag name. Empty-state copy uses a `<link>`
    // tag whose chunk is the inline link element — tests need that
    // element rendered to assert wiring/testids.
    (t as any).rich = (
      key: string,
      tags?: Record<string, (chunks: React.ReactNode) => React.ReactNode>
    ) => {
      const text = KEY_TEMPLATES[key] ?? key;
      if (!tags) return text;
      return (
        <>
          {text}
          {Object.entries(tags).map(([tagName, render]) => (
            <React.Fragment key={tagName}>{render(tagName)}</React.Fragment>
          ))}
        </>
      );
    };
    return t;
  }
  return {
    useLocale: () => "en-US",
    useTranslations: (_namespace?: string) => makeT(),
  };
});

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

// Tooltip stub: render trigger + content as inert siblings so tests can
// assert tooltip content directly via DOM (Radix tooltips don't render
// content in JSDOM without a hover/focus event).
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children, ...rest }: any) => (
    <div data-testid="tooltip-content" {...rest}>
      {children}
    </div>
  ),
}));

import { WebhookConfigForm } from "./webhook-config-form";

// ─── Fixtures ───────────────────────────────────────────────────────────

interface ConfigFixture {
  id: string;
  projectId: number;
  adapterType: string;
  direction: string;
  token: string;
  isActive: boolean;
  lastReceivedAt: Date | null;
  endpointHealth: "HEALTHY" | "DEGRADED" | "DISABLED";
  consecutiveFailureCount: number;
  lastDispatchedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const jiraConfig: ConfigFixture = {
  id: "cfg-jira",
  projectId: 42,
  adapterType: "JIRA",
  direction: "INBOUND",
  token: "whk_" + "a".repeat(64),
  isActive: true,
  lastReceivedAt: null,
  endpointHealth: "HEALTHY",
  consecutiveFailureCount: 0,
  lastDispatchedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

const degradedJiraConfig: ConfigFixture = {
  ...jiraConfig,
  endpointHealth: "DEGRADED",
  consecutiveFailureCount: 7,
  lastDispatchedAt: new Date("2026-04-29T11:00:00Z"),
  lastSuccessAt: new Date("2026-04-28T22:00:00Z"),
  lastFailureAt: new Date("2026-04-29T12:00:00Z"),
};

const disabledJiraConfig: ConfigFixture = {
  ...jiraConfig,
  endpointHealth: "DISABLED",
  consecutiveFailureCount: 10,
  lastDispatchedAt: new Date("2026-04-29T13:00:00Z"),
  lastSuccessAt: new Date("2026-04-28T22:00:00Z"),
  lastFailureAt: new Date("2026-04-29T13:00:00Z"),
};

const richJiraConfig: ConfigFixture = {
  ...jiraConfig,
  lastDispatchedAt: new Date("2026-04-29T10:00:00Z"),
  lastSuccessAt: new Date("2026-04-29T10:00:00Z"),
  lastFailureAt: new Date("2026-04-25T08:00:00Z"),
};

const githubConfig: ConfigFixture = {
  id: "cfg-github",
  projectId: 42,
  adapterType: "GITHUB",
  direction: "INBOUND",
  token: "whk_" + "b".repeat(64),
  isActive: true,
  lastReceivedAt: null,
  endpointHealth: "HEALTHY",
  consecutiveFailureCount: 0,
  lastDispatchedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

const adoConfig: ConfigFixture = {
  id: "cfg-ado",
  projectId: 42,
  adapterType: "AZURE_DEVOPS",
  direction: "INBOUND",
  token: "whk_" + "c".repeat(64),
  isActive: true,
  lastReceivedAt: null,
  endpointHealth: "HEALTHY",
  consecutiveFailureCount: 0,
  lastDispatchedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

function setConfigs(configs: ConfigFixture[]) {
  mockFindManyWebhookConfig.mockReturnValue({
    data: configs,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: configs }),
  });
}

/**
 * Set the project's active issue integration. The Add-inbound button
 * is gated on this — passing `null` simulates a project with no
 * integration (button disabled, "no-integration" empty-state copy).
 * Default in beforeEach mirrors a Jira-integrated project so existing
 * tests keep passing without each one having to re-set it.
 */
function setActiveIntegrationProvider(
  provider: "JIRA" | "GITHUB" | "AZURE_DEVOPS" | "SIMPLE_URL" | null
) {
  mockFindFirstProjectIntegration.mockReturnValue({
    data: provider ? { integration: { id: 1, provider } } : null,
    isLoading: false,
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
    setActiveIntegrationProvider("JIRA");
  });

  // ─── Empty state + add-button visibility ─────────────────────────────

  it("Test 1: renders empty state with inboundAddButton when no configs exist", () => {
    setConfigs([]);
    render(<WebhookConfigForm projectId={42} />);
    expect(
      screen.getByTestId("webhook-inbound-add-button")
    ).toBeInTheDocument();
    // beforeEach sets the active integration to JIRA, so the
    // "with integration" empty-state variant renders.
    expect(screen.getByText("inboundEmptyWithIntegration")).toBeInTheDocument();
    // The "Add one" inline link in the empty state must be present
    // and trigger the same flow as the Add button.
    expect(
      screen.getByTestId("webhook-inbound-empty-add-link")
    ).toBeInTheDocument();
  });

  it("Test 2: add-button enabled when integration's adapter has no config", () => {
    // 1:1 gating: button is enabled iff the project's active integration
    // adapter is not yet configured. JIRA integration + zero configs =
    // enabled.
    setConfigs([]);
    setActiveIntegrationProvider("JIRA");
    render(<WebhookConfigForm projectId={42} />);
    const addBtn = screen.getByTestId("webhook-inbound-add-button");
    expect(addBtn).not.toBeDisabled();
  });

  it("Test 3: add-button is disabled when integration's adapter is already configured", () => {
    // 1:1 gating: project has JIRA integration AND a Jira inbound config —
    // there's nothing more to add.
    setConfigs([jiraConfig]);
    setActiveIntegrationProvider("JIRA");
    render(<WebhookConfigForm projectId={42} />);
    const addBtn = screen.getByTestId("webhook-inbound-add-button");
    expect(addBtn).toBeDisabled();
  });

  // ─── Per-card render + per-card root testid scheme ───────────────────

  it("Test 4: renders Jira card when one JIRA config exists; root testid follows webhook-inbound-card-jira pattern", () => {
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    expect(card).toBeInTheDocument();

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

  // ─── Adapter chooser (dormant) ───────────────────────────────────────
  // The chooser surface (`webhook-inbound-chooser-*` testids) is preserved
  // in source for future non-issue-tracker inbound adapters. Today the
  // Add button skips the chooser entirely and routes to whichever adapter
  // matches the project's active issue integration. Tests 7 and 8
  // (chooser visibility + per-adapter disable state) are retired since
  // those interactions are no longer reachable from the product UI.

  it("Test 9: ADO project lands directly on the credentials form (chooser skipped)", () => {
    setConfigs([]);
    setActiveIntegrationProvider("AZURE_DEVOPS");
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    expect(
      screen.getByTestId("webhook-inbound-ado-username-input")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-inbound-ado-password-input")
    ).toBeInTheDocument();
  });

  it("Test 10: ADO scope hint is visible on the ADO create form", () => {
    setConfigs([]);
    setActiveIntegrationProvider("AZURE_DEVOPS");
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    expect(screen.getByText("inboundAdoScopeHint")).toBeInTheDocument();
  });

  it("Test 11: GitHub scope hint is visible on the configured GitHub card", () => {
    // Scope hint moved from the (now inline) create flow to the configured
    // card so admins see the scoping rules after the webhook exists.
    setConfigs([githubConfig]);
    render(<WebhookConfigForm projectId={42} />);
    expect(screen.getByText("inboundGithubScopeHint")).toBeInTheDocument();
  });

  // ─── Create flow per adapter ─────────────────────────────────────────

  it("Test 12: Jira-integrated project — Add button creates inline (chooser skipped)", async () => {
    setConfigs([]);
    setActiveIntegrationProvider("JIRA");
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-jira-new",
      url: "https://app.example.test/api/webhooks/whk_new",
      secret: "minted-secret",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    await waitFor(() => {
      expect(mockCreateOrRotateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "JIRA",
      });
    });
  });

  it("Test 13: GitHub-integrated project — Add button creates inline (chooser skipped)", async () => {
    setConfigs([]);
    setActiveIntegrationProvider("GITHUB");
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-github-new",
      url: "https://app.example.test/api/webhooks/whk_gh_new",
      secret: "minted-github-secret",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));
    await waitFor(() => {
      expect(mockCreateOrRotateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "GITHUB",
      });
    });
  });

  it("Test 14a: ADO create flow reveals URL with no secret field when server returns {url, configId} without secret", async () => {
    setConfigs([]);
    setActiveIntegrationProvider("AZURE_DEVOPS");
    // ADO server action returns NO `secret` field — admin already typed
    // the credentials, so there's nothing to reveal. The reveal box must
    // still render so the admin can copy the FULL URL once before reload.
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      // Match adoConfig.id so the post-create refetch surfaces a card
      // whose id matches `revealed.configId` — the reveal box mounts
      // inside the matching card, not as a free-floating element.
      configId: "cfg-ado",
      url: "https://app.example.test/api/webhooks/whk_ado_full_token_123",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));

    fireEvent.change(screen.getByTestId("webhook-inbound-ado-username-input"), {
      target: { value: "tpi" },
    });
    fireEvent.change(screen.getByTestId("webhook-inbound-ado-password-input"), {
      target: { value: "s3cret" },
    });

    // Refetch the configs list AS IF the create succeeded — the UI keys
    // its revealed-box rendering off the configured card matching by
    // configId, so the card must exist post-create for the box to show.
    setConfigs([adoConfig]);
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() => {
      // Reveal box must be present
      expect(
        screen.getByTestId("webhook-inbound-revealed-box")
      ).toBeInTheDocument();
    });

    // The full URL is shown in webhook-url
    const url = screen.getByTestId("webhook-url");
    expect(url.textContent).toContain(
      "https://app.example.test/api/webhooks/whk_ado_full_token_123"
    );

    // The webhook-secret field MUST NOT render — server returned no secret.
    expect(screen.queryByTestId("webhook-secret")).not.toBeInTheDocument();

    // Done button still renders so admin can dismiss the reveal box.
    expect(
      screen.getByTestId("webhook-reveal-done-button")
    ).toBeInTheDocument();
  });

  it("Test 14: ADO create flow JSON-encodes credentials via createOrRotateInboundWebhook", async () => {
    setConfigs([]);
    setActiveIntegrationProvider("AZURE_DEVOPS");
    mockCreateOrRotateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-ado-new",
      url: "https://app.example.test/api/webhooks/whk_ado_new",
    });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-inbound-add-button"));

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

  it("Test 22: existing Jira config renders masked secret + stable inner testids", () => {
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");

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

  it("Test 23: health badge renders HEALTHY with default variant on healthy config", () => {
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    const badge = within(card).getByTestId("webhook-health-badge-jira");
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("variant")).toBe("default");
    // Translation passthrough: t("healthBadge.HEALTHY") -> the literal key
    expect(badge.textContent).toContain("healthBadge.HEALTHY");
  });

  it("Test 24: health badge renders DEGRADED with secondary variant", () => {
    setConfigs([degradedJiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    const badge = within(card).getByTestId("webhook-health-badge-jira");
    expect(badge.getAttribute("variant")).toBe("secondary");
  });

  it("Test 25: health badge renders DISABLED with destructive variant", () => {
    setConfigs([disabledJiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    const badge = within(card).getByTestId("webhook-health-badge-jira");
    expect(badge.getAttribute("variant")).toBe("destructive");
  });

  it("Test 26: health badge tooltip on DEGRADED includes consecutiveFailureCount and lastFailureAt", () => {
    setConfigs([degradedJiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    // Tooltip content renders as a sibling of the trigger (mocked above).
    // The test-mock for t() returns the key, so the rendered content is
    // the literal "healthTooltipDegraded" — sufficient to confirm the
    // component selected the right tooltip variant for DEGRADED.
    const tooltip = within(card).getByTestId("tooltip-content");
    expect(tooltip.textContent).toContain("healthTooltipDegraded");
  });

  it("Test 27: delivery activity field group renders all three timestamps when populated (DEL-08)", () => {
    setConfigs([richJiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    const group = within(card).getByTestId("webhook-delivery-activity-jira");
    expect(group).toBeInTheDocument();
    // All three labels rendered (test-mock returns keys directly)
    expect(group.textContent).toContain("activityLastDispatched");
    expect(group.textContent).toContain("activityLastSuccess");
    expect(group.textContent).toContain("activityLastFailure");
  });

  it("Test 28: delivery activity rows render activityNever when timestamp fields are null", () => {
    // jiraConfig has all three null
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    const group = within(card).getByTestId("webhook-delivery-activity-jira");
    // Three "Never" rows (one per null timestamp)
    const neverMatches = group.textContent?.match(/activityNever/g) ?? [];
    expect(neverMatches.length).toBe(3);
  });

  it("Test 29: re-enable button visible only when endpointHealth === 'DISABLED'", () => {
    setConfigs([disabledJiraConfig]);
    const { unmount } = render(<WebhookConfigForm projectId={42} />);
    const card = screen.getByTestId("webhook-inbound-card-jira");
    expect(
      within(card).getByTestId("webhook-reenable-button-jira")
    ).toBeInTheDocument();
    unmount();
    // Healthy config: button absent
    setConfigs([jiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    expect(
      screen.queryByTestId("webhook-reenable-button-jira")
    ).not.toBeInTheDocument();
  });

  it("Test 30: re-enable click opens AlertDialog", () => {
    setConfigs([disabledJiraConfig]);
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-reenable-button-jira"));
    expect(screen.getByTestId("webhook-reenable-dialog")).toBeInTheDocument();
  });

  it("Test 31: re-enable dialog confirm invokes reEnableWebhookConfig action with config id", async () => {
    setConfigs([disabledJiraConfig]);
    mockReEnableWebhookConfig.mockResolvedValue({ ok: true });
    render(<WebhookConfigForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-reenable-button-jira"));
    fireEvent.click(screen.getByTestId("webhook-reenable-dialog-confirm"));
    await waitFor(() => {
      expect(mockReEnableWebhookConfig).toHaveBeenCalledWith("cfg-jira");
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("toastReEnableSuccess");
    });
  });
});
