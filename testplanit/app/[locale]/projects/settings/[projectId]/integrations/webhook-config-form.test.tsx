import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock refs ───────────────────────────────────────────────────
const {
  mockFindFirstWebhookConfig,
  mockUpdateWebhookConfig,
  mockCreateOrRotate,
  mockDelete,
  mockSendTest,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockFindFirstWebhookConfig: vi.fn(),
  mockUpdateWebhookConfig: vi.fn(),
  mockCreateOrRotate: vi.fn(),
  mockDelete: vi.fn(),
  mockSendTest: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindFirstWebhookConfig: (...args: any[]) =>
    mockFindFirstWebhookConfig(...args),
  useUpdateWebhookConfig: () => ({ mutateAsync: mockUpdateWebhookConfig }),
}));

vi.mock("~/app/actions/webhook-config", () => ({
  createOrRotateJiraWebhook: (...args: any[]) => mockCreateOrRotate(...args),
  deleteJiraWebhook: (...args: any[]) => mockDelete(...args),
  sendTestWebhook: (...args: any[]) => mockSendTest(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

// Translation mock: mimics the actual i18n placeholder substitution. For keys
// in the webhooks namespace that contain runtime placeholders, return a
// template string so the component's interpolation (HTTP {statusCode},
// outcome: {outcome}) shows up in the rendered DOM the same way it would in
// production.
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

// Stub shadcn primitives so JSDOM renders cleanly without portal / Radix.
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
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

// AlertDialog stub: render the dialog tree only when open=true so JSDOM
// doesn't have to handle Radix portals. AlertDialogAction and AlertDialogCancel
// both close the dialog (call parent onOpenChange(false)) the way Radix does
// in the real component — wired via context so a click anywhere inside the
// stub tree resolves to the right onOpenChange.
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
  AlertDialogContent: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
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

const baseConfig = {
  id: "cfg-1",
  projectId: 42,
  adapterType: "JIRA",
  direction: "INBOUND",
  token: "whk_" + "a".repeat(64),
  secret: "enc:secret",
  isActive: true,
  lastReceivedAt: null,
  createdAt: new Date("2026-04-26T00:00:00Z"),
  updatedAt: new Date("2026-04-26T00:00:00Z"),
};

describe("WebhookConfigForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://app.example.test" },
    });
    // Default: no config + not loading. `refetch` is included because
    // handleCreate / handleRotate await it after a successful mutation
    // so the just-created webhook populates `data` and the action buttons
    // render alongside the reveal block.
    mockFindFirstWebhookConfig.mockReturnValue({
      data: null,
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: null }),
    });
  });

  // Test 1: no-config → create button
  it("Test 1 (no-config state): create button calls createOrRotateJiraWebhook and reveals URL + secret once", async () => {
    mockCreateOrRotate.mockResolvedValue({
      success: true,
      configId: "cfg-1",
      url: "https://app.example.test/api/webhooks/whk_" + "a".repeat(64),
      secret: "plaintext-secret-from-server",
    });

    render(<WebhookConfigForm projectId={42} />);

    const createBtn = screen.getByTestId("webhook-create-button");
    expect(createBtn).toBeInTheDocument();
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockCreateOrRotate).toHaveBeenCalledWith(42);
    });

    await waitFor(() => {
      const url = screen.getByTestId("webhook-url");
      expect(url.textContent).toContain(
        "https://app.example.test/api/webhooks/whk_"
      );
    });
    expect(screen.getByTestId("webhook-secret").textContent).toBe(
      "plaintext-secret-from-server"
    );
  });

  // Test 2: config-exists → renders rotate / delete / send-test, secret masked, URL redacted
  it("Test 2 (config-exists state): renders rotate/delete/send-test + masked secret + redacted URL (no full token)", () => {
    mockFindFirstWebhookConfig.mockReturnValue({
      data: { ...baseConfig },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: { ...baseConfig } }),
    });

    render(<WebhookConfigForm projectId={42} />);

    expect(screen.getByTestId("webhook-rotate-button")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-delete-button")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-send-test-button")).toBeInTheDocument();

    const url = screen.getByTestId("webhook-url");
    expect(url.textContent).toContain("[redacted]");
    // The full 64-hex token MUST NOT appear at-a-glance.
    expect(url.textContent).not.toContain("a".repeat(64));

    expect(screen.getByTestId("webhook-secret").textContent).toBe(
      "secretMasked"
    );
  });

  // Test 3: send test (success path → 'synthetic')
  it("Test 3 (sendTest synthetic): result indicator displays statusCode + outcome from server action", async () => {
    mockFindFirstWebhookConfig.mockReturnValue({
      data: { ...baseConfig },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: { ...baseConfig } }),
    });
    mockSendTest.mockResolvedValue({
      ok: true,
      statusCode: 200,
      outcome: "synthetic",
    });

    render(<WebhookConfigForm projectId={42} />);

    fireEvent.click(screen.getByTestId("webhook-send-test-button"));

    await waitFor(() => {
      const result = screen.getByTestId("webhook-test-result");
      expect(result.textContent).toContain("200");
      expect(result.textContent).toContain("synthetic");
    });
    expect(mockSendTest).toHaveBeenCalledWith("cfg-1");
  });

  // Test 4: send test (duplicate path / SC#5 demo) — form is outcome-agnostic
  it("Test 4 (SC#5 demo lock): form forwards 'duplicate' outcome verbatim from sendTestWebhook", async () => {
    mockFindFirstWebhookConfig.mockReturnValue({
      data: { ...baseConfig },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: { ...baseConfig } }),
    });
    mockSendTest.mockResolvedValue({
      ok: true,
      statusCode: 200,
      outcome: "duplicate",
    });

    render(<WebhookConfigForm projectId={42} />);

    fireEvent.click(screen.getByTestId("webhook-send-test-button"));

    await waitFor(() => {
      const result = screen.getByTestId("webhook-test-result");
      expect(result.textContent).toContain("200");
      expect(result.textContent).toContain("duplicate");
    });
  });

  // Test 5: send test (failure path)
  it("Test 5 (sendTest failure): renders testFailure message with statusCode", async () => {
    mockFindFirstWebhookConfig.mockReturnValue({
      data: { ...baseConfig },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: { ...baseConfig } }),
    });
    mockSendTest.mockResolvedValue({
      ok: false,
      statusCode: 401,
    });

    render(<WebhookConfigForm projectId={42} />);

    fireEvent.click(screen.getByTestId("webhook-send-test-button"));

    await waitFor(() => {
      const result = screen.getByTestId("webhook-test-result");
      expect(result.textContent).toContain("401");
      expect(result.textContent).toContain("testFailure");
    });
  });

  // Test 6: rotate opens AlertDialog and only invokes server action on confirm
  it("Test 6: rotate opens an AlertDialog; cancel does nothing, confirm invokes server action", async () => {
    mockFindFirstWebhookConfig.mockReturnValue({
      data: { ...baseConfig },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: { ...baseConfig } }),
    });
    mockCreateOrRotate.mockResolvedValue({
      success: true,
      configId: "cfg-1",
      url: "https://app.example.test/api/webhooks/whk_" + "b".repeat(64),
      secret: "rotated-secret",
    });

    render(<WebhookConfigForm projectId={42} />);

    // Dialog is hidden until the rotate button is clicked.
    expect(screen.queryByTestId("webhook-rotate-dialog")).not.toBeInTheDocument();

    // Open the dialog.
    fireEvent.click(screen.getByTestId("webhook-rotate-button"));
    expect(screen.getByTestId("webhook-rotate-dialog")).toBeInTheDocument();

    // Cancel branch: server action NOT called, dialog closes.
    fireEvent.click(screen.getByTestId("webhook-rotate-dialog-cancel"));
    expect(mockCreateOrRotate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("webhook-rotate-dialog")).not.toBeInTheDocument();
    });

    // Re-open and confirm branch: server action called, secret revealed.
    fireEvent.click(screen.getByTestId("webhook-rotate-button"));
    fireEvent.click(screen.getByTestId("webhook-rotate-dialog-confirm"));
    await waitFor(() => {
      expect(mockCreateOrRotate).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(screen.getByTestId("webhook-secret").textContent).toBe(
        "rotated-secret"
      );
    });
  });

  // Test 7: delete opens AlertDialog and only invokes server action on confirm
  it("Test 7: delete opens an AlertDialog; cancel does nothing, confirm invokes server action", async () => {
    mockFindFirstWebhookConfig.mockReturnValue({
      data: { ...baseConfig },
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: { ...baseConfig } }),
    });
    mockDelete.mockResolvedValue({ success: true });

    render(<WebhookConfigForm projectId={42} />);

    // Open the dialog.
    fireEvent.click(screen.getByTestId("webhook-delete-button"));
    expect(screen.getByTestId("webhook-delete-dialog")).toBeInTheDocument();

    // Cancel branch.
    fireEvent.click(screen.getByTestId("webhook-delete-dialog-cancel"));
    expect(mockDelete).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId("webhook-delete-dialog")).not.toBeInTheDocument();
    });

    // Confirm branch.
    fireEvent.click(screen.getByTestId("webhook-delete-button"));
    fireEvent.click(screen.getByTestId("webhook-delete-dialog-confirm"));
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("cfg-1");
    });
  });
});
