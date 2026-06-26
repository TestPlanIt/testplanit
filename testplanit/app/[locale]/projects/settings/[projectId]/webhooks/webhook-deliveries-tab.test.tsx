import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock refs ───────────────────────────────────────────────────
const {
  mockFindManyWebhookDelivery,
  mockFindManyWebhookConfig,
  mockCountWebhookDelivery,
  mockFindUniqueWebhookDelivery,
  mockReplayWebhookDelivery,
  mockBulkReplayFailedDeliveries,
  mockToastSuccess,
  mockToastError,
  mockSearchParams,
  mockRouterReplace,
} = vi.hoisted(() => ({
  mockFindManyWebhookDelivery: vi.fn(),
  mockFindManyWebhookConfig: vi.fn(),
  mockCountWebhookDelivery: vi.fn(),
  mockFindUniqueWebhookDelivery: vi.fn(),
  mockReplayWebhookDelivery: vi.fn(),
  mockBulkReplayFailedDeliveries: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockSearchParams: { current: "" as string },
  mockRouterReplace: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    webhookDelivery: {
      useFindMany: (...args: any[]) => mockFindManyWebhookDelivery(...args),
      useCount: (...args: any[]) => mockCountWebhookDelivery(...args),
      useFindUnique: (...args: any[]) => mockFindUniqueWebhookDelivery(...args),
    },
    webhookConfig: {
      useFindMany: (...args: any[]) => mockFindManyWebhookConfig(...args),
    },
  }),
}));

// PaginationProvider depends on next-auth/react; stub session.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { preferences: {} } } }),
}));

vi.mock("~/app/actions/webhook-config", () => ({
  replayWebhookDelivery: (...args: any[]) => mockReplayWebhookDelivery(...args),
  bulkReplayFailedDeliveries: (...args: any[]) =>
    mockBulkReplayFailedDeliveries(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

// next/navigation: searchParams + router.replace + pathname stubs. We also
// stub `redirect`/`permanentRedirect` because `~/lib/navigation` calls
// `createNavigation()` from next-intl which probes for these on import.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParams.current),
  usePathname: () => "/projects/settings/42/webhooks",
  useRouter: () => ({
    replace: (...args: any[]) => mockRouterReplace(...args),
  }),
  redirect: () => undefined,
  permanentRedirect: () => undefined,
  notFound: () => undefined,
  useParams: () => ({ projectId: "42" }),
}));

// Stub `~/lib/navigation` directly so we don't pull in next-intl's
// createNavigation factory at module-load time.
vi.mock("~/lib/navigation", () => ({
  Link: ({ children }: any) => <>{children}</>,
  redirect: () => undefined,
  usePathname: () => "/projects/settings/42/webhooks",
  useRouter: () => ({
    replace: (...args: any[]) => mockRouterReplace(...args),
    push: (...args: any[]) => mockRouterReplace(...args),
  }),
  locales: ["en-US"],
  languageNames: {},
}));

// next-intl translation passthrough with placeholder interpolation.
const KEY_TEMPLATES: Record<string, string> = {
  filterBulkReplayButton: "Bulk replay {count} outbound failures",
  bulkReplayConfirm: "Replay {count} outbound failures to {configName}",
  bulkReplayCapExceeded: "Cap exceeded: {count}",
  drawerReplayedFrom: "Replay of {id}",
  drawerLatencyValue: "{ms} ms",
  toastReplayFailed: "Replay failed: {error}",
  toastBulkReplaySuccess: "Bulk replay started · batch {batchId}",
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

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...rest }: any) => (
    <input value={value ?? ""} onChange={onChange} {...rest} />
  ),
}));

// Table primitives — render plain table tags so within(...) selectors work.
vi.mock("@/components/ui/table", () => ({
  Table: ({ children, ...rest }: any) => <table {...rest}>{children}</table>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableHead: ({ children, ...rest }: any) => <th {...rest}>{children}</th>,
  TableRow: ({ children, onClick, ...rest }: any) => (
    <tr onClick={onClick} {...rest}>
      {children}
    </tr>
  ),
  TableCell: ({ children, ...rest }: any) => <td {...rest}>{children}</td>,
}));

// Dialog stub: drawer was migrated from Sheet to Dialog with lazy-loading.
// Render content only when open=true so RTL can find it.
const DialogTestContext = React.createContext<{
  onOpenChange: (open: boolean) => void;
}>({ onOpenChange: () => {} });

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open, onOpenChange }: any) =>
    open ? (
      <DialogTestContext.Provider value={{ onOpenChange }}>
        <div>{children}</div>
      </DialogTestContext.Provider>
    ) : null,
  DialogContent: ({ children, ...rest }: any) => (
    <div {...rest}>{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

// DataTable stub: emits row testids + invokes each column's cell renderer
// so the new "actions" Eye-icon column is exercisable in tests.
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({ data, columns, onTestCaseClick }: any) => (
    <table data-testid="webhook-deliveries-datatable">
      <tbody>
        {data.map((row: any) => (
          <tr
            key={row.id}
            data-testid={`webhook-delivery-row-${row.id}`}
            onClick={
              onTestCaseClick ? () => onTestCaseClick(row.id) : undefined
            }
          >
            {columns.map((col: any, idx: number) => {
              const content = col.cell
                ? col.cell({ row: { original: row } })
                : row[col.accessorKey];
              return <td key={col.id ?? idx}>{content}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

// DateRangePicker stub: a single trigger button — none of the tests
// interact with the calendar itself.
vi.mock("@/components/forms/DateRangePicker", () => ({
  DateRangePicker: ({ buttonTestId }: any) => (
    <button type="button" data-testid={buttonTestId}>
      date-range
    </button>
  ),
}));

vi.mock("@/components/tables/ColumnSelection", () => ({
  ColumnSelection: () => <div data-testid="column-selection-stub" />,
}));

vi.mock("@/components/tables/Pagination", () => ({
  PaginationComponent: ({ currentPage, totalPages }: any) => (
    <div data-testid="webhook-deliveries-paginator">
      page {currentPage} of {totalPages}
    </div>
  ),
}));

vi.mock("@/components/tables/PaginationControls", () => ({
  PaginationInfo: () => <div data-testid="webhook-deliveries-page-info" />,
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => (
    <span>
      {date instanceof Date ? date.toISOString() : String(date ?? "")}
    </span>
  ),
}));

// Select stub: walk the JSX tree (pre-render) to extract SelectItem value
// pairs and the SelectTrigger props (data-testid, className) so the rendered
// <select> carries the testid. We can't rely on rendering SelectTrigger
// because we want a single <select> element to host the testid for RTL.
const { SelectTriggerSentinel, SelectItemSentinel } = vi.hoisted(() => ({
  SelectTriggerSentinel: Symbol("SelectTrigger"),
  SelectItemSentinel: Symbol("SelectItem"),
}));

vi.mock("@/components/ui/select", () => {
  function Select({ children, value, onValueChange }: any) {
    const items: Array<{ value: string; label: React.ReactNode }> = [];
    let triggerProps: Record<string, unknown> = {};
    const walk = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        const elementType: any = (child as any).type;
        const props: any = (child as any).props ?? {};
        if (elementType?.__sentinel === SelectTriggerSentinel) {
          const { children: _c, ...rest } = props;
          triggerProps = rest;
        } else if (elementType?.__sentinel === SelectItemSentinel) {
          items.push({ value: props.value, label: props.children });
        }
        if (props.children) walk(props.children);
      });
    };
    walk(children);
    return (
      <select
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
        {...triggerProps}
      >
        {items.map((it) => (
          <option key={it.value} value={it.value}>
            {String(it.label)}
          </option>
        ))}
      </select>
    );
  }
  function SelectTrigger({ children, ...rest }: any) {
    return (
      <span {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectTrigger as any).__sentinel = SelectTriggerSentinel;
  function SelectItem({ value, children, ...rest }: any) {
    return (
      <span value={value} {...rest} style={{ display: "none" }}>
        {children}
      </span>
    );
  }
  (SelectItem as any).__sentinel = SelectItemSentinel;
  return {
    Select,
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectGroup: ({ children }: any) => <>{children}</>,
    SelectItem,
    SelectLabel: ({ children }: any) => <span>{children}</span>,
    SelectTrigger,
    SelectValue: ({ children }: any) => <span>{children}</span>,
  };
});

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...rest }: any) => (
    <span {...rest}>{children}</span>
  ),
  PopoverContent: ({ children, ...rest }: any) => (
    <div {...rest}>{children}</div>
  ),
}));

vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ selected, onSelect }: any) => (
    <button
      type="button"
      data-testid="webhook-deliveries-calendar-stub"
      onClick={() => onSelect?.(new Date("2026-04-22T00:00:00Z"))}
    >
      cal-{selected ? new Date(selected).toISOString() : "none"}
    </button>
  ),
}));

// AlertDialog stub: render only when open=true. Action / Cancel close the
// dialog the way Radix does.
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

import { WebhookDeliveriesTab } from "./webhook-deliveries-tab";

// ─── Fixtures ───────────────────────────────────────────────────────────

const baseConfig = {
  id: "cfg_a",
  name: "Slack engineering",
  adapterType: "SLACK",
  direction: "OUTBOUND",
};

const otherConfig = {
  id: "cfg_b",
  name: "Jira inbound",
  adapterType: "JIRA",
  direction: "INBOUND",
};

const outboundFailedDelivery = {
  id: "d_outbound_1",
  webhookConfigId: "cfg_a",
  webhookConfig: { name: "Slack engineering", adapterType: "SLACK" },
  direction: "OUTBOUND",
  adapterType: "SLACK",
  eventType: "test_run.completed",
  eventId: "evt_x",
  payloadDigest: null,
  statusCode: 500,
  latencyMs: 1234,
  error: "5xx upstream",
  attempt: 7,
  receivedAt: new Date("2026-04-29T12:34:56Z"),
  replayedFromDeliveryId: null,
};

const inboundDelivery = {
  id: "d_inbound_1",
  webhookConfigId: "cfg_b",
  webhookConfig: { name: "Jira inbound", adapterType: "JIRA" },
  direction: "INBOUND",
  adapterType: "JIRA",
  eventType: "jira:issue_updated",
  eventId: null,
  payloadDigest: "abc123",
  statusCode: 200,
  latencyMs: 42,
  error: null,
  attempt: 1,
  receivedAt: new Date("2026-04-28T08:00:00Z"),
  replayedFromDeliveryId: null,
};

function setDeliveries(rows: any[]) {
  mockFindManyWebhookDelivery.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: rows }),
  });
  mockCountWebhookDelivery.mockReturnValue({
    data: rows.length,
    isLoading: false,
  });
  // The drawer lazy-loads the full record by id when opened. The tests
  // assert against fields on the seeded delivery rows, so mirror them.
  mockFindUniqueWebhookDelivery.mockImplementation((args: any) => {
    const id = args?.where?.id;
    const match = rows.find((r) => r.id === id) ?? null;
    return { data: match, isLoading: false };
  });
}

function setConfigs(rows: unknown[]) {
  mockFindManyWebhookConfig.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: rows }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.current = "";
  setDeliveries([]);
  setConfigs([baseConfig, otherConfig]);
});

describe("WebhookDeliveriesTab", () => {
  // Test 1 — three-tab integration is verified at the page level (testid
  // assertion on `webhooks-tab-deliveries`); this suite focuses on the tab
  // body. We assert the deliveries tab can render in isolation.
  it("Test 1: renders the deliveries tab root testid in isolation", () => {
    render(<WebhookDeliveriesTab projectId={42} />);
    expect(screen.getByTestId("webhook-deliveries-tab")).toBeInTheDocument();
  });

  it("Test 2: renders empty state and reset button when no rows match", () => {
    setDeliveries([]);
    render(<WebhookDeliveriesTab projectId={42} />);
    expect(screen.getByTestId("webhook-deliveries-empty")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-deliveries-reset")).toBeInTheDocument();
  });

  it("Test 3: renders the deliveries table with one row per delivery", () => {
    setDeliveries([
      outboundFailedDelivery,
      { ...outboundFailedDelivery, id: "d2" },
      { ...outboundFailedDelivery, id: "d3" },
    ]);
    render(<WebhookDeliveriesTab projectId={42} />);
    expect(screen.getByTestId("webhook-deliveries-table")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-delivery-row-d_outbound_1")
    ).toBeInTheDocument();
    expect(screen.getByTestId("webhook-delivery-row-d2")).toBeInTheDocument();
    expect(screen.getByTestId("webhook-delivery-row-d3")).toBeInTheDocument();
  });

  it("Test 4: clicking the details icon on an OUTBOUND row opens drawer with eventId and Replay button", () => {
    setDeliveries([outboundFailedDelivery]);
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(
      screen.getByTestId("webhook-delivery-view-details-d_outbound_1")
    );
    expect(screen.getByTestId("webhook-delivery-drawer")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-drawer-replay-button")
    ).toBeInTheDocument();
    expect(screen.getByTestId("webhook-drawer-event-id").textContent).toContain(
      "evt_x"
    );
  });

  it("Test 5: clicking the details icon on an INBOUND row opens drawer with payloadDigest, banner, and NO Replay button", () => {
    setDeliveries([inboundDelivery]);
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(
      screen.getByTestId("webhook-delivery-view-details-d_inbound_1")
    );
    expect(screen.getByTestId("webhook-delivery-drawer")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-delivery-replay-not-supported")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("webhook-drawer-replay-button")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-drawer-payload-digest").textContent
    ).toContain("abc123");
  });

  it("Test 6: drawer surfaces statusCode, latency, error, attempt, receivedAt fields", () => {
    setDeliveries([outboundFailedDelivery]);
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(
      screen.getByTestId("webhook-delivery-view-details-d_outbound_1")
    );
    expect(
      screen.getByTestId("webhook-drawer-status-code").textContent
    ).toContain("500");
    expect(screen.getByTestId("webhook-drawer-latency").textContent).toContain(
      "1234"
    );
    expect(screen.getByTestId("webhook-drawer-error").textContent).toContain(
      "5xx upstream"
    );
    expect(screen.getByTestId("webhook-drawer-attempt").textContent).toContain(
      "7"
    );
    expect(
      screen.getByTestId("webhook-drawer-received-at")
    ).toBeInTheDocument();
  });

  it("Test 7: OUTBOUND replay button opens AlertDialog with confirm + cancel", () => {
    setDeliveries([outboundFailedDelivery]);
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(
      screen.getByTestId("webhook-delivery-view-details-d_outbound_1")
    );
    fireEvent.click(screen.getByTestId("webhook-drawer-replay-button"));
    expect(screen.getByTestId("webhook-replay-dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-replay-dialog-confirm")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-replay-dialog-cancel")
    ).toBeInTheDocument();
  });

  it("Test 8: replay-confirm calls replayWebhookDelivery action and surfaces success toast", async () => {
    setDeliveries([outboundFailedDelivery]);
    mockReplayWebhookDelivery.mockResolvedValue({ ok: true });
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(
      screen.getByTestId("webhook-delivery-view-details-d_outbound_1")
    );
    fireEvent.click(screen.getByTestId("webhook-drawer-replay-button"));
    fireEvent.click(screen.getByTestId("webhook-replay-dialog-confirm"));
    await waitFor(() => {
      expect(mockReplayWebhookDelivery).toHaveBeenCalledWith("d_outbound_1");
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("toastReplaySuccess");
    });
  });

  it("Test 9: filter bar surfaces config + status + date-range controls", () => {
    setDeliveries([]);
    render(<WebhookDeliveriesTab projectId={42} />);
    expect(
      screen.getByTestId("webhook-deliveries-filter-config")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-deliveries-filter-status")
    ).toBeInTheDocument();
    // Single date-range picker replaced separate since/until popovers.
    expect(
      screen.getByTestId("webhook-deliveries-filter-date-range-trigger")
    ).toBeInTheDocument();
  });

  it("Test 10: bulk-replay button visible with outbound count when 1-config + failed + outbound rows present", () => {
    mockSearchParams.current = "configIds=cfg_a&status=failed";
    setDeliveries([
      outboundFailedDelivery,
      { ...outboundFailedDelivery, id: "d2" },
      { ...outboundFailedDelivery, id: "d3" },
      { ...outboundFailedDelivery, id: "d4" },
      { ...outboundFailedDelivery, id: "d5" },
    ]);
    render(<WebhookDeliveriesTab projectId={42} />);
    const btn = screen.getByTestId("webhook-bulk-replay-button");
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain("5");
    expect(btn.textContent).toContain("outbound");
  });

  it("Test 11: bulk-replay button hidden + helper visible when all visible failures are inbound", () => {
    mockSearchParams.current = "configIds=cfg_b&status=failed";
    const inboundFailed = { ...inboundDelivery, error: "no_handler" };
    setDeliveries([
      inboundFailed,
      { ...inboundFailed, id: "i2" },
      { ...inboundFailed, id: "i3" },
      { ...inboundFailed, id: "i4" },
      { ...inboundFailed, id: "i5" },
    ]);
    render(<WebhookDeliveriesTab projectId={42} />);
    expect(
      screen.queryByTestId("webhook-bulk-replay-button")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("webhook-bulk-replay-hidden-helper")
    ).toBeInTheDocument();
  });

  it("Test 12: bulk-replay button hidden when multi-config OR non-failed", () => {
    // multi-config
    mockSearchParams.current = "configIds=cfg_a,cfg_b&status=failed";
    setDeliveries([outboundFailedDelivery]);
    const { unmount } = render(<WebhookDeliveriesTab projectId={42} />);
    expect(
      screen.queryByTestId("webhook-bulk-replay-button")
    ).not.toBeInTheDocument();
    unmount();
    // single-config but status=all
    mockSearchParams.current = "configIds=cfg_a&status=all";
    setDeliveries([outboundFailedDelivery]);
    render(<WebhookDeliveriesTab projectId={42} />);
    expect(
      screen.queryByTestId("webhook-bulk-replay-button")
    ).not.toBeInTheDocument();
  });

  it("Test 13: bulk-replay AlertDialog count reflects OUTBOUND-only (excludes inbound failures)", () => {
    mockSearchParams.current = "configIds=cfg_a&status=failed";
    const outboundRows = Array.from({ length: 6 }, (_, i) => ({
      ...outboundFailedDelivery,
      id: `out_${i}`,
    }));
    const inboundRows = Array.from({ length: 4 }, (_, i) => ({
      ...inboundDelivery,
      webhookConfigId: "cfg_a",
      direction: "INBOUND",
      error: "no_handler",
      id: `in_${i}`,
    }));
    setDeliveries([...outboundRows, ...inboundRows]);
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-bulk-replay-button"));
    const dialog = screen.getByTestId("webhook-bulk-replay-dialog");
    expect(dialog.textContent).toContain("6");
    expect(dialog.textContent).not.toMatch(/\b10\b/);
  });

  it("Test 14: bulk-replay confirm invokes action with config id + sinceTimestamp + untilTimestamp", async () => {
    mockSearchParams.current =
      "configIds=cfg_a&status=failed&since=2026-04-22T00:00:00Z&until=2026-04-29T23:59:59Z";
    mockBulkReplayFailedDeliveries.mockResolvedValue({
      ok: true,
      batchId: "bat_x",
      enqueuedCount: 5,
    });
    setDeliveries([outboundFailedDelivery]);
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(screen.getByTestId("webhook-bulk-replay-button"));
    fireEvent.click(screen.getByTestId("webhook-bulk-replay-confirm"));
    await waitFor(() => {
      expect(mockBulkReplayFailedDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookConfigId: "cfg_a",
          sinceTimestamp: expect.any(String),
          untilTimestamp: expect.any(String),
        })
      );
    });
  });

  it("Test 15: paginator visible when there are rows (replaces old load-more)", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({
      ...outboundFailedDelivery,
      id: `d_${i}`,
    }));
    setDeliveries(fifty);
    render(<WebhookDeliveriesTab projectId={42} />);
    // Cursor "load more" was replaced by server-side paginator (D-35 follow-up).
    expect(
      screen.getByTestId("webhook-deliveries-paginator")
    ).toBeInTheDocument();
  });

  it("Test 16: filter URL state survives initial render (status=failed pre-selected)", () => {
    mockSearchParams.current = "configIds=cfg_a&status=failed";
    setDeliveries([]);
    render(<WebhookDeliveriesTab projectId={42} />);
    const statusSelect = screen.getByTestId(
      "webhook-deliveries-filter-status"
    ) as HTMLSelectElement;
    expect(statusSelect.value).toBe("failed");
  });

  it("Test 17: defensive — inbound replay rejection toast surfaces when action returns reason", async () => {
    setDeliveries([outboundFailedDelivery]);
    mockReplayWebhookDelivery.mockResolvedValue({
      ok: false,
      reason: "inbound_replay_not_supported",
    });
    render(<WebhookDeliveriesTab projectId={42} />);
    fireEvent.click(
      screen.getByTestId("webhook-delivery-view-details-d_outbound_1")
    );
    fireEvent.click(screen.getByTestId("webhook-drawer-replay-button"));
    fireEvent.click(screen.getByTestId("webhook-replay-dialog-confirm"));
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "toastReplayInboundNotSupported"
      );
    });
  });
});
