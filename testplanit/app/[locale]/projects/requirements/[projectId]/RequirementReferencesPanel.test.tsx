// Proves D-13/D-14/D-15 (CONTEXT.md / UI-SPEC): a dedicated "References"
// card in RequirementDetailPanel's existing stack, count-first pluralized
// title, key + title + live status chip per row, external references open
// externalUrl in a new tab (http(s)-only guard, T-27-09-01), internal
// references navigate in-app, and removal is a popover-confirm hard-delete
// of the join row only (the referenced Issue always survives).
//
// 27-09 converts each it.todo scaffolded by 27-01 into a real assertion now
// that RequirementReferencesPanel exists.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom gives the scroll container zero height, so a real useVirtualizer
// mounts no rows. Stubbed to a fixed window, as MatrixGrid.test.tsx does.
const VIRTUALIZER_RENDER_CAP = 20;
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: () => number;
  }) => {
    const size = estimateSize();
    const items = Array.from(
      { length: Math.min(count, VIRTUALIZER_RENDER_CAP) },
      (_, i) => ({
        index: i,
        key: i,
        start: i * size,
        size,
        end: (i + 1) * size,
        lane: 0,
      })
    );
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * size,
      measureElement: () => {},
    };
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, params?: any) => {
    if (key === "title" && params) {
      const count = params.count as number;
      if (count === 0) return "References";
      if (count === 1) return `${count} Reference`;
      return `${count} References`;
    }
    return namespace ? `${namespace}.${key}` : key;
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Same simplified always-rendered-content convention
// LinkedRequirementCasesPanel.test.tsx already established for this exact
// primitive -- avoids depending on Radix's real open/portal behavior for a
// plain click-to-confirm affordance.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: any) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

// RequirementsListView.test.tsx's own established stand-in for this exact
// component -- its real color-lookup behavior (useIssueColors) is that
// component's own job, not this file's.
vi.mock("@/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: ({ status }: { status: string | null }) => (
    <span data-testid="mock-issue-status">{status ?? ""}</span>
  ),
}));

let capturedOnIssuesSelected: ((issues: any[]) => void) | null = null;
let capturedLinkedIssueIds: (string | number)[] | null = null;
let capturedDialogOpen = false;
vi.mock("@/components/issues/requirement-reference-search-dialog", () => ({
  RequirementReferenceSearchDialog: ({
    open,
    onIssuesSelected,
    linkedIssueIds,
  }: any) => {
    capturedOnIssuesSelected = onIssuesSelected;
    capturedLinkedIssueIds = linkedIssueIds;
    capturedDialogOpen = open;
    return open ? <div data-testid="reference-search-dialog" /> : null;
  },
}));

const mockFindMany = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    requirementIssueReference: {
      useFindMany: (...args: any[]) => mockFindMany(...args),
    },
    // The shared IssuesDisplay this panel now renders reads the colour
    // palette through useIssueColors.
    color: { useFindMany: () => ({ data: [], isLoading: false }) },
  }),
}));

import { toast } from "sonner";
import { RequirementReferencesPanel } from "./RequirementReferencesPanel";

// IssuesDisplay (rendered per reference row) fetches tracker details through
// react-query, so the panel now needs a client in scope.
function renderPanel(
  props: { projectId?: number; requirementId?: number } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RequirementReferencesPanel
        projectId={props.projectId ?? 7}
        requirementId={props.requirementId ?? 42}
      />
    </QueryClientProvider>
  );
}

const mockRefetch = vi.fn();
function setReferenceRows(rows: any[]) {
  mockFindMany.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: mockRefetch,
  });
}

const internalRow = {
  requirementId: 42,
  referencedIssueId: 55,
  referencedIssue: {
    id: 55,
    name: "TPI-9",
    title: "Fix flaky login test",
    status: "Open",
    externalKey: null,
    externalUrl: null,
    projectId: 7,
  },
};

const externalRow = {
  requirementId: 42,
  referencedIssueId: 77,
  referencedIssue: {
    id: 77,
    name: "TPI-12",
    title: "Investigate checkout timeout",
    status: "In Progress",
    externalKey: "TPI-12",
    externalUrl: "https://jira.example.com/browse/TPI-12",
    projectId: 7,
  },
};

describe("RequirementReferencesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnIssuesSelected = null;
    capturedLinkedIssueIds = null;
    capturedDialogOpen = false;
    setReferenceRows([]);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as any;
  });

  it("renders the count-first pluralized card title", () => {
    setReferenceRows([internalRow, externalRow]);
    renderPanel();

    expect(screen.getByText("2 References")).toBeInTheDocument();
  });

  it("renders the empty state when the requirement has no references", () => {
    renderPanel();

    expect(screen.getByText("References")).toBeInTheDocument();
    expect(
      screen.getByText("requirements.references.empty")
    ).toBeInTheDocument();
    expect(
      screen.getByText("requirements.references.emptyHint")
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders key, title and a live status chip for each reference row", () => {
    setReferenceRows([internalRow, externalRow]);
    renderPanel();

    expect(
      screen.getByTestId("requirement-reference-link-55")
    ).toHaveTextContent("TPI-9: Fix flaky login test");
    expect(
      screen.getByTestId("requirement-reference-link-77")
    ).toHaveTextContent("TPI-12: Investigate checkout timeout");

    const statuses = screen.getAllByTestId("mock-issue-status");
    expect(statuses.map((el) => el.textContent)).toEqual([
      "Open",
      "In Progress",
    ]);
  });

  it("opens an external reference in a new tab via externalUrl", () => {
    setReferenceRows([externalRow]);
    renderPanel();

    const link = screen.getByTestId("requirement-reference-link-77");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute(
      "href",
      "https://jira.example.com/browse/TPI-12"
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("does not render a non-http(s) externalUrl as a link", () => {
    setReferenceRows([
      {
        ...externalRow,
        referencedIssue: {
          ...externalRow.referencedIssue,
          externalUrl: "javascript:alert(1)",
        },
      },
    ]);
    renderPanel();

    const link = screen.getByTestId("requirement-reference-link-77");
    expect(link.tagName).toBe("A");
    // Falls back to the in-app navigation Link (mocked above), not the raw
    // unsafe href -- proves the SAFE_EXTERNAL_URL_RE guard actually gates
    // which branch renders, not merely that an anchor exists.
    expect(link).toHaveAttribute("href", "/projects/issues/7?issueId=77");
    expect(link).not.toHaveAttribute("target", "_blank");
  });

  it("navigates in-app for an internal reference", () => {
    setReferenceRows([internalRow]);
    renderPanel();

    const link = screen.getByTestId("requirement-reference-link-55");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/projects/issues/7?issueId=55");
    expect(link).not.toHaveAttribute("target", "_blank");
  });

  it("links a cross-project internal reference to the issue's own project", () => {
    // The POST route permits cross-project internal picks (scope-gated),
    // and the issues page only resolves an id in its home project — the
    // link must carry the referenced issue's projectId, not the
    // requirement's.
    setReferenceRows([
      {
        ...internalRow,
        referencedIssue: { ...internalRow.referencedIssue, projectId: 31 },
      },
    ]);
    renderPanel();

    expect(screen.getByTestId("requirement-reference-link-55")).toHaveAttribute(
      "href",
      "/projects/issues/31?issueId=55"
    );
  });

  it("removes a reference through a popover confirm, never a native dialog", async () => {
    setReferenceRows([internalRow]);
    const confirmSpy = vi.spyOn(window, "confirm");

    renderPanel();

    fireEvent.click(screen.getByTestId("requirement-reference-remove-55"));
    fireEvent.click(
      screen.getByTestId("requirement-reference-remove-confirm-55")
    );

    await waitFor(() => {
      const deleteCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) =>
          url === "/api/projects/7/requirements/42/references/55"
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[1]).toMatchObject({ method: "DELETE" });
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("stays usable on a synced, locked requirement", () => {
    // The panel takes no lock-related prop at all -- nothing here to
    // disable, matching LinkedRequirementCasesPanel.tsx's own decision.
    render(<RequirementReferencesPanel projectId={7} requirementId={999} />);

    const addButton = screen.getByTestId(
      "requirement-references-add"
    ) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);

    fireEvent.click(addButton);
    expect(capturedDialogOpen).toBe(true);
  });
});

describe("RequirementReferencesPanel attach flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnIssuesSelected = null;
    capturedLinkedIssueIds = null;
    capturedDialogOpen = false;
    setReferenceRows([]);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ created: true }),
    })) as any;
  });

  it("posts internalIssueId for an internal pick", async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId("requirement-references-add"));
    expect(capturedOnIssuesSelected).not.toBeNull();

    await act(async () => {
      await capturedOnIssuesSelected!([{ isExternal: false, id: 88 }]);
    });

    await waitFor(() => {
      const postCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) =>
          url === "/api/projects/7/requirements/42/references"
      );
      expect(postCall).toBeDefined();
      expect(postCall[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(postCall[1].body)).toEqual({ internalIssueId: 88 });
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it("posts an external payload for an external pick", async () => {
    renderPanel();

    fireEvent.click(screen.getByTestId("requirement-references-add"));
    await act(async () => {
      await capturedOnIssuesSelected!([
        {
          isExternal: true,
          id: "10001",
          key: "TPI-77",
          externalId: "10001",
          title: "Login flakiness",
          description: "Investigate",
          status: "Open",
          priority: "High",
          externalUrl: "https://jira.example.com/browse/TPI-77",
        },
      ]);
    });

    await waitFor(() => {
      const postCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) =>
          url === "/api/projects/7/requirements/42/references"
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall[1].body)).toEqual({
        external: {
          externalId: "10001",
          key: "TPI-77",
          title: "Login flakiness",
          description: "Investigate",
          status: "Open",
          priority: "High",
          externalUrl: "https://jira.example.com/browse/TPI-77",
        },
      });
    });
  });

  it("seeds linkedIssueIds with both the internal id and the external key", () => {
    setReferenceRows([internalRow, externalRow]);
    renderPanel();

    fireEvent.click(screen.getByTestId("requirement-references-add"));

    expect(capturedLinkedIssueIds).toEqual(
      expect.arrayContaining([55, 77, "TPI-12"])
    );
  });

  it("toasts failure but still refetches when the attach request fails", async () => {
    // A partial failure still attached the successful references — the
    // refetch must happen so they show now, not on the next remount.
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Failed to attach reference." }),
    })) as any;

    renderPanel();
    fireEvent.click(screen.getByTestId("requirement-references-add"));
    await act(async () => {
      await capturedOnIssuesSelected!([{ isExternal: false, id: 88 }]);
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockRefetch).toHaveBeenCalled();
  });
});
