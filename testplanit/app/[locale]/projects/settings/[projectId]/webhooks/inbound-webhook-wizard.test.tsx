import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateInbound,
  mockCreateRepository,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockCreateInbound: vi.fn(),
  mockCreateRepository: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key;
    (t as any).rich = (
      key: string,
      tags?: Record<string, (chunks: React.ReactNode) => React.ReactNode>
    ) => (
      <>
        {key}
        {tags &&
          Object.entries(tags).map(([name, render]) => (
            <React.Fragment key={name}>{render(name)}</React.Fragment>
          ))}
      </>
    );
    return t;
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock("~/app/actions/webhook-config", () => ({
  createOrRotateInboundWebhook: (...args: unknown[]) =>
    mockCreateInbound(...args),
  createOrRotateCodeRepositoryWebhook: (...args: unknown[]) =>
    mockCreateRepository(...args),
}));
vi.mock("@/components/webhooks/webhook-adapter-icon", () => ({
  WebhookAdapterIcon: ({ adapterType }: any) => (
    <span data-testid={`adapter-icon-${adapterType}`} />
  ),
}));
vi.mock("@/components/CodeRepositoryName", () => ({
  CodeRepositoryName: ({ name }: any) => <span>{name}</span>,
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
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
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
const RadioContext = React.createContext<{
  value?: string;
  onValueChange: (v: string) => void;
}>({ onValueChange: () => {} });
vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, value, onValueChange, ...rest }: any) => (
    <RadioContext.Provider value={{ value, onValueChange }}>
      <div data-testid={rest["data-testid"]}>{children}</div>
    </RadioContext.Provider>
  ),
  RadioGroupItem: ({ value, disabled, ...rest }: any) => {
    const ctx = React.useContext(RadioContext);
    return (
      <button
        type="button"
        role="radio"
        aria-checked={ctx.value === value}
        disabled={disabled}
        onClick={() => !disabled && ctx.onValueChange(value)}
        data-testid={rest["data-testid"]}
      />
    );
  },
}));
const SelectContext = React.createContext<{
  value?: string;
  onValueChange: (v: string) => void;
}>({ onValueChange: () => {} });
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({ children, ...rest }: any) => {
    const ctx = React.useContext(SelectContext);
    return (
      <div data-testid={rest["data-testid"]} data-value={ctx.value}>
        {children}
      </div>
    );
  },
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => {
    const ctx = React.useContext(SelectContext);
    return (
      <button
        type="button"
        data-testid={`select-item-${value}`}
        onClick={() => ctx.onValueChange(value)}
      >
        {children}
      </button>
    );
  },
}));

import { InboundWebhookWizard } from "./inbound-webhook-wizard";

const github = {
  id: 9,
  name: "acme/app",
  provider: "GITHUB",
  branch: "main",
  adapterType: "GITHUB" as const,
  configured: false,
};
const ado = {
  id: 10,
  name: "org/app",
  provider: "AZURE_DEVOPS",
  branch: null,
  adapterType: "AZURE_DEVOPS" as const,
  configured: false,
};

function renderWizard(
  overrides: Partial<React.ComponentProps<typeof InboundWebhookWizard>> = {}
) {
  const props = {
    projectId: 42,
    open: true,
    onOpenChange: vi.fn(),
    issueAdapter: "JIRA" as const,
    issueConfigured: false,
    repositories: [github],
    onCreated: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<InboundWebhookWizard {...props} />);
  return props;
}

describe("InboundWebhookWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while closed", () => {
    renderWizard({ open: false });
    expect(
      screen.queryByTestId("webhook-inbound-wizard")
    ).not.toBeInTheDocument();
  });

  it("explains why a source cannot be chosen and keeps Next disabled", () => {
    renderWizard({ issueAdapter: null, repositories: [] });
    expect(
      screen.getByTestId("webhook-wizard-source-issues-reason")
    ).toHaveTextContent("inboundEmptyNoIntegration");
    expect(
      screen.getByTestId("webhook-wizard-source-repository-reason")
    ).toHaveTextContent("codeRepos.empty");
    expect(screen.getByTestId("webhook-wizard-source-issues")).toBeDisabled();
    expect(screen.getByTestId("webhook-wizard-next")).toBeDisabled();
  });

  it("names an already configured issue webhook and a repository list with nothing left", () => {
    renderWizard({
      issueConfigured: true,
      repositories: [{ ...github, configured: true }],
    });
    expect(
      screen.getByTestId("webhook-wizard-source-issues-reason")
    ).toHaveTextContent("inboundAddButtonAllConfigured");
    expect(
      screen.getByTestId("webhook-wizard-source-repository-reason")
    ).toHaveTextContent("wizard.noRepositoryAvailable");
  });

  it("preselects the only available source", () => {
    renderWizard({ issueConfigured: true });
    expect(
      screen.getByTestId("webhook-wizard-source-repository")
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("webhook-wizard-next")).not.toBeDisabled();
  });

  it("creates the issue-tracker webhook and shows the URL, secret and setup steps once", async () => {
    mockCreateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-jira",
      url: "https://tpi.example/api/webhooks/whk_full",
      secret: "plain-secret",
    });
    const props = renderWizard();

    fireEvent.click(screen.getByTestId("webhook-wizard-source-issues"));
    fireEvent.click(screen.getByTestId("webhook-wizard-next"));
    expect(
      screen.getByTestId("webhook-wizard-issue-details")
    ).toHaveTextContent("inboundJiraTitle");
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() =>
      expect(
        screen.getByTestId("webhook-inbound-revealed-box")
      ).toBeInTheDocument()
    );
    expect(mockCreateInbound).toHaveBeenCalledWith({
      projectId: 42,
      adapterType: "JIRA",
    });
    expect(screen.getByTestId("webhook-url")).toHaveTextContent("whk_full");
    expect(screen.getByTestId("webhook-secret")).toHaveTextContent(
      "plain-secret"
    );
    expect(screen.getByText("setupStepsJiraStep1")).toBeInTheDocument();
    expect(props.onCreated).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("webhook-reveal-done-button"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("creates a repository webhook with only the events left switched on", async () => {
    mockCreateRepository.mockResolvedValue({
      success: true,
      configId: "cfg-repo",
      url: "https://tpi.example/api/webhooks/whk_repo",
      secret: "repo-secret",
    });
    renderWizard({ issueConfigured: true });

    fireEvent.click(screen.getByTestId("webhook-wizard-next"));
    // The only available repository is preselected.
    expect(screen.getByTestId("webhook-wizard-repository")).toHaveAttribute(
      "data-value",
      "9"
    );
    expect(
      screen.getByText('codeRepos.eventPush:{"branch":"main"}')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-wizard-event-branch-push")
    ).not.toBeChecked();
    fireEvent.change(screen.getByTestId("webhook-wizard-base-branch"), {
      target: { value: "develop" },
    });
    expect(
      screen.getByText('codeRepos.eventPush:{"branch":"develop"}')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("webhook-wizard-event-push"));
    fireEvent.click(screen.getByTestId("webhook-wizard-event-branch-push"));
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() =>
      expect(mockCreateRepository).toHaveBeenCalledWith({
        projectId: 42,
        codeRepositoryConfigId: 9,
        secretInput: undefined,
        subscribedEvents: ["code:pull_request", "code:branch_push"],
        baseBranch: "develop",
      })
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("webhook-inbound-revealed-box")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("codeRepos.setupGithub")).toBeInTheDocument();
  });

  it("asks for a repository when several are available and for credentials on Azure DevOps", async () => {
    mockCreateRepository.mockResolvedValue({
      success: true,
      configId: "cfg-ado",
      url: "https://tpi.example/api/webhooks/whk_ado",
    });
    renderWizard({ issueConfigured: true, repositories: [github, ado] });

    fireEvent.click(screen.getByTestId("webhook-wizard-next"));
    expect(screen.getByTestId("webhook-create-button")).toBeDisabled();
    expect(
      screen.queryByTestId("webhook-wizard-credentials")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("select-item-10"));
    expect(
      screen.getByTestId("webhook-wizard-credentials")
    ).toBeInTheDocument();
    expect(screen.getByTestId("webhook-create-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("webhook-inbound-ado-username-input"), {
      target: { value: "svc" },
    });
    fireEvent.change(screen.getByTestId("webhook-inbound-ado-password-input"), {
      target: { value: "pat" },
    });
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() =>
      expect(mockCreateRepository).toHaveBeenCalledWith(
        expect.objectContaining({
          codeRepositoryConfigId: 10,
          secretInput: {
            kind: "AZURE_DEVOPS",
            username: "svc",
            password: "pat",
          },
        })
      )
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("webhook-inbound-revealed-box")
      ).toBeInTheDocument()
    );
    expect(screen.queryByTestId("webhook-secret")).not.toBeInTheDocument();
  });

  it("sends Azure DevOps issue credentials as the secret input", async () => {
    mockCreateInbound.mockResolvedValue({
      success: true,
      configId: "cfg-ado",
      url: "https://tpi.example/api/webhooks/whk_ado",
    });
    renderWizard({ issueAdapter: "AZURE_DEVOPS", repositories: [] });

    fireEvent.click(screen.getByTestId("webhook-wizard-next"));
    fireEvent.change(screen.getByTestId("webhook-inbound-ado-username-input"), {
      target: { value: "tpi" },
    });
    fireEvent.change(screen.getByTestId("webhook-inbound-ado-password-input"), {
      target: { value: "s3cret" },
    });
    fireEvent.click(screen.getByTestId("webhook-create-button"));

    await waitFor(() =>
      expect(mockCreateInbound).toHaveBeenCalledWith({
        projectId: 42,
        adapterType: "AZURE_DEVOPS",
        secretInput: {
          kind: "AZURE_DEVOPS",
          username: "tpi",
          password: "s3cret",
        },
      })
    );
  });

  it("stays on the Configure step and reports a failed create", async () => {
    mockCreateInbound.mockResolvedValue({ success: false, error: "Forbidden" });
    renderWizard();
    fireEvent.click(screen.getByTestId("webhook-wizard-source-issues"));
    fireEvent.click(screen.getByTestId("webhook-wizard-next"));
    fireEvent.click(screen.getByTestId("webhook-create-button"));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Forbidden")
    );
    expect(
      screen.queryByTestId("webhook-inbound-revealed-box")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("webhook-wizard-back"));
    expect(screen.getByTestId("webhook-wizard-source")).toBeInTheDocument();
  });
});
