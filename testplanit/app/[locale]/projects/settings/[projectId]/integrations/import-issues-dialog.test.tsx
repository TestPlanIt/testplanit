import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    const last = key.split(".").pop() ?? key;
    return params ? `${last}:${JSON.stringify(params)}` : last;
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="import-issues-dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, "data-testid": testId }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  ),
}));

// Select stub -- walks the JSX tree (pre-render) to extract SelectItem
// value/label pairs and the SelectTrigger's own id, rendering a single
// native <select> so tests can fireEvent.change it directly. Mirrors the
// established pattern in webhook-deliveries-tab.test.tsx.
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
    SelectItem,
    SelectTrigger,
    SelectValue: ({ children }: any) => <span>{children}</span>,
  };
});

// Reuses the same chip-display + add/remove mock shape as
// requirements-config-settings.test.tsx.
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: ({ value, placeholder, onValueChange }: any) => (
    <div data-testid="multi-async-combobox">
      <span>{placeholder}</span>
      {value.map((v: any) => (
        <span key={v.id} data-testid="selected-type">
          {v.name}
        </span>
      ))}
      <button
        type="button"
        data-testid="mock-add-type"
        onClick={() =>
          onValueChange?.([...value, { id: "type-new", name: "Story" }])
        }
      >
        Add type
      </button>
    </div>
  ),
}));

import { ImportIssuesDialog } from "./import-issues-dialog";

const target = { id: "map-1", name: "Abstract", key: "ABT" };
const originalFetch = global.fetch;

function mockFetchRoutes(
  routes: Array<[string, () => { status?: number; json?: any }]>
) {
  global.fetch = vi.fn((url: string) => {
    const match = routes.find(([pattern]) => url.includes(pattern));
    const result = match
      ? match[1]()
      : { status: 200, json: { issueTypes: [] } };
    const status = result.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.json ?? {},
    });
  }) as any;
}

describe("ImportIssuesDialog (#501/28-20 merged dialog)", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("states the configured types rather than offering a choice the server ignores", () => {
    // Neither import route reads a type list from the request body: the
    // requirements path always scopes to the types saved in Requirement
    // Sync. An editable selector here would claim a per-run choice that
    // does not exist, so the dialog reports the scope instead.
    mockFetchRoutes([]);

    render(
      <ImportIssuesDialog
        integrationId={1}
        projectId={100}
        target={target}
        open={true}
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        initialIssueTypeIds={["type-1", "type-2"]}
        initialIssueTypeNames={{ "type-1": "Epic", "type-2": "Story" }}
      />
    );

    expect(
      screen.getByTestId("import-configured-issue-types").textContent
    ).toContain("Epic");
    expect(
      screen.getByTestId("import-configured-issue-types").textContent
    ).toContain("Story");
    expect(screen.queryByTestId("multi-async-combobox")).toBeNull();
  });

  it("imports every issue of the selected types when no limit is set", async () => {
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 5, hasMore: false } }),
      ],
      ["requirements-import", () => ({ json: { jobId: "job-1" } })],
    ]);
    const onStarted = vi.fn();

    render(
      <ImportIssuesDialog
        integrationId={1}
        projectId={100}
        target={target}
        open={true}
        onOpenChange={vi.fn()}
        onStarted={onStarted}
        initialIssueTypeIds={["type-1"]}
        initialIssueTypeNames={{ "type-1": "Epic" }}
      />
    );

    // No date limit and no cap by default, since types were preselected.
    fireEvent.click(screen.getByTestId("import-issues-typed-start"));

    await waitFor(() => screen.getByTestId("import-issues-typed-confirm"));
    fireEvent.click(screen.getByTestId("import-issues-typed-confirm"));

    await waitFor(() => {
      const triggerCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) =>
          url.includes("requirements-import") && !url.includes("preview")
      );
      expect(triggerCall).toBeDefined();
      expect(JSON.parse(triggerCall![1].body)).toEqual({
        projectId: 100,
        integrationProjectId: "map-1",
      });
    });
    expect(onStarted).toHaveBeenCalled();
  });

  it("asks for confirmation naming the tracker count before an uncapped import", async () => {
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 42, hasMore: false } }),
      ],
      ["requirements-import", () => ({ json: { jobId: "job-1" } })],
    ]);

    render(
      <ImportIssuesDialog
        integrationId={1}
        projectId={100}
        target={target}
        open={true}
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
        initialIssueTypeIds={["type-1"]}
        initialIssueTypeNames={{ "type-1": "Epic" }}
      />
    );

    fireEvent.click(screen.getByTestId("import-issues-typed-start"));

    await waitFor(() => {
      expect(
        screen.getByTestId("import-issues-typed-preview")
      ).toHaveTextContent(/"count":42/);
    });

    // The count must be named BEFORE any write happens.
    expect(
      (global.fetch as any).mock.calls.some(
        ([url]: [string]) =>
          url.includes("requirements-import") && !url.includes("preview")
      )
    ).toBe(false);

    fireEvent.click(screen.getByTestId("import-issues-typed-confirm"));

    await waitFor(() => {
      expect(
        (global.fetch as any).mock.calls.some(
          ([url]: [string]) =>
            url.includes("requirements-import") && !url.includes("preview")
        )
      ).toBe(true);
    });
  });

  it("still imports a recent capped sample when a window and cap are set", async () => {
    mockFetchRoutes([
      [
        "import-issues/preview",
        () => ({ json: { matched: 12, hasMore: false } }),
      ],
      ["import-issues", () => ({ json: { jobId: "job-2" } })],
    ]);
    const onStarted = vi.fn();

    render(
      <ImportIssuesDialog
        integrationId={1}
        projectId={100}
        target={target}
        open={true}
        onOpenChange={vi.fn()}
        onStarted={onStarted}
      />
    );

    // Default state: 90-day window, cap of 200 -- today's behavior,
    // unchanged, with no preselected types.
    fireEvent.click(screen.getByRole("button", { name: "importPreview" }));

    await waitFor(() =>
      expect(
        (global.fetch as any).mock.calls.some(([url]: [string]) =>
          url.includes("import-issues/preview")
        )
      ).toBe(true)
    );

    fireEvent.click(screen.getByRole("button", { name: "importStart" }));

    await waitFor(() => {
      const triggerCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) =>
          url.includes("import-issues") && !url.includes("preview")
      );
      expect(triggerCall).toBeDefined();
      const body = JSON.parse(triggerCall![1].body);
      expect(body.integrationProjectId).toBe("map-1");
      expect(body.updatedWithinDays).toBe(90);
      expect(body.cap).toBe(200);
    });
    expect(onStarted).toHaveBeenCalled();

    // The windowed, capped path never reaches the typed, windowless route.
    expect(
      (global.fetch as any).mock.calls.some(([url]: [string]) =>
        url.includes("requirements-import")
      )
    ).toBe(false);
  });

  it("selecting All history with no preselected types states the no-types message and never writes", async () => {
    render(
      <ImportIssuesDialog
        integrationId={1}
        projectId={100}
        target={target}
        open={true}
        onOpenChange={vi.fn()}
        onStarted={vi.fn()}
      />
    );

    // Clear the cap -- alone, this is enough to route to the typed path.
    fireEvent.change(screen.getByLabelText("importMax"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByTestId("import-issues-typed-start"));

    await waitFor(() => {
      expect(screen.getByText("importNoTypes")).toBeInTheDocument();
    });
    expect(
      (global.fetch as any).mock.calls.some(([url]: [string]) =>
        url.includes("requirements-import")
      )
    ).toBe(false);
  });
});
