import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const { mockFindManyMilestones, mockFetch } = vi.hoisted(() => {
  return {
    mockFindManyMilestones: vi.fn(),
    mockFetch: vi.fn(),
  };
});

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestones: {
      useFindMany: (...args: any[]) => mockFindManyMilestones(...args),
    },
  }),
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    let result = key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, String(v));
      });
    }
    return result;
  },
}));

// Mock shadcn/ui components minimally to avoid Radix/JSDOM friction.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    disabled,
    onCheckedChange,
    onClick,
    id,
    "data-testid": dataTestId,
  }: any) => (
    <input
      type="checkbox"
      role="checkbox"
      id={id}
      data-testid={dataTestId}
      checked={checked === true}
      disabled={disabled}
      onChange={() => onCheckedChange?.(!(checked === true))}
      onClick={onClick}
    />
  ),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, disabled, onCheckedChange, id }: any) => (
    <input
      type="checkbox"
      role="switch"
      id={id}
      checked={!!checked}
      disabled={disabled}
      onChange={() => onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

import { ImportMilestonesDialog } from "./ImportMilestonesDialog";

function makePreviewResponse(items: any[]) {
  return {
    ok: true,
    json: async () => ({ items, hasMore: false }),
  };
}

describe("ImportMilestonesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindManyMilestones.mockReturnValue({ data: [] });
    mockFetch.mockResolvedValue(makePreviewResponse([]));
  });

  const baseProps = {
    integrationId: 1,
    projectId: 42,
    projectMappingId: "mapping-1",
    open: true,
    onOpenChange: vi.fn(),
  };

  it("renders the list from a mocked preview response", async () => {
    mockFetch.mockResolvedValueOnce(
      makePreviewResponse([
        {
          id: "10001",
          kind: "RELEASE",
          name: "v1.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ])
    );

    render(<ImportMilestonesDialog {...baseProps} />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("milestone-sync/preview")
      )
    );
    expect(await screen.findByText("v1.0")).toBeInTheDocument();
  });

  it("marks already-linked items as disabled with a badge", async () => {
    mockFindManyMilestones.mockReturnValue({
      data: [{ externalId: "10001" }],
    });
    mockFetch.mockResolvedValueOnce(
      makePreviewResponse([
        {
          id: "10001",
          kind: "RELEASE",
          name: "v1.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ])
    );

    render(<ImportMilestonesDialog {...baseProps} />);

    await screen.findByText("v1.0");
    const row = screen.getByTestId("import-milestone-row");
    const checkbox = within(row).getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByTestId("badge")).toHaveTextContent("alreadyLinked");
  });

  it("defaults includeClosed to false and re-fetches when show-closed toggle flips", async () => {
    render(<ImportMilestonesDialog {...baseProps} />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("includeClosed=false")
      )
    );

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("includeClosed=true")
      )
    );
  });

  it("select-all toggles every selectable row on and off, skipping already-linked items", async () => {
    mockFetch.mockResolvedValue(
      makePreviewResponse([
        {
          id: "10001",
          kind: "RELEASE",
          name: "v1.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
        {
          id: "10002",
          kind: "ITERATION",
          name: "Sprint 9",
          state: "FUTURE",
          rawState: "future",
        },
        {
          id: "linked-1",
          kind: "RELEASE",
          name: "v0.9",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ])
    );

    mockFindManyMilestones.mockReturnValue({
      data: [{ externalId: "linked-1" }],
    });

    render(<ImportMilestonesDialog {...baseProps} />);

    await screen.findByText("v1.0");
    const selectAll = screen.getByTestId("import-milestones-select-all");

    fireEvent.click(selectAll);
    // Both selectable rows selected; the already-linked row is not.
    expect(screen.getByText(/selectedCount/)).toBeInTheDocument();
    const rows = screen.getAllByTestId("import-milestone-row");
    const checkedStates = rows.map(
      (r) => (within(r).getByRole("checkbox") as HTMLInputElement).checked
    );
    expect(checkedStates.filter(Boolean)).toHaveLength(2);

    fireEvent.click(selectAll);
    expect(screen.queryByText(/selectedCount/)).not.toBeInTheDocument();
  });

  it("selecting items and confirming POSTs the chosen externalIds to /import", async () => {
    mockFetch.mockImplementation((url: string, _options?: any) => {
      if (typeof url === "string" && url.includes("milestone-sync/preview")) {
        return Promise.resolve(
          makePreviewResponse([
            {
              id: "10001",
              kind: "RELEASE",
              name: "v1.0",
              state: "ACTIVE",
              rawState: "unreleased",
            },
            {
              id: "10002",
              kind: "ITERATION",
              name: "Sprint 5",
              state: "ACTIVE",
              rawState: "active",
            },
          ])
        );
      }
      if (typeof url === "string" && url.includes("milestone-sync/import")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ queued: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<ImportMilestonesDialog {...baseProps} />);

    await screen.findByText("v1.0");
    const rows = screen.getAllByTestId("import-milestone-row");
    const row = rows.find((r) => within(r).queryByText("v1.0"))!;
    fireEvent.click(within(row).getByRole("checkbox"));

    const confirmButton = await screen.findByText("confirmSelection");
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("milestone-sync/import"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            projectMappingId: "mapping-1",
            externalIds: ["10001"],
          }),
        })
      )
    );
  });
});
