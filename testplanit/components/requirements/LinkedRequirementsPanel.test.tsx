import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// `~/lib/navigation`'s `Link` is next-intl's shared-navigation Link: it calls
// the REAL `useLocale()` and throws "No intl context found" without a
// provider, whatever `next-intl` itself is mocked to. The requirement detail
// panel and breadcrumb render it, so it needs the same plain-anchor stub
// `RequirementsListColumns.test.tsx` and `RequirementCoveragePanel.test.tsx`
// already use for this primitive.
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/requirements/42",
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

// Both this panel (`issue.useFindMany`) and LinkedRequirementCasesPanel.tsx
// (`repositoryCases.useFindMany`, from 25-13) are exercised in this file --
// the last test renders both to prove bidirectionality, so the mocked
// client-queries object needs both models. `repositoryCaseIssue` and
// `issue.useFindUnique` are COV-05's additions (27-11): the case-side panel
// reads/writes `repositoryCaseIssue` for dismissal state, and the
// requirement-side panel (rendered in the bidirectionality test too) reads
// `issue.useFindUnique` for the requirement's own `contentUpdatedAt`.
const mockIssueFindMany = vi.fn();
const mockIssueFindUnique = vi.fn();
const mockRepositoryCasesFindMany = vi.fn();
const mockRepositoryCaseIssueFindMany = vi.fn();
const mockRepositoryCaseIssueUseUpdate = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindMany: (...args: any[]) => mockIssueFindMany(...args),
      useFindUnique: (...args: any[]) => mockIssueFindUnique(...args),
    },
    repositoryCases: {
      useFindMany: (...args: any[]) => mockRepositoryCasesFindMany(...args),
    },
    repositoryCaseIssue: {
      useFindMany: (...args: any[]) => mockRepositoryCaseIssueFindMany(...args),
      useUpdate: (...args: any[]) => mockRepositoryCaseIssueUseUpdate(...args),
    },
  }),
}));

// Same simplified always-rendered-content convention
// LinkedRequirementCasesPanel.test.tsx (25-13) and RequirementDetailPanel.test.tsx
// already established for this exact primitive -- avoids depending on
// Radix's real open/portal behavior for a plain click-to-confirm affordance.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: any) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

// A stand-in combobox: exposes the fetcher and lets a test pick any
// candidate directly, matching LinkedRequirementCasesPanel.test.tsx's own
// established convention for this exact primitive. Both panels' dialogs are
// only ever mounted one at a time in this file's tests, so a single pair of
// module-level captures (overwritten per render) is sufficient -- there is
// no test here that needs two AsyncCombobox instances open simultaneously.
let capturedFetchOptions:
  ((q: string, p: number, s: number) => Promise<any>) | null = null;
let capturedPick: ((option: any) => void) | null = null;
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ fetchOptions, onValueChange, renderTrigger }: any) => {
    capturedFetchOptions = fetchOptions;
    capturedPick = onValueChange;
    return renderTrigger({ value: null, defaultContent: <span>pick</span> });
  },
}));

// Only needed for the bidirectionality test, which also renders
// LinkedRequirementCasesPanel.tsx (25-13).
vi.mock("@/components/tables/CaseDisplay", () => ({
  CaseDisplay: ({ name }: any) => (
    <span data-testid="case-display">{name}</span>
  ),
}));

vi.mock("@/components/TestCaseNameDisplay", () => ({
  TestCaseNameDisplay: ({ testCase }: any) => (
    <span data-testid={`case-name-${testCase.id}`}>{testCase.name}</span>
  ),
}));

vi.mock("@/components/search/ProjectNameDisplay", () => ({
  ProjectNameDisplay: ({ projectName }: any) => (
    <span data-testid="project-name">{projectName}</span>
  ),
}));

// The badge's own three-state behavior is RequirementProvenanceBadge.test.tsx's
// job (25-07) -- this file only needs to prove the panel renders it per
// linked row, matching RequirementDetailPanel.test.tsx's identical mock.
vi.mock(
  "@/projects/requirements/[projectId]/RequirementProvenanceBadge",
  () => ({
    RequirementProvenanceBadge: ({ requirement }: any) => (
      <div
        data-testid="requirement-provenance-badge"
        data-requirement-id={requirement.id}
      />
    ),
  })
);

import { toast } from "sonner";
import { LinkedRequirementCasesPanel } from "@/projects/requirements/[projectId]/LinkedRequirementCasesPanel";
import { LinkedRequirementsPanel } from "./LinkedRequirementsPanel";

function decodeQueryParam(url: string, param: string): any {
  const raw = new URL(url, "http://localhost").searchParams.get(param);
  return raw ? JSON.parse(raw) : null;
}

function setLinkedRequirements(rows: any[]) {
  mockIssueFindMany.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: vi.fn(),
  });
}

function setLinkedCases(rows: any[]) {
  mockRepositoryCasesFindMany.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: vi.fn(),
  });
}

// COV-05's per-linkage dismissal state (`repositoryCaseIssue.useFindMany`),
// keyed by issueId on the case-side panel.
const mockRefetchDismissals = vi.fn();
function setDismissals(rows: any[]) {
  mockRepositoryCaseIssueFindMany.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: mockRefetchDismissals,
  });
}

// COV-05's dismiss mutation (`repositoryCaseIssue.useUpdate`).
const mockDismissMutateAsync = vi.fn();
function setDismissMutation(overrides: { isPending?: boolean } = {}) {
  mockRepositoryCaseIssueUseUpdate.mockReturnValue({
    mutateAsync: mockDismissMutateAsync,
    isPending: overrides.isPending ?? false,
  });
}

// COV-05's one missing case-side value (`useCaseLatestExecution`, a real
// hook backed by a real fetch to /api/repository-cases/[caseId]/latest-execution)
// -- controlled through the shared fetch stub below, not through a ZenStack
// mock, since the hook is hand-written rather than generated.
let latestExecutionResponse: {
  caseId: number;
  lastExecutedAt: string | null;
} = { caseId: 99, lastExecutedAt: null };
function setLatestExecution(lastExecutedAt: string | null, caseId = 99) {
  latestExecutionResponse = { caseId, lastExecutedAt };
}

// Real useQuery (unmocked at the module-internal level, only useQueryClient
// is intercepted above) needs a real QueryClientProvider ancestor now that
// this panel composes useCaseLatestExecution -- mirrors
// RequirementCoveragePanel.test.tsx's own established convention for a
// hand-written useQuery hook.
function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

describe("LinkedRequirementsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFetchOptions = null;
    capturedPick = null;
    setLinkedRequirements([]);
    setLinkedCases([]);
    setDismissals([]);
    setDismissMutation();
    mockDismissMutateAsync.mockResolvedValue({});
    mockIssueFindUnique.mockReturnValue({ data: undefined });
    setLatestExecution(null);
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/model/Issue/count")) {
        return { ok: true, json: async () => ({ data: 0 }) } as Response;
      }
      if (url.includes("/api/model/Issue/findMany")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      if (url.includes("/api/model/RepositoryCases/count")) {
        return { ok: true, json: async () => ({ data: 0 }) } as Response;
      }
      if (url.includes("/api/model/RepositoryCases/findMany")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      if (url.includes("/latest-execution")) {
        return {
          ok: true,
          json: async () => latestExecutionResponse,
        } as Response;
      }
      if (url.includes("/covering-cases")) {
        return {
          ok: true,
          json: async () => ({ requirementId: 42, cases: [] }),
        } as Response;
      }
      if (url.includes("/link") || url.includes("/unlink")) {
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;
  });

  it("lists the requirements linked to the test case", () => {
    setLinkedRequirements([
      {
        id: 42,
        name: "Login must support SSO",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: 7,
      },
      {
        id: 43,
        name: "Logout clears the session",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: 7,
      },
    ]);

    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    expect(screen.getByTestId("linked-requirement-name-42")).toHaveTextContent(
      "Login must support SSO"
    );
    expect(screen.getByTestId("linked-requirement-name-43")).toHaveTextContent(
      "Logout clears the session"
    );
    expect(screen.getAllByTestId("requirement-provenance-badge")).toHaveLength(
      2
    );
  });

  // Operator UAT follow-up (2026-08-25): requirement rows use the
  // requirements display convention (issue-type icon + "KEY: Title" via
  // formatIssueDisplayText), not the case-style bare name -- a synced
  // requirement's `name` is just the tracker key and was unreadable alone.
  it('renders a synced requirement row as "KEY: Title"', () => {
    setLinkedRequirements([
      {
        id: 44,
        name: "ABT-1",
        title: "Recurring Course Assignment",
        externalUrl: "https://jira.example.com/browse/ABT-1",
        issueTypeName: "Epic",
        issueTypeIconUrl: null,
        isRequirement: true,
        integrationId: 9,
        requirementDetachedAt: null,
        projectId: 7,
      },
    ]);

    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    expect(screen.getByTestId("linked-requirement-name-44")).toHaveTextContent(
      "ABT-1: Recurring Course Assignment"
    );
  });

  it("scopes the add-link search to requirement-typed issues only", async () => {
    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirements-add"));

    expect(capturedFetchOptions).not.toBeNull();
    await act(async () => {
      await capturedFetchOptions!("", 0, 10);
    });

    const findManyCall = (global.fetch as any).mock.calls.find(
      ([url]: [string]) => url.includes("/api/model/Issue/findMany")
    );
    expect(findManyCall).toBeDefined();
    const params = decodeQueryParam(findManyCall[0], "q");
    // Asserts the `where` object the search actually sent, not merely that
    // a defect never rendered as an option -- a client-side filter would
    // pass a rendering-only assertion for the wrong reason.
    expect(params.where.isRequirement).toBe(true);
  });

  it("commits a new link through the same /api/issues/[issueId]/link route, with the requirement as the path param", async () => {
    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirements-add"));
    expect(capturedPick).not.toBeNull();

    act(() => {
      capturedPick!({
        id: 42,
        name: "Login must support SSO",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: 7,
      });
    });

    fireEvent.click(screen.getByTestId("case-linked-requirements-submit"));

    await waitFor(() => {
      // The requirement's id (42) is the path param, never the case's id
      // (99) -- getting this backwards is the single most likely defect in
      // this plan, per 25-14-PLAN.md's own interfaces block.
      const linkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/42/link"
      );
      expect(linkCall).toBeDefined();
      expect(linkCall[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(linkCall[1].body)).toEqual({
        entityType: "testCase",
        entityId: 99,
      });
    });
  });

  it("removes a link through the same /api/issues/[issueId]/unlink route", async () => {
    setLinkedRequirements([
      {
        id: 55,
        name: "Removable requirement",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: 7,
      },
    ]);

    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirement-remove-55"));
    fireEvent.click(
      screen.getByTestId("case-linked-requirement-remove-confirm-55")
    );

    await waitFor(() => {
      const unlinkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/55/unlink"
      );
      expect(unlinkCall).toBeDefined();
      expect(unlinkCall[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(unlinkCall[1].body)).toEqual({
        entityType: "testCase",
        entityId: 99,
      });
    });
  });

  it("shows the same link the requirement surface shows, from the opposite side", async () => {
    // The bidirectionality proof: exercise useRequirementCaseLinks from
    // BOTH call sites for the identical (requirementId, caseId) pair and
    // compare the two captured fetch calls to EACH OTHER -- not to two
    // independently-written expectations that merely happen to look
    // alike. Both panels commit through the same shared hook
    // (testplanit/hooks/useRequirementCaseLinks.ts, 25-13), which fixes
    // the requirement's issueId as the path param regardless of which
    // side initiated the call.
    const requirementId = 42;
    const caseId = 99;

    // Side 1: the requirement surface (LinkedRequirementCasesPanel, 25-13)
    // links a test case.
    const { unmount } = renderWithClient(
      <LinkedRequirementCasesPanel
        projectId="7"
        requirementId={requirementId}
      />
    );
    fireEvent.click(screen.getByTestId("requirement-linked-cases-add"));
    act(() => {
      capturedPick!({
        id: caseId,
        name: "Some case",
        source: "MANUAL",
        projectId: 7,
      });
    });
    fireEvent.click(screen.getByTestId("requirement-linked-cases-submit"));

    let requirementSideCall: [string, RequestInit] | undefined;
    await waitFor(() => {
      requirementSideCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === `/api/issues/${requirementId}/link`
      );
      expect(requirementSideCall).toBeDefined();
    });
    unmount();

    vi.clearAllMocks();
    capturedFetchOptions = null;
    capturedPick = null;
    setLinkedRequirements([]);
    setLinkedCases([]);
    setDismissals([]);
    setDismissMutation();
    mockIssueFindUnique.mockReturnValue({ data: undefined });
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/link") || url.includes("/unlink")) {
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }) as any;

    // Side 2: the case detail page (LinkedRequirementsPanel, this plan)
    // links the SAME requirement to the SAME case.
    renderWithClient(<LinkedRequirementsPanel caseId={caseId} projectId={7} />);
    fireEvent.click(screen.getByTestId("case-linked-requirements-add"));
    act(() => {
      capturedPick!({
        id: requirementId,
        name: "Login must support SSO",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: 7,
      });
    });
    fireEvent.click(screen.getByTestId("case-linked-requirements-submit"));

    let caseSideCall: [string, RequestInit] | undefined;
    await waitFor(() => {
      caseSideCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === `/api/issues/${requirementId}/link`
      );
      expect(caseSideCall).toBeDefined();
    });

    // The honest proof: the two independently-captured calls, compared to
    // each other -- same URL, same method, same body -- not two separate
    // fixtures that were each hand-checked against a hardcoded string.
    expect(caseSideCall![0]).toBe(requirementSideCall![0]);
    expect(JSON.parse(caseSideCall![1].body as string)).toEqual(
      JSON.parse(requirementSideCall![1].body as string)
    );
  });

  // Converted from 27-01's todo-only scaffold. Proves COV-05/D-06/D-08: the
  // dismissible suspect flag on the case-side linkage panel.
  describe("COV-05 suspect flag (case side)", () => {
    it("renders a suspect badge on a linkage whose requirement was edited after the case's last run", async () => {
      setLinkedRequirements([
        {
          id: 42,
          name: "Login must support SSO",
          isRequirement: true,
          integrationId: null,
          requirementDetachedAt: null,
          projectId: 7,
          contentUpdatedAt: "2026-01-10T00:00:00.000Z",
        },
      ]);
      setLatestExecution("2026-01-01T00:00:00.000Z");

      renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("case-linked-requirement-suspect-42")
        ).toBeInTheDocument();
      });
    });

    it("renders no badge when the case has never been executed", async () => {
      setLinkedRequirements([
        {
          id: 42,
          name: "Login must support SSO",
          isRequirement: true,
          integrationId: null,
          requirementDetachedAt: null,
          projectId: 7,
          contentUpdatedAt: "2026-01-10T00:00:00.000Z",
        },
      ]);
      setLatestExecution(null);

      renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

      await waitFor(() => {
        expect(
          (global.fetch as any).mock.calls.some(([url]: [string]) =>
            url.includes("/latest-execution")
          )
        ).toBe(true);
      });
      await waitFor(() => {
        expect(
          screen.queryByTestId("case-linked-requirement-suspect-42")
        ).not.toBeInTheDocument();
      });
    });

    it("renders no badge when the flag was already dismissed and no newer edit followed", async () => {
      setLinkedRequirements([
        {
          id: 42,
          name: "Login must support SSO",
          isRequirement: true,
          integrationId: null,
          requirementDetachedAt: null,
          projectId: 7,
          contentUpdatedAt: "2026-01-10T00:00:00.000Z",
        },
      ]);
      setLatestExecution("2026-01-01T00:00:00.000Z");
      setDismissals([
        { issueId: 42, suspectDismissedAt: "2026-01-10T00:00:00.000Z" },
      ]);

      renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

      await waitFor(() => {
        expect(
          (global.fetch as any).mock.calls.some(([url]: [string]) =>
            url.includes("/latest-execution")
          )
        ).toBe(true);
      });
      await waitFor(() => {
        expect(
          screen.queryByTestId("case-linked-requirement-suspect-42")
        ).not.toBeInTheDocument();
      });
    });

    it("dismisses through a popover confirm and posts to the server-clock dismissal route on the caseId_issueId pair", async () => {
      // WR-02 (27.1-05): a frozen, deliberately skewed system clock proves
      // the request carries no client-supplied timestamp at all -- if the
      // panel still stamped `new Date()` client-side, this date would leak
      // into the request body and this test would have to assert AROUND it
      // instead of asserting the body has exactly one key.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      try {
        setLinkedRequirements([
          {
            id: 42,
            name: "Login must support SSO",
            isRequirement: true,
            integrationId: null,
            requirementDetachedAt: null,
            projectId: 7,
            contentUpdatedAt: "2026-01-10T00:00:00.000Z",
          },
        ]);
        setLatestExecution("2026-01-01T00:00:00.000Z");

        renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

        await waitFor(() => {
          expect(
            screen.getByTestId("case-linked-requirement-suspect-42")
          ).toBeInTheDocument();
        });

        fireEvent.click(
          screen.getByTestId("case-linked-requirement-suspect-42")
        );
        fireEvent.click(
          screen.getByTestId("case-linked-requirement-suspect-confirm-42")
        );

        await waitFor(() => {
          const dismissCall = (global.fetch as any).mock.calls.find(
            ([url]: [string]) =>
              url === "/api/repository-cases/99/suspect-dismissal"
          );
          expect(dismissCall).toBeDefined();
          const body = JSON.parse(dismissCall[1].body);
          expect(body).toEqual({ issueId: 42 });
          expect(Object.keys(body)).toEqual(["issueId"]);
        });

        expect(mockDismissMutateAsync).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not invalidate the coverage queries when a flag is dismissed", async () => {
      setLinkedRequirements([
        {
          id: 42,
          name: "Login must support SSO",
          isRequirement: true,
          integrationId: null,
          requirementDetachedAt: null,
          projectId: 7,
          contentUpdatedAt: "2026-01-10T00:00:00.000Z",
        },
      ]);
      setLatestExecution("2026-01-01T00:00:00.000Z");

      renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

      await waitFor(() => {
        expect(
          screen.getByTestId("case-linked-requirement-suspect-42")
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("case-linked-requirement-suspect-42"));
      fireEvent.click(
        screen.getByTestId("case-linked-requirement-suspect-confirm-42")
      );

      // WR-02 (27.1-05): dismissal now posts through the server-clock route,
      // not the ZenStack mutation -- wait on that fetch call rather than
      // mockDismissMutateAsync, which the panel no longer calls.
      await waitFor(() => {
        expect(
          (global.fetch as any).mock.calls.some(
            ([url]: [string]) =>
              url === "/api/repository-cases/99/suspect-dismissal"
          )
        ).toBe(true);
      });

      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });
  });
});

// WR-04 (27.1-05): the case-side link/unlink must invalidate the coverage
// rollup and covering-cases drill-down its requirement-side twin already
// invalidates (LinkedRequirementCasesPanel.tsx's own F5/F9 block above),
// using a predicate that actually matches those keys -- not merely
// "invalidateQueries was called with something". `useRequirementCaseLinks`'
// own `invalidateLinkedQueries` predicate (JSON.stringify(key).includes(
// "RepositoryCases" | "Issue")) is exercised here too (it is the real,
// unmocked hook) but never matches either new key, so any predicate here
// that DOES match had to come from this panel's own invalidation calls.
describe("LinkedRequirementsPanel coverage query invalidation (WR-04)", () => {
  // Self-contained setup -- this describe block is a sibling of, not nested
  // inside, `describe("LinkedRequirementsPanel", ...)` above, so that
  // block's own `beforeEach` is out of scope here and must not be relied on.
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFetchOptions = null;
    capturedPick = null;
    setLinkedRequirements([]);
    setLinkedCases([]);
    setDismissals([]);
    setDismissMutation();
    mockDismissMutateAsync.mockResolvedValue({});
    mockIssueFindUnique.mockReturnValue({ data: undefined });
    setLatestExecution(null);
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/model/Issue/count")) {
        return { ok: true, json: async () => ({ data: 0 }) } as Response;
      }
      if (url.includes("/api/model/Issue/findMany")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      if (url.includes("/latest-execution")) {
        return {
          ok: true,
          json: async () => latestExecutionResponse,
        } as Response;
      }
      if (url.includes("/link") || url.includes("/unlink")) {
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;
  });

  function collectPredicates() {
    return mockInvalidateQueries.mock.calls
      .map(([arg]) => arg?.predicate)
      .filter(
        (predicate): predicate is (query: { queryKey: unknown[] }) => boolean =>
          typeof predicate === "function"
      );
  }

  // The linked requirement's OWN projectId (11) deliberately differs from
  // the panel's `projectId` prop (7, the case's project) -- pins down WHICH
  // project id the invalidation uses. If the panel invalidated on its own
  // `projectId` prop instead, these assertions would fail.
  const REQUIREMENT_PROJECT_ID = 11;

  it("invalidates the coverage rollup and the covering-cases drill-down after a link", async () => {
    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirements-add"));
    act(() => {
      capturedPick!({
        id: 42,
        name: "Login must support SSO",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: REQUIREMENT_PROJECT_ID,
      });
    });
    fireEvent.click(screen.getByTestId("case-linked-requirements-submit"));

    await waitFor(() => {
      const linkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/42/link"
      );
      expect(linkCall).toBeDefined();
    });

    const predicates = collectPredicates();
    expect(predicates.length).toBeGreaterThan(0);

    // Matches the linked requirement's OWN project's coverage rollup...
    expect(
      predicates.some((predicate) =>
        predicate({
          queryKey: ["requirementCoverage", REQUIREMENT_PROJECT_ID],
        })
      )
    ).toBe(true);
    // ...and that requirement's covering-cases drill-down...
    expect(
      predicates.some((predicate) =>
        predicate({
          queryKey: ["requirementCoveringCases", REQUIREMENT_PROJECT_ID, 42],
        })
      )
    ).toBe(true);
    // ...but not a different project's coverage rollup -- proves the
    // predicate discriminates rather than matching anything handed to it.
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ["requirementCoverage", 999] })
      )
    ).toBe(false);
  });

  it("invalidates the coverage rollup and the covering-cases drill-down after an unlink", async () => {
    setLinkedRequirements([
      {
        id: 55,
        name: "Removable requirement",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: REQUIREMENT_PROJECT_ID,
      },
    ]);

    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirement-remove-55"));
    fireEvent.click(
      screen.getByTestId("case-linked-requirement-remove-confirm-55")
    );

    await waitFor(() => {
      const unlinkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/55/unlink"
      );
      expect(unlinkCall).toBeDefined();
    });

    const predicates = collectPredicates();
    expect(predicates.length).toBeGreaterThan(0);

    expect(
      predicates.some((predicate) =>
        predicate({
          queryKey: ["requirementCoverage", REQUIREMENT_PROJECT_ID],
        })
      )
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({
          queryKey: ["requirementCoveringCases", REQUIREMENT_PROJECT_ID, 55],
        })
      )
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({
          queryKey: ["requirementCoveringCases", REQUIREMENT_PROJECT_ID, 999],
        })
      )
    ).toBe(false);
  });

  it("does not invalidate coverage queries when the link request fails", async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url === "/api/issues/42/link") {
        return {
          ok: false,
          json: async () => ({ error: "Failed to link test case." }),
        } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }) as any;

    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirements-add"));
    act(() => {
      capturedPick!({
        id: 42,
        name: "Login must support SSO",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: REQUIREMENT_PROJECT_ID,
      });
    });
    fireEvent.click(screen.getByTestId("case-linked-requirements-submit"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });

    const predicates = collectPredicates();
    expect(
      predicates.some((predicate) =>
        predicate({
          queryKey: ["requirementCoverage", REQUIREMENT_PROJECT_ID],
        })
      )
    ).toBe(false);
  });

  it("short-circuits without throwing when the linked requirement's projectId is null", async () => {
    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    fireEvent.click(screen.getByTestId("case-linked-requirements-add"));
    act(() => {
      capturedPick!({
        id: 42,
        name: "Login must support SSO",
        isRequirement: true,
        integrationId: null,
        requirementDetachedAt: null,
        projectId: null,
      });
    });
    fireEvent.click(screen.getByTestId("case-linked-requirements-submit"));

    await waitFor(() => {
      const linkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/42/link"
      );
      expect(linkCall).toBeDefined();
    });

    const predicates = collectPredicates();
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ["requirementCoverage", 7] })
      )
    ).toBe(false);
  });
});

// The execution surface (a run's case detail) mounts this same panel with
// `readOnly`, so the case being run shows what it covers without offering
// any way to change it. Every mutation affordance has to be gone, not just
// disabled -- a disabled control still tells the tester an action exists
// here, which is exactly the UX call Phase 26 deferred rather than guessed.
describe("LinkedRequirementsPanel — read-only mode", () => {
  const linkedRow = {
    id: 42,
    name: "Login must support SSO",
    isRequirement: true,
    integrationId: null,
    requirementDetachedAt: null,
    projectId: 7,
  };

  it("lists linked requirements but offers no add, remove, or Remove column", () => {
    setLinkedRequirements([linkedRow]);
    renderWithClient(
      <LinkedRequirementsPanel caseId={99} projectId={7} readOnly />
    );

    // The information is still there...
    expect(screen.getByTestId("case-linked-requirements")).toBeInTheDocument();
    expect(screen.getByTestId("linked-requirement-name-42")).toHaveTextContent(
      "Login must support SSO"
    );

    // ...and every way to change it is gone.
    expect(
      screen.queryByTestId("case-linked-requirements-add")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("case-linked-requirement-remove-42")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("common.actions.remove")).not.toBeInTheDocument();
  });

  it("keeps the add and remove controls when not read-only", () => {
    setLinkedRequirements([linkedRow]);
    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    expect(
      screen.getByTestId("case-linked-requirements-add")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("case-linked-requirement-remove-42")
    ).toBeInTheDocument();
  });

  it("renders nothing at all when a read-only case covers no requirements", () => {
    // Requirements are opt-in per project: with no rows and no action to
    // offer, an empty card would be permanent furniture on every run.
    setLinkedRequirements([]);
    const { container } = renderWithClient(
      <LinkedRequirementsPanel caseId={99} projectId={7} readOnly />
    );

    expect(
      screen.queryByTestId("case-linked-requirements")
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("still shows the empty state when editable, so an author knows the panel exists", () => {
    setLinkedRequirements([]);
    renderWithClient(<LinkedRequirementsPanel caseId={99} projectId={7} />);

    expect(screen.getByTestId("case-linked-requirements")).toBeInTheDocument();
  });

  it("shows a suspect flag as a signal but drops its dismissal action", async () => {
    // A suspect linkage: the requirement's content changed after the case's
    // last execution.
    setLinkedRequirements([
      { ...linkedRow, contentUpdatedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    setDismissals([{ caseId: 99, issueId: 42, suspectDismissedAt: null }]);
    setLatestExecution("2026-01-01T00:00:00.000Z");

    renderWithClient(
      <LinkedRequirementsPanel caseId={99} projectId={7} readOnly />
    );

    // The badge still warns the tester the case may no longer match.
    await waitFor(() => {
      expect(
        screen.getByTestId("case-linked-requirement-suspect-42")
      ).toBeInTheDocument();
    });

    // But dismissing it is a review decision that belongs on the authoring
    // surface, so the confirm action is not rendered here.
    expect(
      screen.queryByTestId("case-linked-requirement-suspect-confirm-42")
    ).not.toBeInTheDocument();
  });
});
