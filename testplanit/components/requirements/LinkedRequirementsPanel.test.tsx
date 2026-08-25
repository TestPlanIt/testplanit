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
// client-queries object needs both models.
const mockIssueFindMany = vi.fn();
const mockRepositoryCasesFindMany = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindMany: (...args: any[]) => mockIssueFindMany(...args),
    },
    repositoryCases: {
      useFindMany: (...args: any[]) => mockRepositoryCasesFindMany(...args),
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

describe("LinkedRequirementsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFetchOptions = null;
    capturedPick = null;
    setLinkedRequirements([]);
    setLinkedCases([]);
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

    render(<LinkedRequirementsPanel caseId={99} projectId={7} />);

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

  it("scopes the add-link search to requirement-typed issues only", async () => {
    render(<LinkedRequirementsPanel caseId={99} projectId={7} />);

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
    render(<LinkedRequirementsPanel caseId={99} projectId={7} />);

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

    render(<LinkedRequirementsPanel caseId={99} projectId={7} />);

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
    const { unmount } = render(
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
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/link") || url.includes("/unlink")) {
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      }
      return { ok: true, json: async () => ({ data: [] }) } as Response;
    }) as any;

    // Side 2: the case detail page (LinkedRequirementsPanel, this plan)
    // links the SAME requirement to the SAME case.
    render(<LinkedRequirementsPanel caseId={caseId} projectId={7} />);
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

  // Todo-only scaffold, owner 27-11. Proves COV-05/D-06/D-08: the
  // dismissible suspect flag on the case-side linkage panel.
  describe("COV-05 suspect flag (case side)", () => {
    it.todo(
      "renders a suspect badge on a linkage whose requirement was edited after the case's last run"
    );
    it.todo("renders no badge when the case has never been executed");
    it.todo(
      "renders no badge when the flag was already dismissed and no newer edit followed"
    );
    it.todo(
      "dismisses through a popover confirm and writes suspectDismissedAt on the caseId_issueId pair"
    );
    it.todo(
      "does not invalidate the coverage queries when a flag is dismissed"
    );
  });
});
