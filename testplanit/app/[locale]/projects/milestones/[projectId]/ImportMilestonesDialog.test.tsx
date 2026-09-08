import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
        const substituted = result.replace(`{${k}}`, String(v));
        // ICU forms this stub can't render (plurals like
        // "{count, plural, ...}") leave the key untouched — append the value
        // so tests can still assert on what was passed in.
        result = substituted === result ? `${result} ${v}` : substituted;
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
  Alert: ({ children, "data-testid": dataTestId }: any) => (
    <div role="alert" data-testid={dataTestId}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, onClick, title, "data-testid": dataTestId }: any) => (
    <span data-testid={dataTestId ?? "badge"} title={title} onClick={onClick}>
      {children}
    </span>
  ),
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

/**
 * Model a real Response: the dialog reads bodies via text() and parses them
 * itself (a proxy timeout answers with HTML, not JSON), so a mock that only
 * implements json() would not exercise the code path the component takes.
 */
function makeJsonResponse(
  body: any,
  init: { ok?: boolean; status?: number } = {}
) {
  const text = JSON.stringify(body);
  return {
    ok: init.ok ?? true,
    status: init.status ?? (init.ok === false ? 500 : 200),
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

/** Non-JSON body, as a reverse proxy returns on a gateway timeout. */
function makeHtmlResponse(status: number) {
  const text = `<html> <head><title>${status} Gateway Time-out</title></head> </html>`;
  return {
    ok: false,
    status,
    json: async () => JSON.parse(text), // throws, exactly like a real Response
    text: async () => text,
  };
}

function makePreviewResponse(items: any[]) {
  return makeJsonResponse({ items, hasMore: false });
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
        return Promise.resolve(makeJsonResponse({ queued: true }));
      }
      return Promise.resolve(makeJsonResponse({}));
    });

    render(<ImportMilestonesDialog {...baseProps} />);

    await screen.findByText("v1.0");
    const rows = screen.getAllByTestId("import-milestone-row");
    const row = rows.find((r) => within(r).queryByText("v1.0"))!;
    fireEvent.click(within(row).getByRole("checkbox"));

    // The next-intl mock renders the key with params substituted, so the
    // count-bearing label surfaces as "confirmSelectionCount".
    const confirmButton = await screen.findByText(/confirmSelectionCount/);
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

describe("ImportMilestonesDialog — multi-project picker", () => {
  const multiItems = [
    {
      id: "v-1",
      kind: "RELEASE",
      name: "Android Icebox",
      state: "FUTURE",
      rawState: "future",
      sourceProjects: [
        { id: "map-abt", key: "ABT", name: "Allego Bug Tracking" },
      ],
    },
    {
      id: "s-1",
      kind: "ITERATION",
      name: "Admin 9.2 S1",
      state: "ACTIVE",
      rawState: "active",
      sourceProjects: [{ id: "map-adm", key: "ADM", name: "Admin Tools" }],
    },
    {
      id: "s-9",
      kind: "ITERATION",
      name: "Shared Sprint",
      state: "ACTIVE",
      rawState: "active",
      sourceProjects: [
        { id: "map-abt", key: "ABT", name: "Allego Bug Tracking" },
        { id: "map-adm", key: "ADM", name: "Admin Tools" },
      ],
    },
  ];

  const baseProps = {
    integrationId: 9,
    projectId: 370,
    projectMappingId: "map-abt",
    open: true,
    onOpenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindManyMilestones.mockReturnValue({ data: [] });
    mockFetch.mockResolvedValue(makePreviewResponse(multiItems));
  });

  it("shows project chips and per-row source labels when 2+ Jira projects are present", async () => {
    render(<ImportMilestonesDialog {...baseProps} />);
    await screen.findByText("Android Icebox");

    expect(
      screen.getByTestId("import-milestones-project-all")
    ).toBeInTheDocument();
    expect(
      screen.getAllByTestId("import-milestones-project-chip")
    ).toHaveLength(2);
    const sources = screen.getAllByTestId("import-milestone-source");
    expect(sources.map((el) => el.textContent)).toEqual([
      "ABT",
      "ADM",
      "ABT · ADM",
    ]);
  });

  it("filters rows by the selected project chip, including shared artifacts", async () => {
    render(<ImportMilestonesDialog {...baseProps} />);
    await screen.findByText("Android Icebox");

    const chips = screen.getAllByTestId("import-milestones-project-chip");
    fireEvent.click(chips[1]); // Admin Tools

    expect(screen.queryByText("Android Icebox")).not.toBeInTheDocument();
    expect(screen.getByText("Admin 9.2 S1")).toBeInTheDocument();
    expect(screen.getByText("Shared Sprint")).toBeInTheDocument();
  });

  it("search text filters the pre-loaded list without refetching", async () => {
    render(<ImportMilestonesDialog {...baseProps} />);
    await screen.findByText("Android Icebox");
    const fetchCalls = mockFetch.mock.calls.length;

    fireEvent.change(screen.getByTestId("import-milestones-search"), {
      target: { value: "icebox" },
    });

    expect(screen.getByText("Android Icebox")).toBeInTheDocument();
    expect(screen.queryByText("Admin 9.2 S1")).not.toBeInTheDocument();
    expect(mockFetch.mock.calls.length).toBe(fetchCalls);
  });

  it("select-all only selects the currently filtered rows", async () => {
    render(<ImportMilestonesDialog {...baseProps} />);
    await screen.findByText("Android Icebox");

    const chips = screen.getAllByTestId("import-milestones-project-chip");
    fireEvent.click(chips[0]); // ABT: Android Icebox + Shared Sprint
    fireEvent.click(screen.getByTestId("import-milestones-select-all"));

    // The file's t() mock doesn't interpolate params — count the checked
    // row checkboxes instead (2 visible under the ABT filter).
    const rows = screen.getAllByTestId("import-milestone-row");
    const checked = rows.filter(
      (r) => (within(r).getByRole("checkbox") as HTMLInputElement).checked
    );
    expect(rows).toHaveLength(2);
    expect(checked).toHaveLength(2);
  });

  it("surfaces partial mapping-fetch warnings without blocking the list", async () => {
    mockFetch.mockResolvedValue(
      makeJsonResponse({
        items: multiItems.slice(1),
        hasMore: false,
        warnings: ["ABT: HTTP 400: boom"],
      })
    );
    render(<ImportMilestonesDialog {...baseProps} />);
    await screen.findByText("Admin 9.2 S1");
    expect(
      screen.getByTestId("import-milestones-warnings").textContent
    ).toContain("ABT: HTTP 400: boom");
  });

  it("reports a gateway timeout as a timeout, not a JSON parse error", async () => {
    // A proxy that gives up before the route finishes answers with an HTML
    // error page. Parsing it as JSON throws "Unexpected token '<'", which used
    // to reach the user verbatim in place of the real problem.
    mockFetch.mockResolvedValue(makeHtmlResponse(504));

    render(<ImportMilestonesDialog {...baseProps} />);

    const alert = await screen.findByTestId("import-milestones-error");
    expect(alert.textContent).toContain("requestTimedOut");
    expect(alert.textContent).not.toContain("JSON");
    expect(alert.textContent).not.toContain("<");
  });

  it("falls back to the HTTP status when a failure body carries no error field", async () => {
    mockFetch.mockResolvedValue(makeHtmlResponse(418));

    render(<ImportMilestonesDialog {...baseProps} />);

    const alert = await screen.findByTestId("import-milestones-error");
    expect(alert.textContent).toContain("unexpectedResponse");
  });

  it("still prefers the route's own JSON error message when there is one", async () => {
    mockFetch.mockResolvedValue(
      makeJsonResponse(
        { error: "ABT: HTTP 401: scope does not match" },
        { ok: false, status: 500 }
      )
    );

    render(<ImportMilestonesDialog {...baseProps} />);

    const alert = await screen.findByTestId("import-milestones-error");
    expect(alert.textContent).toContain("scope does not match");
  });

  describe("kind filter", () => {
    const mixedItems = [
      {
        id: "v-1",
        kind: "RELEASE",
        name: "v1.0",
        state: "ACTIVE",
        rawState: "unreleased",
      },
      {
        id: "s-1",
        kind: "ITERATION",
        name: "Sprint 9",
        state: "ACTIVE",
        rawState: "active",
      },
    ];

    it("requests both kinds by default — no kind param is sent", async () => {
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      expect(mockFetch.mock.calls[0][0]).not.toContain("kind=");
    });

    it("narrows the REQUEST, not just the list, when a single kind is picked", async () => {
      // Sprints cost board discovery plus a paginated fetch per board, so the
      // filter has to reach the server to be worth anything.
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);
      await screen.findByText("v1.0");

      fireEvent.click(screen.getByTestId("import-milestones-kind-release"));

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("kind=RELEASE")
        )
      );
    });

    it("sends kind=ITERATION for the sprint chip", async () => {
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);
      await screen.findByText("v1.0");

      fireEvent.click(screen.getByTestId("import-milestones-kind-sprint"));

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("kind=ITERATION")
        )
      );
    });

    it("returning to All drops the kind param again", async () => {
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);
      await screen.findByText("v1.0");

      fireEvent.click(screen.getByTestId("import-milestones-kind-release"));
      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("kind=RELEASE")
        )
      );

      fireEvent.click(screen.getByTestId("import-milestones-kind-all"));

      await waitFor(() => {
        const lastUrl = String(
          mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0]
        );
        expect(lastUrl).toContain("milestone-sync/preview");
        expect(lastUrl).not.toContain("kind=");
      });
    });

    it("re-clicking the active chip does not refetch", async () => {
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);
      await screen.findByText("v1.0");
      const callsBefore = mockFetch.mock.calls.length;

      fireEvent.click(screen.getByTestId("import-milestones-kind-all"));

      expect(mockFetch.mock.calls.length).toBe(callsBefore);
    });

    it("preserves the show-closed setting across a kind change", async () => {
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);
      await screen.findByText("v1.0");

      fireEvent.click(screen.getByRole("switch"));
      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("includeClosed=true")
        )
      );

      fireEvent.click(screen.getByTestId("import-milestones-kind-sprint"));

      await waitFor(() => {
        const lastUrl = String(
          mockFetch.mock.calls[mockFetch.mock.calls.length - 1][0]
        );
        expect(lastUrl).toContain("includeClosed=true");
        expect(lastUrl).toContain("kind=ITERATION");
      });
    });

    it("drops selections the narrowed result no longer contains", async () => {
      // Otherwise a sprint selected under All stays selected after switching
      // to Releases and gets imported without ever being visible.
      mockFetch.mockResolvedValue(makePreviewResponse(mixedItems));
      render(<ImportMilestonesDialog {...baseProps} />);
      await screen.findByText("Sprint 9");

      const rows = screen.getAllByTestId("import-milestone-row");
      const sprintRow = rows.find((r) => within(r).queryByText("Sprint 9"))!;
      fireEvent.click(within(sprintRow).getByRole("checkbox"));
      expect(
        await screen.findByText(/confirmSelectionCount/)
      ).toBeInTheDocument();

      mockFetch.mockResolvedValue(
        makePreviewResponse(mixedItems.filter((i) => i.kind === "RELEASE"))
      );
      fireEvent.click(screen.getByTestId("import-milestones-kind-release"));

      // Selection bar disappears entirely once the orphaned id is pruned.
      await waitFor(() =>
        expect(screen.queryByText(/confirmSelectionCount/)).toBeNull()
      );
    });
  });

  it("labels the import button with the selected count", async () => {
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
          kind: "RELEASE",
          name: "v2.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ])
    );
    render(<ImportMilestonesDialog {...baseProps} />);
    await screen.findByText("v1.0");

    const rows = screen.getAllByTestId("import-milestone-row");
    fireEvent.click(within(rows[0]).getByRole("checkbox"));
    // The next-intl mock substitutes ICU params, so the count is visible in
    // the rendered key.
    expect(
      await screen.findByText(/confirmSelectionCount.*1/)
    ).toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole("checkbox"));
    expect(
      await screen.findByText(/confirmSelectionCount.*2/)
    ).toBeInTheDocument();
  });
});
