import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock refs ───────────────────────────────────────────────────
const {
  mockFindManyWebhookConfig,
  mockCreate,
  mockDelete,
  mockRotate,
  mockRetireNow,
  mockExtend,
  mockSendTest,
  mockSetActive,
  mockUpdateSubs,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockFindManyWebhookConfig: vi.fn(),
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
  mockRotate: vi.fn(),
  mockRetireNow: vi.fn(),
  mockExtend: vi.fn(),
  mockSendTest: vi.fn(),
  mockSetActive: vi.fn(),
  mockUpdateSubs: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindManyWebhookConfig: (...args: any[]) =>
    mockFindManyWebhookConfig(...args),
}));

vi.mock("~/app/actions/webhook-config", () => ({
  createOutboundWebhook: (...args: any[]) => mockCreate(...args),
  deleteOutboundWebhook: (...args: any[]) => mockDelete(...args),
  rotateOutboundSecret: (...args: any[]) => mockRotate(...args),
  retireOutboundSecretNow: (...args: any[]) => mockRetireNow(...args),
  extendRetiringSecret: (...args: any[]) => mockExtend(...args),
  sendTestOutboundWebhook: (...args: any[]) => mockSendTest(...args),
  setWebhookActive: (...args: any[]) => mockSetActive(...args),
  updateOutboundSubscriptions: (...args: any[]) => mockUpdateSubs(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

// Translation mock — returns the key by default; we use the keys themselves
// as visible UI text so assertions can target stable identifiers.
vi.mock("next-intl", () => ({
  useTranslations:
    (_namespace?: string) =>
    (key: string, params?: Record<string, unknown>) => {
      if (params) {
        let result = key;
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
        return result;
      }
      return key;
    },
}));

// Stub shadcn primitives so JSDOM renders cleanly without portal / Radix.
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

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...rest }: any) => (
    <input value={value} onChange={onChange} {...rest} />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor, ...rest }: any) => (
    <label htmlFor={htmlFor} {...rest}>
      {children}
    </label>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}));

// AlertDialog stub: render the dialog tree only when open=true so JSDOM
// doesn't have to handle Radix portals. Cancel/Action click closes via context.
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

import { WebhookOutboundForm } from "./webhook-outbound-form";

const baseSlackConfig = {
  id: "cfg-slack-1",
  projectId: 42,
  adapterType: "SLACK",
  direction: "OUTBOUND",
  name: "Engineering Slack",
  url: "https://hooks.slack.com/services/T00/B00/secret",
  isActive: true,
  subscribedEvents: ["test_run.completed", "issue.created"],
  endpointHealth: "HEALTHY",
  createdAt: new Date("2026-04-27T00:00:00Z"),
  updatedAt: new Date("2026-04-27T00:00:00Z"),
  secrets: [],
};

const baseHmacConfig = {
  id: "cfg-hmac-1",
  projectId: 42,
  adapterType: "GENERIC_HMAC",
  direction: "OUTBOUND",
  name: "QA Audit Sink",
  url: "https://example.com/audit-sink",
  isActive: true,
  subscribedEvents: ["test_run.completed"],
  endpointHealth: "HEALTHY",
  createdAt: new Date("2026-04-27T00:00:00Z"),
  updatedAt: new Date("2026-04-27T00:00:00Z"),
  secrets: [
    {
      id: "sec-1",
      activatedAt: new Date("2026-04-20T00:00:00Z"),
      retiredAt: null,
      autoRetireAt: null,
    },
  ],
};

describe("WebhookOutboundForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: zero configs, not loading.
    mockFindManyWebhookConfig.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [] }),
    });
  });

  // Test 1: empty state
  it("Test 1: renders empty state when zero configs", () => {
    render(<WebhookOutboundForm projectId={42} />);
    expect(screen.getByTestId("webhook-outbound-empty")).toBeInTheDocument();
  });

  // Test 2: clicking 'Add outbound webhook' opens the create form
  it("Test 2: 'Add outbound webhook' button opens the create form", () => {
    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));
    expect(
      screen.getByTestId("webhook-outbound-create-form")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-outbound-name-input")
    ).toBeInTheDocument();
    expect(screen.getByTestId("webhook-outbound-url-input")).toBeInTheDocument();
  });

  // Test 3: auto-detect badge updates as user types
  it("Test 3: auto-detect badge shows Slack vs Generic HMAC based on URL", () => {
    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));

    const urlInput = screen.getByTestId("webhook-outbound-url-input");

    fireEvent.change(urlInput, {
      target: { value: "https://hooks.slack.com/services/T/B/C" },
    });
    expect(
      screen.getByTestId("webhook-outbound-detected-badge").textContent
    ).toContain("outboundDetectedSlack");

    fireEvent.change(urlInput, {
      target: { value: "https://example.com/audit" },
    });
    expect(
      screen.getByTestId("webhook-outbound-detected-badge").textContent
    ).toContain("outboundDetectedHmac");
  });

  // Test 4 (Blocker 4): createOutboundWebhook called with name/url/subscriptions on submit
  it("Test 4 (Blocker 4): createOutboundWebhook called with entered name/url/subscriptions", async () => {
    mockCreate.mockResolvedValue({
      success: true,
      configId: "cfg-new",
    });

    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));

    fireEvent.change(screen.getByTestId("webhook-outbound-name-input"), {
      target: { value: "Engineering Slack" },
    });
    fireEvent.change(screen.getByTestId("webhook-outbound-url-input"), {
      target: { value: "https://hooks.slack.com/services/T/B/C" },
    });

    fireEvent.click(screen.getByTestId("webhook-outbound-create-submit"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.projectId).toBe(42);
    expect(callArg.name).toBe("Engineering Slack");
    expect(callArg.url).toBe("https://hooks.slack.com/services/T/B/C");
    expect(Array.isArray(callArg.subscribedEvents)).toBe(true);
  });

  // Test 5 (Blocker 4): empty-name client-side validation
  it("Test 5 (Blocker 4): empty name does NOT call createOutboundWebhook; toast error shown", async () => {
    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));

    // Leave name empty, fill URL.
    fireEvent.change(screen.getByTestId("webhook-outbound-url-input"), {
      target: { value: "https://hooks.slack.com/services/T/B/C" },
    });

    fireEvent.click(screen.getByTestId("webhook-outbound-create-submit"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("outboundCreateNameRequired");
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // Test 6: post-create plaintext secret displayed
  it("Test 6: post-create plaintext secret displayed once when server returns secret", async () => {
    mockCreate.mockResolvedValue({
      success: true,
      configId: "cfg-new",
      secret: "abc123-plaintext-secret",
    });

    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));
    fireEvent.change(screen.getByTestId("webhook-outbound-name-input"), {
      target: { value: "QA HMAC" },
    });
    fireEvent.change(screen.getByTestId("webhook-outbound-url-input"), {
      target: { value: "https://example.com/audit" },
    });
    fireEvent.click(screen.getByTestId("webhook-outbound-create-submit"));

    await waitFor(() => {
      expect(
        screen.getByTestId("webhook-outbound-revealed-secret")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("webhook-outbound-revealed-secret").textContent
    ).toContain("abc123-plaintext-secret");
  });

  // Test 7: rotate opens AlertDialog (NOT window.confirm); confirming calls server action
  it("Test 7: rotate opens AlertDialog; confirm calls rotateOutboundSecret", async () => {
    mockFindManyWebhookConfig.mockReturnValue({
      data: [baseHmacConfig],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [baseHmacConfig] }),
    });
    mockRotate.mockResolvedValue({ success: true, secret: "rotated-secret" });

    render(<WebhookOutboundForm projectId={42} />);

    // Dialog hidden until rotate button clicked.
    expect(
      screen.queryByTestId("webhook-outbound-rotate-dialog")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(`webhook-outbound-rotate-button-${baseHmacConfig.id}`)
    );
    expect(
      screen.getByTestId("webhook-outbound-rotate-dialog")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("webhook-outbound-rotate-dialog-confirm"));

    await waitFor(() => {
      expect(mockRotate).toHaveBeenCalledWith(baseHmacConfig.id);
    });
  });

  // Test 8: delete opens AlertDialog; confirm calls deleteOutboundWebhook
  it("Test 8: delete opens AlertDialog; confirm calls deleteOutboundWebhook", async () => {
    mockFindManyWebhookConfig.mockReturnValue({
      data: [baseSlackConfig],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [baseSlackConfig] }),
    });
    mockDelete.mockResolvedValue({ success: true });

    render(<WebhookOutboundForm projectId={42} />);

    fireEvent.click(
      screen.getByTestId(`webhook-outbound-delete-button-${baseSlackConfig.id}`)
    );
    expect(
      screen.getByTestId("webhook-outbound-delete-dialog")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("webhook-outbound-delete-dialog-confirm"));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(baseSlackConfig.id);
    });
  });

  // Test 9: send-test calls server action; success state shown
  it("Test 9: send-test button calls sendTestOutboundWebhook and shows success", async () => {
    mockFindManyWebhookConfig.mockReturnValue({
      data: [baseSlackConfig],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [baseSlackConfig] }),
    });
    mockSendTest.mockResolvedValue({ success: true, eventId: "evt_1" });

    render(<WebhookOutboundForm projectId={42} />);

    fireEvent.click(
      screen.getByTestId(
        `webhook-outbound-send-test-button-${baseSlackConfig.id}`
      )
    );

    await waitFor(() => {
      expect(mockSendTest).toHaveBeenCalledWith(baseSlackConfig.id);
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("outboundSendTestQueued");
    });
  });

  // Test 10: subscription checkbox group has three sections
  it("Test 10: subscription checkbox group has three sections (TR/Sessions, Issues, Cases)", () => {
    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));

    expect(
      screen.getByTestId("webhook-outbound-subs-section-testRunsAndSessions")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-outbound-subs-section-issues")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-outbound-subs-section-cases")
    ).toBeInTheDocument();
  });

  // Test 11: per-section 'Select all' toggles all events in section
  it("Test 11: per-section 'Select all' selects every event in that section", () => {
    render(<WebhookOutboundForm projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-outbound-add-button"));

    // Cases section has 3 events (case.created, case.updated, case.deleted).
    const selectAllCases = screen.getByTestId(
      "webhook-outbound-subs-select-all-cases"
    );
    fireEvent.click(selectAllCases);

    // After clicking, all three cases.* checkboxes should be checked.
    expect(
      (
        screen.getByTestId(
          "webhook-outbound-subs-event-case.created"
        ) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (
        screen.getByTestId(
          "webhook-outbound-subs-event-case.updated"
        ) as HTMLInputElement
      ).checked
    ).toBe(true);
    expect(
      (
        screen.getByTestId(
          "webhook-outbound-subs-event-case.deleted"
        ) as HTMLInputElement
      ).checked
    ).toBe(true);
  });

  // Test 12: Slack config does NOT show rotate/secrets section
  it("Test 12: Slack-typed config does NOT render rotate/secrets section", () => {
    mockFindManyWebhookConfig.mockReturnValue({
      data: [baseSlackConfig],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [baseSlackConfig] }),
    });

    render(<WebhookOutboundForm projectId={42} />);

    // No rotate button for SLACK configs (URL is the credential).
    expect(
      screen.queryByTestId(
        `webhook-outbound-rotate-button-${baseSlackConfig.id}`
      )
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        `webhook-outbound-secrets-section-${baseSlackConfig.id}`
      )
    ).not.toBeInTheDocument();
  });

  // Test 13 (Blocker 4): Card title binds config.name
  it("Test 13 (Blocker 4): Card title renders config.name 'Engineering Slack'", () => {
    mockFindManyWebhookConfig.mockReturnValue({
      data: [baseSlackConfig],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [baseSlackConfig] }),
    });

    render(<WebhookOutboundForm projectId={42} />);

    const cardTitle = screen.getByTestId(
      `webhook-outbound-card-title-${baseSlackConfig.id}`
    );
    expect(cardTitle.textContent).toBe("Engineering Slack");
    // Also visible via getByText for redundancy.
    expect(screen.getByText("Engineering Slack")).toBeInTheDocument();
  });

  // Test 14: HMAC config shows the rotate/secrets section
  it("Test 14: HMAC config DOES render rotate/secrets section", () => {
    mockFindManyWebhookConfig.mockReturnValue({
      data: [baseHmacConfig],
      isLoading: false,
      refetch: vi.fn().mockResolvedValue({ data: [baseHmacConfig] }),
    });

    render(<WebhookOutboundForm projectId={42} />);

    expect(
      screen.getByTestId(`webhook-outbound-rotate-button-${baseHmacConfig.id}`)
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`webhook-outbound-secrets-section-${baseHmacConfig.id}`)
    ).toBeInTheDocument();
  });
});
