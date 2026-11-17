import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRotate,
  mockUpdateBaseBranch,
  mockDelete,
  mockSetActive,
  mockSendTest,
  mockToastError,
} = vi.hoisted(() => ({
  mockRotate: vi.fn(),
  mockUpdateBaseBranch: vi.fn(),
  mockDelete: vi.fn(),
  mockSetActive: vi.fn(),
  mockSendTest: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a) },
}));
vi.mock("~/app/actions/webhook-config", () => ({
  createOrRotateCodeRepositoryWebhook: (...a: unknown[]) => mockRotate(...a),
  updateCodeRepositoryWebhookBaseBranch: (...a: unknown[]) =>
    mockUpdateBaseBranch(...a),
  deleteInboundWebhook: (...a: unknown[]) => mockDelete(...a),
  setWebhookActive: (...a: unknown[]) => mockSetActive(...a),
  sendTestWebhook: (...a: unknown[]) => mockSendTest(...a),
}));
vi.mock("./webhook-actions-section", () => ({
  WebhookActionsSection: (props: any) => (
    <div
      data-testid="webhook-actions-section"
      data-props={JSON.stringify(props)}
    />
  ),
}));
vi.mock("@/components/webhooks/webhook-adapter-icon", () => ({
  WebhookAdapterIcon: () => null,
}));
vi.mock("@/components/CodeRepositoryName", () => ({
  CodeRepositoryName: ({ name }: any) => <span>{name}</span>,
}));
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => <span>{String(date)}</span>,
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      data-testid={rest["data-testid"]}
      aria-label={rest["aria-label"]}
    />
  ),
}));
const AlertCtx = React.createContext<(open: boolean) => void>(() => {});
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open, onOpenChange }: any) =>
    open ? (
      <AlertCtx.Provider value={onOpenChange}>{children}</AlertCtx.Provider>
    ) : null,
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
  AlertDialogCancel: ({ children, ...rest }: any) => (
    <button data-testid={rest["data-testid"]}>{children}</button>
  ),
}));

import { RepositoryWebhookCard } from "./repository-webhook-card";

// The rules section has its own tests
// (webhook-actions-section.render.test.tsx); here it is a placeholder.

function sectionProps() {
  return JSON.parse(
    screen.getByTestId("webhook-actions-section").getAttribute("data-props")!
  );
}

const hook = {
  id: "whc-1",
  token: "whk_" + "a".repeat(64),
  adapterType: "GITHUB" as const,
  isActive: true,
  baseBranch: null,
  endpointHealth: "HEALTHY" as const,
  lastReceivedAt: null,
  codeRepositoryConfig: {
    id: 9,
    branch: "main",
    repository: { id: 3, name: "acme/app", provider: "GITHUB" },
  },
};

describe("RepositoryWebhookCard", () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://app.example.test" },
    });
  });

  it("shows the redacted URL, the health badge and the webhook's rules", () => {
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    expect(screen.getByTestId("webhook-url")).not.toHaveTextContent(
      "a".repeat(64)
    );
    expect(sectionProps()).toEqual({
      projectId: 42,
      webhookConfigId: "whc-1",
      source: "repository",
      baseBranch: "main",
    });
    expect(
      screen.queryByTestId("webhook-repository-min-score")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-repository-event-push")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-health-badge-repository-9")
    ).toHaveTextContent("healthBadge.HEALTHY");
    expect(screen.getByTestId("webhook-rotate-button")).toBeInTheDocument();
  });

  it("saves an edited base branch through the base branch action", async () => {
    mockUpdateBaseBranch.mockResolvedValue({ success: true });
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    expect(
      screen.queryByTestId("webhook-repository-base-branch-save")
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("webhook-repository-base-branch"), {
      target: { value: " develop " },
    });
    fireEvent.click(screen.getByTestId("webhook-repository-base-branch-save"));
    await waitFor(() =>
      expect(mockUpdateBaseBranch).toHaveBeenCalledWith({
        projectId: 42,
        webhookConfigId: "whc-1",
        baseBranch: "develop",
      })
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("clears a saved base branch with null and hands it to the rules", async () => {
    mockUpdateBaseBranch.mockResolvedValue({ success: true });
    render(
      <RepositoryWebhookCard
        projectId={42}
        hook={{ ...hook, baseBranch: "develop" }}
        onChanged={onChanged}
      />
    );
    expect(sectionProps().baseBranch).toBe("develop");
    fireEvent.change(screen.getByTestId("webhook-repository-base-branch"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("webhook-repository-base-branch-save"));
    await waitFor(() =>
      expect(mockUpdateBaseBranch).toHaveBeenCalledWith({
        projectId: 42,
        webhookConfigId: "whc-1",
        baseBranch: null,
      })
    );
  });

  it("sends a test pull request and shows the outcome", async () => {
    mockSendTest.mockResolvedValue({
      ok: true,
      statusCode: 200,
      outcome: "synthetic",
    });
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    fireEvent.click(screen.getByTestId("webhook-send-test-button"));
    await waitFor(() => expect(mockSendTest).toHaveBeenCalledWith("whc-1"));
    await waitFor(() =>
      expect(screen.getByTestId("webhook-test-result")).toHaveTextContent(
        'testSuccess:{"statusCode":200,"outcome":"synthetic"}'
      )
    );
  });

  it("toggles the webhook active flag", async () => {
    mockSetActive.mockResolvedValue({ success: true });
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    fireEvent.click(screen.getByLabelText("fields.enabled"));
    await waitFor(() =>
      expect(mockSetActive).toHaveBeenCalledWith("whc-1", false)
    );
  });

  it("rotates after confirmation and reveals the new URL and secret in the card", async () => {
    mockRotate.mockResolvedValue({
      success: true,
      configId: "whc-1",
      url: "https://app.example.test/api/webhooks/whk_new",
      secret: "new-secret",
    });
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    fireEvent.click(screen.getByTestId("webhook-rotate-button"));
    fireEvent.click(screen.getByTestId("webhook-rotate-dialog-confirm"));
    await waitFor(() =>
      expect(
        screen.getByTestId("webhook-inbound-revealed-box")
      ).toBeInTheDocument()
    );
    expect(mockRotate).toHaveBeenCalledWith({
      projectId: 42,
      codeRepositoryConfigId: 9,
    });
    expect(screen.getByTestId("webhook-secret")).toHaveTextContent(
      "new-secret"
    );
    fireEvent.click(screen.getByTestId("webhook-reveal-done-button"));
    expect(
      screen.queryByTestId("webhook-inbound-revealed-box")
    ).not.toBeInTheDocument();
  });

  it("hides the rotate button for Azure DevOps and deletes after confirmation", async () => {
    mockDelete.mockResolvedValue({ success: true });
    render(
      <RepositoryWebhookCard
        projectId={42}
        hook={{ ...hook, adapterType: "AZURE_DEVOPS" }}
        onChanged={onChanged}
      />
    );
    expect(
      screen.queryByTestId("webhook-rotate-button")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("webhook-delete-button"));
    fireEvent.click(screen.getByTestId("webhook-delete-dialog-confirm"));
    await waitFor(() =>
      expect(mockDelete).toHaveBeenCalledWith({
        webhookConfigId: "whc-1",
        projectId: 42,
      })
    );
  });

  it("hides the rules while a new URL is revealed", async () => {
    mockRotate.mockResolvedValue({
      success: true,
      configId: "whc-1",
      url: "https://app.example.test/api/webhooks/whk_new",
      secret: "s",
    });
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    fireEvent.click(screen.getByTestId("webhook-rotate-button"));
    fireEvent.click(screen.getByTestId("webhook-rotate-dialog-confirm"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("webhook-actions-section")
      ).not.toBeInTheDocument()
    );
  });

  it("reports a failed base branch update", async () => {
    mockUpdateBaseBranch.mockResolvedValue({
      success: false,
      error: "Webhook not found",
    });
    render(
      <RepositoryWebhookCard projectId={42} hook={hook} onChanged={onChanged} />
    );
    fireEvent.change(screen.getByTestId("webhook-repository-base-branch"), {
      target: { value: "develop" },
    });
    fireEvent.click(screen.getByTestId("webhook-repository-base-branch-save"));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith("Webhook not found")
    );
  });
});
