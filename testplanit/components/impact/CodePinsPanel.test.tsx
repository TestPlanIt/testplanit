import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const mockProjectFindFirst = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindFirst: (...args: any[]) => mockProjectFindFirst(...args),
    },
  }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: any) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("./AddCodePinDialog", () => ({
  AddCodePinDialog: ({
    open,
    onCreated,
    onUpdated,
    caseId,
    configId,
    repositoryId,
    repositories,
    pin,
  }: any) =>
    open ? (
      <div
        data-testid={pin ? "edit-code-pin-dialog" : "add-code-pin-dialog"}
        data-case-id={caseId}
        data-config-id={configId}
        data-repository-id={repositoryId}
        data-repositories={JSON.stringify(repositories ?? null)}
        data-pin-id={pin?.id}
      >
        <button
          type="button"
          data-testid="mock-create-pin"
          onClick={() => onCreated?.({ id: 500 }, caseId)}
        />
        <button
          type="button"
          data-testid="mock-update-pin"
          onClick={() => onUpdated?.({ ...pin, note: "edited" })}
        />
      </div>
    ) : null,
}));

import { toast } from "sonner";
import { CodePinsPanel } from "./CodePinsPanel";

const IMPACT_CONFIG = {
  id: 5,
  branch: "main",
  repositoryId: 3,
  cacheEnabled: true,
  repository: { name: "acme/shop" },
};
const SECOND_CONFIG = {
  id: 6,
  branch: null,
  repositoryId: 4,
  cacheEnabled: true,
  repository: { name: "acme/payments" },
};

function setProject(
  overrides: { impactEnabled?: boolean; configs?: any[] } = {}
) {
  mockProjectFindFirst.mockReturnValue({
    data: {
      impactEnabled: overrides.impactEnabled ?? true,
      codeRepositoryConfigs: overrides.configs ?? [IMPACT_CONFIG],
    },
    isLoading: false,
  });
}

function makePin(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    caseId: 99,
    configId: 5,
    kind: "RANGE",
    filePath: "src/payments/checkout.ts",
    startLine: 10,
    endLine: 20,
    symbol: null,
    anchorSha: "abcdef1234567",
    source: "MANUAL",
    note: null,
    staleDismissedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: { id: "u1", name: "Tester" },
    staleness: null,
    ...overrides,
  };
}

let pinsResponse: { pins: any[]; stalenessError: string | null } = {
  pins: [],
  stalenessError: null,
};

function setPins(pins: any[], stalenessError: string | null = null) {
  pinsResponse = { pins, stalenessError };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

describe("CodePinsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject();
    setPins([]);
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return jsonResponse(200, { ok: true });
      }
      if (url.endsWith("/reanchor")) {
        return jsonResponse(200, { pin: makePin() });
      }
      if (url.endsWith("/stale-dismissal")) {
        return jsonResponse(200, { dismissedAt: "2026-09-02T00:00:00.000Z" });
      }
      if (url.includes("/code-pins")) {
        return jsonResponse(200, pinsResponse);
      }
      return jsonResponse(404, { error: "Not found" });
    }) as any;
  });

  it("renders nothing when Impact is disabled for the project", () => {
    setProject({ impactEnabled: false });
    const { container } = renderWithClient(
      <CodePinsPanel caseId={99} projectId={7} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders nothing when the project has no IMPACT repository config", () => {
    setProject({ configs: [] });
    const { container } = renderWithClient(
      <CodePinsPanel caseId={99} projectId={7} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("asks the project gate for the IMPACT config only", () => {
    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    const args = mockProjectFindFirst.mock.calls[0][0];
    expect(args.where).toEqual({ id: 7 });
    expect(args.select.impactEnabled).toBe(true);
    expect(args.select.codeRepositoryConfigs.where).toEqual({
      purpose: "IMPACT",
    });
  });

  it("shows the empty state with the repository and branch when editable", () => {
    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    expect(screen.getByTestId("case-code-pins")).toBeInTheDocument();
    expect(screen.getByTestId("case-code-pins-repository")).toHaveTextContent(
      "acme/shop"
    );
    expect(screen.getByTestId("case-code-pins-repository")).toHaveTextContent(
      "main"
    );
    expect(screen.getByText("repository.codePins.empty")).toBeInTheDocument();
    expect(screen.getByTestId("case-code-pins-add")).toBeInTheDocument();
  });

  it("lists pins with their location, kind, and source badges", async () => {
    setPins([
      makePin(),
      makePin({
        id: 2,
        kind: "SYMBOL",
        symbol: "chargeCard",
        startLine: 4,
        endLine: 4,
        source: "AI",
        note: "Covers the retry path",
      }),
      makePin({
        id: 3,
        kind: "GLOB",
        filePath: "src/payments/**",
        startLine: null,
        endLine: null,
        anchorSha: null,
        source: "MAPFILE",
      }),
      makePin({
        id: 4,
        kind: "FILE",
        startLine: null,
        endLine: null,
        source: "ANNOTATION",
      }),
    ]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    expect(await screen.findByTestId("case-code-pin-1")).toBeInTheDocument();
    expect(screen.getByTestId("case-code-pin-location-1")).toHaveTextContent(
      "L10–L20"
    );
    expect(screen.getByTestId("case-code-pin-location-2")).toHaveTextContent(
      "chargeCard"
    );
    expect(screen.getByTestId("case-code-pin-location-3")).toHaveTextContent(
      "src/payments/**"
    );
    expect(screen.getByTestId("case-code-pin-location-4")).toHaveTextContent(
      "repository.codePins.kindFile"
    );
    expect(screen.getByText("Covers the retry path")).toBeInTheDocument();

    expect(screen.getByTestId("code-pin-kind-badge-RANGE")).toHaveTextContent(
      "repository.codePins.kindRange"
    );
    expect(
      screen.getByTestId("code-pin-kind-badge-SYMBOL")
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-pin-kind-badge-GLOB")).toBeInTheDocument();
    expect(screen.getByTestId("code-pin-kind-badge-FILE")).toBeInTheDocument();

    expect(screen.getByTestId("case-code-pin-source-1")).toHaveTextContent(
      "common.fields.manual"
    );
    expect(screen.getByTestId("case-code-pin-source-2")).toHaveTextContent(
      "runs.impact.reasons.ai"
    );
    expect(screen.getByTestId("case-code-pin-source-3")).toHaveTextContent(
      "repository.codePins.sourceMapfile"
    );
    expect(screen.getByTestId("case-code-pin-source-4")).toHaveTextContent(
      "repository.codePins.sourceAnnotation"
    );
  });

  it("shows the stale badge with re-anchor and dismiss actions on a stale manual pin", async () => {
    setPins([
      makePin({
        staleness: {
          stale: true,
          staleReason: "SNIPPET_NOT_FOUND",
          staleDismissed: false,
          checkedSha: "fff",
        },
      }),
    ]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    expect(
      await screen.findByTestId("case-code-pin-stale-1")
    ).toHaveTextContent("runs.impact.stale.badge");
    expect(screen.getByTestId("case-code-pin-reanchor-1")).toBeInTheDocument();
    expect(screen.getByTestId("case-code-pin-dismiss-1")).toBeInTheDocument();
  });

  it("hides the stale badge once the flag was dismissed", async () => {
    setPins([
      makePin({
        staleness: {
          stale: true,
          staleReason: "FILE_DELETED",
          staleDismissed: true,
          checkedSha: "fff",
        },
      }),
    ]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    expect(await screen.findByTestId("case-code-pin-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("case-code-pin-stale-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("case-code-pin-reanchor-1")
    ).not.toBeInTheDocument();
  });

  it("disables removal and offers no re-anchor on a repository-managed pin", async () => {
    setPins([
      makePin({
        id: 9,
        source: "ANNOTATION",
        staleness: {
          stale: true,
          staleReason: "SYMBOL_NOT_FOUND",
          staleDismissed: false,
          checkedSha: "fff",
        },
      }),
    ]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    expect(await screen.findByTestId("case-code-pin-9")).toBeInTheDocument();
    expect(screen.getByTestId("case-code-pin-remove-9")).toBeDisabled();
    expect(screen.getByTestId("case-code-pin-stale-9")).toBeInTheDocument();
    expect(
      screen.queryByTestId("case-code-pin-reanchor-9")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("case-code-pin-dismiss-9")
    ).not.toBeInTheDocument();
  });

  it("removes a pin through DELETE after the popover confirm", async () => {
    setPins([makePin({ id: 55 })]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    fireEvent.click(await screen.findByTestId("case-code-pin-remove-55"));
    fireEvent.click(screen.getByTestId("case-code-pin-remove-confirm-55"));

    await waitFor(() => {
      const deleteCall = (global.fetch as any).mock.calls.find(
        ([, init]: [string, RequestInit]) => init?.method === "DELETE"
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[0]).toBe("/api/repository-cases/99/code-pins/55");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "repository.codePins.removeSuccess"
      );
    });
  });

  it("surfaces a managed rejection from the server with the managed message", async () => {
    setPins([makePin({ id: 56 })]);
    (global.fetch as any).mockImplementation(
      async (url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return jsonResponse(409, {
            error: "Pin is managed by the repository",
            code: "managed",
          });
        }
        return jsonResponse(200, pinsResponse);
      }
    );

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    fireEvent.click(await screen.findByTestId("case-code-pin-remove-56"));
    fireEvent.click(screen.getByTestId("case-code-pin-remove-confirm-56"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "repository.codePins.managedTooltip"
      );
    });
  });

  it("re-anchors a stale pin through the reanchor route", async () => {
    setPins([
      makePin({
        id: 8,
        staleness: {
          stale: true,
          staleReason: "SNIPPET_NOT_FOUND",
          staleDismissed: false,
          checkedSha: "fff",
        },
      }),
    ]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    fireEvent.click(await screen.findByTestId("case-code-pin-reanchor-8"));

    await waitFor(() => {
      const call = (global.fetch as any).mock.calls.find(([url]: [string]) =>
        url.endsWith("/reanchor")
      );
      expect(call).toBeDefined();
      expect(call[0]).toBe("/api/repository-cases/99/code-pins/8/reanchor");
      expect(call[1].method).toBe("POST");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "repository.codePins.reanchorSuccess"
      );
    });
  });

  it("dismisses the stale flag through the server-clock route", async () => {
    setPins([
      makePin({
        id: 8,
        staleness: {
          stale: true,
          staleReason: "SNIPPET_NOT_FOUND",
          staleDismissed: false,
          checkedSha: "fff",
        },
      }),
    ]);

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    fireEvent.click(await screen.findByTestId("case-code-pin-dismiss-8"));

    await waitFor(() => {
      const call = (global.fetch as any).mock.calls.find(([url]: [string]) =>
        url.endsWith("/stale-dismissal")
      );
      expect(call).toBeDefined();
      expect(call[0]).toBe(
        "/api/repository-cases/99/code-pins/8/stale-dismissal"
      );
    });
  });

  it("renders a staleness check failure as a muted note, not an error", async () => {
    setPins([makePin()], "Provider unavailable");

    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    expect(
      await screen.findByTestId("case-code-pins-staleness-error")
    ).toHaveTextContent("Provider unavailable");
    expect(screen.getByTestId("case-code-pin-1")).toBeInTheDocument();
  });

  it("opens the add dialog for this case and config, then toasts and refetches on create", async () => {
    renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

    await waitFor(() => {
      expect(
        (global.fetch as any).mock.calls.filter(([url]: [string]) =>
          url.includes("/code-pins")
        )
      ).toHaveLength(1);
    });

    fireEvent.click(screen.getByTestId("case-code-pins-add"));
    const dialog = screen.getByTestId("add-code-pin-dialog");
    expect(dialog).toHaveAttribute("data-case-id", "99");
    expect(dialog).toHaveAttribute("data-config-id", "5");

    fireEvent.click(screen.getByTestId("mock-create-pin"));

    expect(toast.success).toHaveBeenCalledWith(
      "repository.codePins.addSuccess"
    );
    await waitFor(() => {
      expect(
        (global.fetch as any).mock.calls.filter(([url]: [string]) =>
          url.includes("/code-pins")
        ).length
      ).toBeGreaterThan(1);
    });
  });

  describe("read-only mode", () => {
    it("renders nothing when the case has no pins", async () => {
      const { container } = renderWithClient(
        <CodePinsPanel caseId={99} projectId={7} readOnly />
      );

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      expect(container).toBeEmptyDOMElement();
    });

    it("lists pins without add, remove, or stale actions", async () => {
      setPins([
        makePin({
          staleness: {
            stale: true,
            staleReason: "FILE_DELETED",
            staleDismissed: false,
            checkedSha: "fff",
          },
        }),
      ]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} readOnly />);

      expect(await screen.findByTestId("case-code-pin-1")).toBeInTheDocument();
      expect(screen.getByTestId("case-code-pin-stale-1")).toBeInTheDocument();
      expect(
        screen.queryByTestId("case-code-pins-add")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("case-code-pin-remove-1")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("case-code-pin-reanchor-1")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("case-code-pin-dismiss-1")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("case-code-pin-edit-1")
      ).not.toBeInTheDocument();
    });
  });

  describe("editing a pin", () => {
    it("opens the dialog on the row's pin", async () => {
      setPins([makePin()]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);
      fireEvent.click(await screen.findByTestId("case-code-pin-edit-1"));

      const dialog = screen.getByTestId("edit-code-pin-dialog");
      expect(dialog).toHaveAttribute("data-pin-id", "1");
      expect(
        screen.queryByTestId("add-code-pin-dialog")
      ).not.toBeInTheDocument();
    });

    it("confirms the save and closes", async () => {
      setPins([makePin()]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);
      fireEvent.click(await screen.findByTestId("case-code-pin-edit-1"));
      fireEvent.click(screen.getByTestId("mock-update-pin"));

      await waitFor(() =>
        expect(
          screen.queryByTestId("edit-code-pin-dialog")
        ).not.toBeInTheDocument()
      );
      expect(toast.success).toHaveBeenCalledWith(
        "repository.codePins.updateSuccess"
      );
    });

    it("does not offer editing on a repository-managed pin", async () => {
      setPins([makePin({ source: "ANNOTATION" })]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

      expect(await screen.findByTestId("case-code-pin-edit-1")).toBeDisabled();
    });
  });

  describe("several connected repositories", () => {
    beforeEach(() => {
      setProject({ configs: [IMPACT_CONFIG, SECOND_CONFIG] });
    });

    it("counts the repositories in the header and names each pin's own", async () => {
      setPins([
        makePin({ id: 1, configId: 5 }),
        makePin({
          id: 2,
          configId: 6,
          filePath: "services/payments/charge.ts",
        }),
      ]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

      expect(
        await screen.findByTestId("case-code-pins-repository")
      ).toHaveTextContent("repository.codePins.repositoriesCount");
      // The badge's tooltip names every connected repository.
      const list = screen.getByTestId("case-code-pins-repository-list");
      expect(list).toHaveTextContent("acme/shop");
      expect(list).toHaveTextContent("main");
      expect(list).toHaveTextContent("acme/payments");
      expect(
        await screen.findByTestId("case-code-pin-repository-1")
      ).toHaveTextContent("acme/shop");
      expect(
        screen.getByTestId("case-code-pin-repository-2")
      ).toHaveTextContent("acme/payments");
    });

    it("shows no repository column with a single connection", async () => {
      setProject({ configs: [IMPACT_CONFIG] });
      setPins([makePin({ id: 1, configId: 5 })]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);

      await screen.findByTestId("case-code-pin-1");
      expect(
        screen.queryByTestId("case-code-pin-repository-1")
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("case-code-pins-repository")).toHaveTextContent(
        "acme/shop"
      );
    });

    it("offers every repository when adding and starts on the first", async () => {
      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);
      await waitFor(() =>
        expect(screen.getByTestId("case-code-pins-add")).toBeInTheDocument()
      );

      fireEvent.click(screen.getByTestId("case-code-pins-add"));
      const dialog = screen.getByTestId("add-code-pin-dialog");
      expect(dialog).toHaveAttribute("data-config-id", "5");
      expect(dialog).toHaveAttribute("data-repository-id", "3");
      expect(JSON.parse(dialog.getAttribute("data-repositories")!)).toEqual([
        { configId: 5, repositoryId: 3, name: "acme/shop" },
        { configId: 6, repositoryId: 4, name: "acme/payments" },
      ]);
    });

    it("edits a pin against the repository it belongs to", async () => {
      setPins([makePin({ id: 2, configId: 6 })]);

      renderWithClient(<CodePinsPanel caseId={99} projectId={7} />);
      fireEvent.click(await screen.findByTestId("case-code-pin-edit-2"));

      const dialog = screen.getByTestId("edit-code-pin-dialog");
      expect(dialog).toHaveAttribute("data-config-id", "6");
      expect(dialog).toHaveAttribute("data-repository-id", "4");
    });
  });
});
