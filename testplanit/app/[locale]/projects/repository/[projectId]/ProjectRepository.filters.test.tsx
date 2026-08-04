/**
 * Integration tests for ProjectRepository's filter/grouping separation.
 *
 * The ViewSelector is a pure grouping control: switching the "View by" axis
 * must never clear or seed filter predicates. Filter state lives in URL `f`
 * params owned by useRepositoryFilters; the only automatic predicate is the
 * run-mode "assigned to me" seed, decided exactly once per visit.
 *
 * Contract under test:
 * - axis switching writes only `?view=` and preserves the `f` params /
 *   predicates untouched (no seed branches, no clearing);
 * - the `?view=` write is gated off in selection mode so the case-selection
 *   dialog cannot leak its grouping into the host page's URL;
 * - the run-mode assigned-to-me seed decision matrix: fires once on a bare
 *   URL when the viewer has assignments; suppressed by existing `f` params,
 *   by a `?selectedCase=` deep link, outside run view mode, and on
 *   view-options errors; never re-fires after the user clears it;
 * - the view-options counts query is keyed by the canonical predicate
 *   serialization and sends the table's active predicate set in its body
 *   (the emptied set while the ES-search bypass is live); counts mute only
 *   while placeholder (previous predicate set) data is displayed;
 * - the run-mode first-folder auto-select stands down when the visited URL
 *   already carries filters, so a shared filtered link is never silently
 *   narrowed to one folder (spec §7.1).
 *
 * The component renders for real; children (TreeView, Cases, ViewSelector,
 * FilterBar, ...) are prop-capturing stubs so the tests drive the actual
 * handleViewChange / seed effect rather than a reimplementation.
 */

import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Hoisted spies / mutable holders (referenced from vi.mock factories) ----

const {
  mockRouterReplace,
  mockRouterPush,
  paramsHolder,
  sessionHolder,
  viewOptionsHolder,
  viewOptionsQueryHolder,
  viewSelectorSpy,
  filterBarSpy,
  casesSpy,
  treeViewSpy,
  caseFoldersHolder,
} = vi.hoisted(() => ({
  mockRouterReplace: vi.fn(),
  mockRouterPush: vi.fn(),
  paramsHolder: { current: { projectId: "42" } as Record<string, string> },
  sessionHolder: {
    current: {
      data: {
        user: {
          id: "user-test",
          name: "Test User",
          email: "test@example.com",
          access: "USER",
        },
      },
      status: "authenticated",
      update: () => {},
    } as any,
  },
  viewOptionsHolder: {
    current: { data: undefined as any, isError: false } as {
      data: any;
      isError: boolean;
      isPlaceholderData?: boolean;
    },
  },
  // Captures the options object ProjectRepository passes to the view-options
  // useQuery (queryKey / queryFn / placeholderData assertions).
  viewOptionsQueryHolder: { current: undefined as any },
  viewSelectorSpy: vi.fn(),
  filterBarSpy: vi.fn(),
  casesSpy: vi.fn(),
  treeViewSpy: vi.fn(),
  // Folders holding the run's cases — drives the run-mode first-folder
  // auto-select.
  caseFoldersHolder: { current: [] as Array<{ folderId: number }> },
}));

// Stable across renders (a fresh vi.fn per usePagination() call would be
// unassertable) and cleared by the beforeEach vi.clearAllMocks().
const { setCurrentPageSpy, toastErrorSpy, caseDetailsSpy } = vi.hoisted(() => ({
  setCurrentPageSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
  caseDetailsSpy: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorSpy,
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ---- Navigation / session / i18n ----

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/projects/repository/42",
  Link: ({ children }: any) => children,
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => paramsHolder.current,
  // Mirrors the real subscription: reflects the current URL each render.
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => "/projects/repository/42",
}));

vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => sessionHolder.current,
  };
});

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
  useLocale: () => "en-US",
}));

// ---- Data hooks ----

// The view-options useQuery is the only unmocked useQuery consumer left in the
// rendered tree (useFolderStats is module-mocked, children are stubs).
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQuery: (options: any) => {
      if (options?.queryKey?.[0] === "viewOptions") {
        viewOptionsQueryHolder.current = options;
        return viewOptionsHolder.current;
      }
      return { data: undefined, isError: false, refetch: vi.fn() };
    },
  };
});

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindFirst: () => ({
        data: { id: 42, name: "Test Project", iconUrl: null },
        isLoading: false,
      }),
      useCount: () => ({ data: 1, isLoading: false }),
    },
    repositories: {
      useFindFirst: () => ({ data: { id: 7 }, isLoading: false }),
    },
    projectLlmIntegration: {
      useFindMany: () => ({ data: [], isLoading: false }),
    },
    testRunCases: {
      useFindMany: () => ({ data: [], isLoading: false }),
    },
    repositoryCases: {
      useFindMany: () => ({
        data: caseFoldersHolder.current,
        isLoading: false,
      }),
    },
  }),
}));

vi.mock("~/lib/useFolderStats", () => ({
  useFolderStats: () => ({ data: [], refetch: vi.fn() }),
}));

// The real provider persists page/pageSize to the URL via router.replace,
// which would pollute the "no URL write" assertions below.
vi.mock("~/lib/contexts/PaginationContext", () => ({
  PaginationProvider: ({ children }: any) => children,
  usePagination: () => ({
    currentPage: 1,
    setCurrentPage: setCurrentPageSpy,
    pageSize: 25,
    setPageSize: vi.fn(),
    totalItems: 0,
    setTotalItems: vi.fn(),
    totalPages: 1,
    startIndex: 0,
    endIndex: 0,
  }),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: { canAddEdit: true, canDelete: true },
    isLoading: false,
  }),
}));

vi.mock("~/hooks/usePageFileDrop", () => ({
  usePageFileDrop: () => ({ isDragActive: false }),
}));

vi.mock("~/hooks/useDragTargetKind", () => ({
  DragTargetProvider: ({ children }: any) => children,
}));

vi.mock("@/components/Debounce", () => ({
  useDebounce: (value: any) => value,
}));

// ---- Child component stubs (prop-capturing where the tests drive them) ----

vi.mock("@/components/ViewSelector", () => ({
  ViewSelector: (props: any) => {
    viewSelectorSpy(props);
    return <div data-testid="view-selector-stub" />;
  },
}));

vi.mock("@/components/repository/filter-bar/RepositoryFilterBar", () => ({
  RepositoryFilterBar: (props: any) => {
    filterBarSpy(props);
    return <div data-testid="filter-bar-stub" />;
  },
}));

vi.mock("./Cases", () => ({
  default: (props: any) => {
    casesSpy(props);
    return <div data-testid="cases-stub" />;
  },
}));

vi.mock("./TreeView", () => ({
  default: (props: any) => {
    treeViewSpy(props);
    return <div data-testid="tree-view-stub" />;
  },
}));

vi.mock("./AddCase", () => ({ AddCase: () => null }));
vi.mock("./AddFolder", () => ({ AddFolder: () => null }));
vi.mock("./GenerateTestCasesWizard", () => ({
  GenerateTestCasesWizard: () => null,
}));
vi.mock("./ImportCasesWizard", () => ({ ImportCasesWizard: () => null }));
vi.mock("@/components/repositories/CaseDetailsPanel", () => ({
  CaseDetailsPanel: (props: any) => {
    caseDetailsSpy(props);
    return <div data-testid="case-details-stub" />;
  },
}));
vi.mock("@/components/duplicates/FindDuplicatesButton", () => ({
  FindDuplicatesButton: () => null,
}));
vi.mock("@/components/BreadcrumbComponent", () => ({ default: () => null }));
vi.mock("@/components/tiptap/TipTapEditor", () => ({ default: () => null }));
vi.mock("~/components/ProjectIcon", () => ({ ProjectIcon: () => null }));
vi.mock("@/components/PageFileDropOverlay", () => ({
  PageFileDropOverlay: () => null,
}));
vi.mock("@/components/dnd/UnifiedDragPreview", () => ({
  UnifiedDragPreview: () => null,
}));
vi.mock("@/components/dnd/DragStateBridge", () => ({
  DragStateBridge: () => null,
}));
vi.mock("@/components/dnd/DropZoneOverlay", () => ({
  DropZoneOverlay: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/SimpleDndProvider", () => ({
  SimpleDndProvider: ({ children }: any) => children,
}));
vi.mock("@/components/ui/help-popover", () => ({ HelpPopover: () => null }));
vi.mock("@/components/ui/action-bar", () => ({
  ActionOverflow: () => null,
  useContainerCompact: () => ({ ref: () => {}, compact: false }),
}));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
  ResizablePanel: ({ children }: any) => <div>{children}</div>,
  ResizableHandle: () => null,
}));

// ---- Imports ----

import { keepPreviousData } from "@tanstack/react-query";
import { canonicalPredicateKey } from "~/lib/repository/filterUrlCodec";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import ProjectRepositoryPage from "./ProjectRepository";

// ---- Fixtures / helpers ----

const tagsAny: FilterPredicate = {
  dimension: "tags",
  operator: "any",
  values: [],
};
const templatesIn12: FilterPredicate = {
  dimension: "templates",
  operator: "in",
  values: [1, 2],
};

function setLocation(search: string) {
  Object.defineProperty(window, "location", {
    value: {
      search,
      href: `http://localhost/projects/repository/42${search}`,
    },
    writable: true,
  });
}

const makeViewOptionsData = (overrides: Record<string, any> = {}) => ({
  templates: [{ id: 1, name: "Template 1", count: 3 }],
  states: [{ id: 10, name: "Draft", count: 3 }],
  creators: [{ id: "user-test", name: "Test User", count: 3 }],
  automated: [],
  parameterized: [],
  attachments: [],
  dynamicFields: {
    Description: { fieldId: 12, type: "Text Long" },
  },
  tags: [],
  issues: [],
  totalCount: 3,
  ...overrides,
});

const seedableRunOptions = (assignedTo = [{ id: "user-test", count: 2 }]) =>
  makeViewOptionsData({
    testRunOptions: {
      statuses: [],
      assignedTo,
      untestedCount: 0,
      unassignedCount: 0,
      totalCount: 2,
    },
  });

const lastProps = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0];

const repoElement = (props: Record<string, any> = {}) => (
  <ProjectRepositoryPage
    projectId="42"
    ApplicationArea={"TestCaseRepository" as any}
    {...props}
  />
);

function renderRepo(props: Record<string, any> = {}) {
  const utils = render(repoElement(props));
  return {
    ...utils,
    rerenderRepo: (next: Record<string, any> = props) =>
      utils.rerender(repoElement(next)),
  };
}

/** The single URL written by an axis switch, parsed for assertion. */
function writtenViewUrl() {
  expect(mockRouterReplace).toHaveBeenCalledTimes(1);
  const url = mockRouterReplace.mock.calls[0][0] as string;
  const [path, qs = ""] = url.split("?");
  return { path, params: new URLSearchParams(qs) };
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocation("");
  paramsHolder.current = { projectId: "42" };
  viewOptionsHolder.current = { data: makeViewOptionsData(), isError: false };
  viewOptionsQueryHolder.current = undefined;
  caseFoldersHolder.current = [];
});

// ---- Tests ----

describe("axis switching never touches predicates", () => {
  it("preserves active f params and predicates when switching axes", () => {
    setLocation("?view=folders&node=9&f=tags:any&f=templates:in:1,2");
    renderRepo();

    const before = lastProps(filterBarSpy).predicates;
    expect(before).toEqual([tagsAny, templatesIn12]);

    mockRouterReplace.mockClear();
    act(() => lastProps(viewSelectorSpy).onValueChange("templates"));

    // Exactly one URL write: the ?view= change, with everything else intact.
    const { path, params } = writtenViewUrl();
    expect(path).toBe("/projects/repository/42");
    expect(params.get("view")).toBe("templates");
    expect(params.get("node")).toBe("9");
    expect(params.getAll("f")).toEqual(["tags:any", "templates:in:1,2"]);
    expect(mockRouterPush).not.toHaveBeenCalled();

    // Predicates flowing to the FilterBar and the table are unchanged.
    expect(lastProps(filterBarSpy).predicates).toEqual(before);
    expect(lastProps(casesSpy).predicates).toEqual(before);
    expect(lastProps(viewSelectorSpy).selectedItem).toBe("templates");
  });

  it.each([
    "templates",
    "states",
    "creators",
    "automated",
    "tags",
    "issues",
    "dynamic_12_Text Long",
  ])("does not seed a predicate when switching to %s", (axis) => {
    setLocation("?view=folders");
    renderRepo();

    mockRouterReplace.mockClear();
    act(() => lastProps(viewSelectorSpy).onValueChange(axis));

    const { params } = writtenViewUrl();
    expect(params.get("view")).toBe(axis);
    // The legacy first-option / boolean / has-value seeds are gone: no f
    // params appear in the written URL and the FilterBar stays empty.
    expect(params.getAll("f")).toEqual([]);
    expect(lastProps(filterBarSpy).predicates).toEqual([]);
    expect(lastProps(casesSpy).predicates).toEqual([]);
  });

  it("keeps the folders grouping concern: switching to folders resets the selected folder, not the filters", () => {
    setLocation("?view=templates&node=9&f=tags:any");
    renderRepo();

    mockRouterReplace.mockClear();
    act(() => lastProps(viewSelectorSpy).onValueChange("folders"));

    // Grouping bookkeeping still happens (folder selection cleared)…
    expect(lastProps(treeViewSpy).selectedFolderId).toBeNull();
    // …while the filter predicates survive the switch.
    const { params } = writtenViewUrl();
    expect(params.get("view")).toBe("folders");
    expect(params.getAll("f")).toEqual(["tags:any"]);
    expect(lastProps(filterBarSpy).predicates).toEqual([tagsAny]);
  });
});

describe("?view= gating in selection mode", () => {
  it("never writes ?view= to the host URL from the selection dialog", () => {
    setLocation("?view=folders");
    renderRepo({
      isSelectionMode: true,
      selectedTestCases: [],
      onSelectionChange: vi.fn(),
    });

    act(() => lastProps(viewSelectorSpy).onValueChange("templates"));

    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
    // The grouping change still applies in memory.
    expect(lastProps(viewSelectorSpy).selectedItem).toBe("templates");
  });

  it("keeps selection-mode predicates in memory: URL f params are neither read nor written", () => {
    setLocation("?f=templates:in:1");
    renderRepo({ isSelectionMode: true });

    expect(lastProps(filterBarSpy).predicates).toEqual([]);
    expect(lastProps(casesSpy).predicates).toEqual([]);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

describe("run-mode assigned-to-me seed", () => {
  beforeEach(() => {
    paramsHolder.current = { projectId: "42", runId: "5" };
    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
  });

  it("seeds the assignedTo chip through a normal URL write on a bare visit", async () => {
    setLocation("");
    renderRepo({ isRunMode: true });

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledTimes(1));
    expect(mockRouterReplace).toHaveBeenCalledWith(
      "/projects/repository/42?f=assignedTo:in:user-test",
      { scroll: false }
    );
  });

  it("waits for testRunOptions, decides once, and never re-seeds after a clear", async () => {
    setLocation("");
    viewOptionsHolder.current = { data: makeViewOptionsData(), isError: false };
    const { rerenderRepo } = renderRepo({ isRunMode: true });

    // No decision until testRunOptions resolve.
    expect(mockRouterReplace).not.toHaveBeenCalled();

    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
    rerenderRepo();
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledTimes(1));

    // The router applies the seed…
    setLocation("?f=assignedTo:in:user-test");
    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
    rerenderRepo();
    // …then the user clears the chip (URL back to bare): no re-seed.
    setLocation("");
    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
    rerenderRepo();

    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a parseable f param", "?f=status:in:1"],
    ["an unparseable f param (raw snapshot)", "?f=bogus:in:1"],
  ])("is suppressed when the initial URL carries %s", (_label, search) => {
    setLocation(search);
    renderRepo({ isRunMode: true });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("is suppressed by a ?selectedCase= deep link", () => {
    setLocation("?selectedCase=77");
    renderRepo({ isRunMode: true });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("does not seed when the viewer has no assignments, even if options later include them", () => {
    setLocation("");
    viewOptionsHolder.current = {
      data: seedableRunOptions([{ id: "someone-else", count: 2 }]),
      isError: false,
    };
    const { rerenderRepo } = renderRepo({ isRunMode: true });
    expect(mockRouterReplace).not.toHaveBeenCalled();

    // The decision was already made; later data including me changes nothing.
    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
    rerenderRepo();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("does not seed outside run view mode (repository browsing)", () => {
    paramsHolder.current = { projectId: "42" };
    setLocation("");
    renderRepo({ isRunMode: false });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("does not seed in selection mode and keeps run affordances off", () => {
    setLocation("");
    renderRepo({ isRunMode: true, isSelectionMode: true });

    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(lastProps(filterBarSpy).isRunMode).toBe(false);
    expect(lastProps(filterBarSpy).predicates).toEqual([]);
  });

  it("treats a view-options error as a no-seed decision, permanently", () => {
    setLocation("");
    viewOptionsHolder.current = { data: undefined, isError: true };
    const { rerenderRepo } = renderRepo({ isRunMode: true });
    expect(mockRouterReplace).not.toHaveBeenCalled();

    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
    rerenderRepo();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});

describe("run-mode first-folder auto-select vs shared filter links", () => {
  beforeEach(() => {
    paramsHolder.current = { projectId: "42", runId: "5" };
    viewOptionsHolder.current = { data: seedableRunOptions(), isError: false };
    caseFoldersHolder.current = [{ folderId: 9 }, { folderId: 4 }];
  });

  const renderRunFolders = () =>
    renderRepo({ isRunMode: true, selectedTestCases: [101, 102] });

  it("opens the first folder holding cases on a bare run-mode visit", () => {
    setLocation("?view=folders&selectedCase=101");

    renderRunFolders();

    expect(lastProps(treeViewSpy).selectedFolderId).toBe(9);
  });

  it("stands down when the link already carries f params", () => {
    setLocation("?view=folders&f=tags:any");

    renderRunFolders();

    expect(lastProps(filterBarSpy).predicates).toEqual([tagsAny]);
    expect(lastProps(treeViewSpy).selectedFolderId).toBeNull();
  });

  it("stands down for a compressed fz link too", () => {
    setLocation("?view=folders&fz=whatever");

    renderRunFolders();

    expect(lastProps(treeViewSpy).selectedFolderId).toBeNull();
  });

  it("keeps honouring an explicit ?node= alongside filters", () => {
    setLocation("?view=folders&node=4&f=tags:any");

    renderRunFolders();

    expect(lastProps(treeViewSpy).selectedFolderId).toBe(4);
  });
});

describe("view-options counts wiring", () => {
  const okResponse = (payload: Record<string, unknown> = {}) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("keys the counts query by the canonical predicate key and sends the active predicates", async () => {
    setLocation("?f=tags:any&f=templates:in:1,2");
    renderRepo();

    const options = viewOptionsQueryHolder.current;
    expect(options.queryKey).toContain(
      canonicalPredicateKey([tagsAny, templatesIn12])
    );
    expect(options.staleTime).toBe(30000);
    // Previous counts stay visible (muted) instead of flashing empty while a
    // predicate edit's refetch is in flight.
    expect(options.placeholderData).toBe(keepPreviousData);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse());
    try {
      await options.queryFn();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/repository-cases/view-options");
      expect(JSON.parse(init.body as string).predicates).toEqual([
        tagsAny,
        templatesIn12,
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("intersects search with the filters instead of bypassing them", async () => {
    // A fresh Response per call — bodies are single-read and both the ES
    // search effect and the counts queryFn consume one.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) =>
        Promise.resolve(
          String(url).startsWith("/api/search")
            ? okResponse({ total: 2, hits: [{ source: { id: 7 } }] })
            : okResponse()
        )
      );
    try {
      renderRepo({
        isSelectionMode: true,
        selectedTestCases: [],
        onSelectionChange: vi.fn(),
      });
      act(() => lastProps(filterBarSpy).onAdd(templatesIn12));

      const input = screen.getByTestId("es-search-input");
      await act(async () => {
        fireEvent.change(input, { target: { value: "login" } });
      });

      // The table keeps its real predicates, folder scope and grouping axis;
      // the resolved ids ride alongside as their own prop (spec §9).
      expect(lastProps(casesSpy).predicates).toEqual([templatesIn12]);
      expect(lastProps(casesSpy).searchResultIds).toEqual([7]);
      expect(lastProps(casesSpy).searchKey).toBe("login");
      expect(lastProps(casesSpy).predicatesKey).toBe(
        canonicalPredicateKey([templatesIn12])
      );

      // The counts request carries the same predicates plus the search id
      // snapshot, and the query string (never the id array) marks it in the key.
      const options = viewOptionsQueryHolder.current;
      expect(options.queryKey).toContain(
        canonicalPredicateKey([templatesIn12])
      );
      expect(options.queryKey).toContain("login");
      await options.queryFn();
      const viewOptionsCalls = fetchMock.mock.calls.filter(
        ([url]) => url === "/api/repository-cases/view-options"
      );
      expect(viewOptionsCalls.length).toBeGreaterThan(0);
      const body = JSON.parse(
        (viewOptionsCalls.at(-1)![1] as RequestInit).body as string
      );
      expect(body.predicates).toEqual([templatesIn12]);
      expect(body.searchCaseIds).toEqual([7]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("asks Elasticsearch for an exact total and skips archived cases", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) =>
        Promise.resolve(
          String(url).startsWith("/api/search")
            ? okResponse({ total: 1, hits: [{ source: { id: 7 } }] })
            : okResponse()
        )
      );
    try {
      renderRepo();
      const input = screen.getByTestId("es-search-input");
      await act(async () => {
        fireEvent.change(input, { target: { value: "login" } });
      });

      const searchCall = fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith("/api/search")
      );
      const body = JSON.parse((searchCall![1] as RequestInit).body as string);
      expect(body.filters.repositoryCase.isArchived).toBe(false);
      expect(body.trackTotalHits).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("mirrors the search box into ?q= in view mode only", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(okResponse({ total: 0, hits: [] }))
      );
    try {
      renderRepo();
      await act(async () => {
        fireEvent.change(screen.getByTestId("es-search-input"), {
          target: { value: "login" },
        });
      });
      const written = mockRouterReplace.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("q=login"));
      expect(written.length).toBeGreaterThan(0);

      // Selection mode holds the query in memory — writing it would pollute
      // the host page's URL (spec §10).
      mockRouterReplace.mockClear();
      renderRepo({
        isSelectionMode: true,
        selectedTestCases: [],
        onSelectionChange: vi.fn(),
      });
      await act(async () => {
        fireEvent.change(screen.getAllByTestId("es-search-input").at(-1)!, {
          target: { value: "login" },
        });
      });
      expect(
        mockRouterReplace.mock.calls.filter(([url]) =>
          String(url).includes("q=")
        )
      ).toHaveLength(0);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("reports what an over-cap shared link dropped", () => {
    // 60 predicates > MAX_FILTER_PREDICATES: the hook caps the parse and the
    // FilterBar has to say so rather than silently showing fewer filters.
    setLocation(
      "?" +
        Array.from({ length: 60 }, (_, i) => `f=templates:in:${i + 1}`).join(
          "&"
        )
    );
    renderRepo();
    expect(
      lastProps(filterBarSpy).truncation.predicatesDropped
    ).toBeGreaterThan(0);
  });

  it("seeds the search box from ?q= on load", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(okResponse({ total: 0, hits: [] }))
      );
    try {
      setLocation("?q=checkout");
      await act(async () => {
        renderRepo();
      });
      expect(screen.getByTestId("es-search-input")).toHaveValue("checkout");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("mutes sidebar and chip-editor counts only while placeholder counts are shown", () => {
    setLocation("?f=tags:any");
    viewOptionsHolder.current = {
      data: makeViewOptionsData(),
      isError: false,
      isPlaceholderData: true,
    };
    const { rerenderRepo } = renderRepo();
    expect(lastProps(viewSelectorSpy).countsMuted).toBe(true);
    expect(lastProps(filterBarSpy).countsMuted).toBe(true);

    // Fresh filter-aware counts landed: an active predicate alone no longer
    // mutes anything.
    viewOptionsHolder.current = {
      data: makeViewOptionsData(),
      isError: false,
      isPlaceholderData: false,
    };
    rerenderRepo();
    expect(lastProps(viewSelectorSpy).countsMuted).toBe(false);
    expect(lastProps(filterBarSpy).countsMuted).toBe(false);
  });
});

describe("Elasticsearch failures never fall back to an unfiltered table (spec §9)", () => {
  const okResponse = (payload: Record<string, unknown> = {}) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const failedResponse = () => new Response("boom", { status: 500 });

  const typeSearch = async (text: string) => {
    await act(async () => {
      fireEvent.change(screen.getByTestId("es-search-input"), {
        target: { value: text },
      });
    });
  };

  it("drops the ids, marks the search failed and toasts when the request is not ok", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) =>
        Promise.resolve(
          String(url).startsWith("/api/search")
            ? failedResponse()
            : okResponse()
        )
      );
    try {
      renderRepo();
      await typeSearch("login");

      // The ids are an AND'd filter now: leaving them null while a query is on
      // screen used to render the entire repository as the search result.
      const props = lastProps(casesSpy);
      expect(props.searchFailed).toBe(true);
      expect(props.searchPending).toBe(false);
      expect(props.searchResultIds).toBeNull();
      expect(toastErrorSpy).toHaveBeenCalledWith("common.errors.fetchFailed");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("treats a dropped page mid-paging as a failure, not a truncated id set", async () => {
    let searchCalls = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) => {
        if (!String(url).startsWith("/api/search")) {
          return Promise.resolve(okResponse());
        }
        searchCalls += 1;
        // 1,200 matches = three pages of 500: the first lands, a later one dies.
        return Promise.resolve(
          searchCalls === 1
            ? okResponse({ total: 1200, hits: [{ source: { id: 7 } }] })
            : failedResponse()
        );
      });
    try {
      renderRepo();
      await typeSearch("login");

      expect(searchCalls).toBeGreaterThan(1);
      const props = lastProps(casesSpy);
      expect(props.searchFailed).toBe(true);
      // Publishing page 1 alone would AND a partial set into the where and
      // hide matching cases with no signal at all.
      expect(props.searchResultIds).toBeNull();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("holds the table pending until the ids for a shared ?q= link arrive", async () => {
    let resolveSearch: (response: Response) => void = () => {};
    const pendingSearch = new Promise<Response>((resolve) => {
      resolveSearch = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) =>
        String(url).startsWith("/api/search")
          ? pendingSearch
          : Promise.resolve(okResponse())
      );
    try {
      setLocation("?q=checkout");
      render(repoElement());

      // The first thing a shared link would otherwise show is every case in
      // the repository.
      expect(lastProps(casesSpy).searchPending).toBe(true);
      expect(lastProps(casesSpy).searchFailed).toBe(false);
      expect(lastProps(casesSpy).searchResultIds).toBeNull();
      expect(lastProps(casesSpy).searchText).toBe("checkout");

      await act(async () => {
        resolveSearch(okResponse({ total: 1, hits: [{ source: { id: 7 } }] }));
        await pendingSearch;
      });

      await waitFor(() => {
        expect(lastProps(casesSpy).searchPending).toBe(false);
      });
      expect(lastProps(casesSpy).searchResultIds).toEqual([7]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("mutes the filter-aware counts while the search ids are missing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) =>
        Promise.resolve(
          String(url).startsWith("/api/search")
            ? failedResponse()
            : okResponse()
        )
      );
    try {
      renderRepo();
      await typeSearch("login");

      // The counts intersect the resolved id set; without it they answer a
      // wider question than the table does.
      expect(lastProps(filterBarSpy).countsMuted).toBe(true);
      expect(lastProps(viewSelectorSpy).countsMuted).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("resets pagination to page 1 when the search changes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(okResponse({ total: 0, hits: [] }))
      );
    try {
      renderRepo();
      setCurrentPageSpy.mockClear();

      await typeSearch("login");

      // Searching from page 4 would otherwise strand the user on a page the
      // narrowed result set no longer has.
      expect(setCurrentPageSpy).toHaveBeenCalledWith(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("one owner for this page's URL writes", () => {
  const okResponse = (payload: Record<string, unknown> = {}) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const stubFetch = () =>
    vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(okResponse({ total: 0, hits: [] }))
      );

  const lastWrittenParams = () => {
    const url = String(mockRouterReplace.mock.calls.at(-1)![0]);
    return new URLSearchParams(url.split("?")[1] ?? "");
  };

  it("keeps a just-written param when the search box writes ?q=", async () => {
    const fetchMock = stubFetch();
    try {
      setLocation("?node=5");
      renderRepo();

      // App Router navigations are async: window.location still shows the
      // pre-write URL when the next writer composes.
      act(() => lastProps(viewSelectorSpy).onValueChange("templates"));
      await act(async () => {
        fireEvent.change(screen.getByTestId("es-search-input"), {
          target: { value: "login" },
        });
      });

      const params = lastWrittenParams();
      expect(params.get("q")).toBe("login");
      expect(params.get("view")).toBe("templates");
      expect(params.get("node")).toBe("5");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("applies the readability pass so ?q= does not re-encode the f tokens", async () => {
    const fetchMock = stubFetch();
    try {
      setLocation("?f=templates:in:1,2");
      renderRepo();
      await act(async () => {
        fireEvent.change(screen.getByTestId("es-search-input"), {
          target: { value: "login" },
        });
      });

      const url = String(mockRouterReplace.mock.calls.at(-1)![0]);
      expect(url).toContain("q=login");
      expect(url).toContain("f=templates:in:1,2");
      expect(url).not.toContain("%3A");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("composes the details-panel writes from the live URL, keeping the filters", () => {
    setLocation("?case=9&f=tags:any&node=3");
    renderRepo();

    act(() => lastProps(caseDetailsSpy).onClose());
    const closed = lastWrittenParams();
    expect(closed.get("case")).toBeNull();
    expect(closed.getAll("f")).toEqual(["tags:any"]);
    expect(closed.get("node")).toBe("3");
  });
});
