"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { commitUrlSearch } from "~/lib/urlState";
import BreadcrumbComponent from "@/components/BreadcrumbComponent";
import { useDebounce } from "@/components/Debounce";
import { UnifiedDragPreview } from "@/components/dnd/UnifiedDragPreview";
import { DragStateBridge } from "@/components/dnd/DragStateBridge";
import { DropZoneOverlay } from "@/components/dnd/DropZoneOverlay";
import { PageFileDropOverlay } from "@/components/PageFileDropOverlay";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import {
  ActionOverflow,
  useContainerCompact,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SimpleDndProvider } from "@/components/ui/SimpleDndProvider";
import { DragTargetProvider } from "~/hooks/useDragTargetKind";
import { Toggle } from "@/components/ui/toggle";
import { ViewSelector } from "@/components/ViewSelector";
import { RepositoryFilterBar } from "@/components/repository/filter-bar/RepositoryFilterBar";
import {
  buildFilterDimensions,
  type DynamicFieldDescriptor,
  type FilterDimension,
} from "~/lib/repository/filterDimensions";
import {
  applyReadabilityPass,
  canonicalPredicateKey,
  COMPRESSED_FILTER_PARAM,
  encodeFilterPredicatesForUrl,
  FILTER_PARAM,
} from "~/lib/repository/filterUrlCodec";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import { useRepositoryFilters } from "~/hooks/useRepositoryFilters";
import {
  REPOSITORY_VIEW_STATIC_AXES,
  type SavedRepositoryViewCriteria,
} from "~/lib/schemas/savedRepositoryView";
import { ApplicationArea } from "~/zenstack/models";
import { toast } from "sonner";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Bot,
  Bug,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CircleCheckBig,
  CirclePlus,
  Download,
  FolderDown,
  FolderPlus,
  FolderTree,
  Hash,
  LayoutTemplate,
  Link,
  ListChecks,
  ListOrdered,
  Paperclip,
  Search,
  Sparkles,
  SquareCheckBig,
  SquareStack,
  Tags,
  Type,
  User,
  UserCog,
  Workflow,
  X,
} from "lucide-react";
import { FindDuplicatesButton } from "@/components/duplicates/FindDuplicatesButton";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PanelImperativeHandle } from "react-resizable-panels";
import { emptyEditorContent } from "~/app/constants";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { ProjectIcon } from "~/components/ProjectIcon";
import { usePageFileDrop } from "~/hooks/usePageFileDrop";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";
import { useFolderStats } from "~/lib/useFolderStats";
import { AddCase } from "./AddCase";
import { AddFolder } from "./AddFolder";
import Cases, { type CaseNav } from "./Cases";
import { CaseDetailsPanel } from "@/components/repositories/CaseDetailsPanel";
import { cn } from "~/utils";
import { GenerateTestCasesWizard } from "./GenerateTestCasesWizard";
import { ImportCasesWizard } from "./ImportCasesWizard";
import type { FolderNode } from "./TreeView";
import TreeView from "./TreeView";

// Conditional wrapper to avoid nested DndProviders.
// When skipDndProvider is true, we skip both the DndProvider and UnifiedDragPreview
// since UnifiedDragPreview requires a DnD context to work.
const ConditionalDndWrapper = ({
  skipDndProvider,
  children,
}: {
  skipDndProvider: boolean;
  children: React.ReactNode;
}) => {
  if (skipDndProvider) {
    // Skip DnD entirely - just render children without drag preview
    return <>{children}</>;
  }
  return (
    <DragTargetProvider>
      <SimpleDndProvider>
        <UnifiedDragPreview />
        <DragStateBridge />
        {children}
      </SimpleDndProvider>
    </DragTargetProvider>
  );
};

// Elasticsearch's default index.max_result_window: `from + size` cannot go
// past it, so a client-resolved id set can never cover more than the top
// 10,000 matches (spec §9).
const ES_MAX_RESULT_WINDOW = 10000;

const parseTipTapContent = (content: any) => {
  if (
    !content ||
    (typeof content === "object" && Object.keys(content).length === 0)
  )
    return emptyEditorContent;
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      if (
        parsed &&
        parsed.type === "doc" &&
        parsed.content &&
        parsed.content.length === 1 &&
        parsed.content[0].type === "paragraph" &&
        !parsed.content[0].content
      ) {
        return emptyEditorContent;
      }
      return parsed;
    } catch {
      if (content.trim() !== "") {
        return {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: content }],
            },
          ],
        };
      }
      return emptyEditorContent;
    }
  }
  if (
    typeof content === "object" &&
    content.type === "doc" &&
    content.content &&
    content.content.length === 1 &&
    content.content[0].type === "paragraph" &&
    !content.content[0].content
  ) {
    return emptyEditorContent;
  }
  return content;
};

export interface ProjectRepositoryProps {
  isSelectionMode?: boolean;
  selectedTestCases?: number[];
  selectedRunIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  onConfirm?: (selectedIds: number[]) => void;
  hideHeader?: boolean;
  isRunMode?: boolean;
  onTestCaseClick?: (caseId: number) => void;
  isCompleted?: boolean;
  /** When the run's composition is locked, reordering is frozen — hides the
   * drag handles and disables drag-to-reorder. */
  compositionLocked?: boolean;
  projectId: string;
  ApplicationArea: ApplicationArea;
  selectedTestCaseId?: number | null;
  overridePagination?: {
    currentPage: number;
    setCurrentPage: (page: number) => void;
    pageSize: number;
    setPageSize: (size: number) => void;
    totalItems: number;
    setTotalItems: (total: number) => void;
  };
  /** Skip wrapping with DndProvider when already inside one (e.g., in modals opened from DnD-enabled pages) */
  skipDndProvider?: boolean;
}

interface TestRunCase {
  id: number;
  repositoryCaseId: number;
  order: number;
  statusId: number | null;
  status?: {
    id: number;
    name: string;
    color?: {
      value: string;
    };
  };
  assignedToId: string | null;
  assignedTo?: {
    id: string;
    name: string;
  };
  isCompleted: boolean;
  notes: any;
  startedAt: Date | null;
  completedAt: Date | null;
  elapsed: number | null;
}

interface DynamicField {
  type: string;
  fieldId: number;
  options?: Array<{
    id: number;
    name: string;
    icon?: { name: string } | null;
    iconColor?: { value: string } | null;
    count?: number;
  }>;
  values?: Set<any>;
  counts?: {
    hasValue: number;
    noValue: number;
  };
}

interface ViewOptions {
  templates: Array<{
    id: number;
    name: string;
    count?: number;
  }>;
  states: Array<{
    id: number;
    name: string;
    icon?: { name: string };
    iconColor?: { value: string };
    count?: number;
  }>;
  creators: Array<{
    id: string;
    name: string;
    count?: number;
  }>;
  automated: Array<{
    value: boolean;
    count: number;
  }>;
  parameterized: Array<{
    value: boolean;
    count: number;
  }>;
  attachments: Array<{
    value: boolean;
    count: number;
  }>;
  dynamicFields: Record<string, DynamicField>;
  tags: Array<{
    id: number | string;
    name: string;
    count?: number;
  }>;
  issues: Array<{
    id: number | string;
    name: string;
    count?: number;
  }>;
  testRunOptions?: {
    statuses: Array<{
      id: number;
      name: string;
      color?: { value: string };
      count: number;
    }>;
    assignedTo: Array<{ id: string; name: string; count: number }>;
    untestedCount: number;
    unassignedCount: number;
    totalCount: number;
  };
  /** Count per dimension under all OTHER dimensions' predicates — the base the
   * "All …" rows share with their option rows. Absent on the legacy route. */
  dimensionTotals?: Record<string, number>;
}

interface _ExtendedCases {
  id: number;
  projectId: number;
  project: any;
  creator: any;
  folder: any;
  repositoryId: number;
  folderId: number;
  templateId: number;
  name: string;
  stateId: number;
  estimate: number | null;
  forecastManual: number | null;
  forecastAutomated: number | null;
  order: number;
  createdAt: Date;
  creatorId: string;
  automated: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  currentVersion: number;
  state: {
    id: number;
    name: string;
    icon?: { name: string };
    iconColor?: { value: string };
    color?: { value: string };
  };
  template: {
    id: number;
    templateName: string;
    caseFields: Array<{
      caseField: {
        id: number;
        displayName: string;
        type: {
          type: string;
        };
        fieldOptions: Array<{
          fieldOption: {
            id: number;
            name: string;
            icon?: { name: string };
            iconColor?: { value: string };
          };
        }>;
      };
    }>;
  };
  caseFieldValues: Array<{
    id: number;
    value: any;
    fieldId: number;
    field: {
      id: number;
      displayName: string;
      type: {
        type: string;
      };
    };
  }>;
  testRunStatus?: {
    id: number;
    name: string;
    color?: { value: string };
  };
  testRunStatusId?: number | null;
  assignedToId?: string | null;
  assignedTo?: {
    id: string;
    name: string;
  };
  isCompleted?: boolean;
  notes?: any;
  startedAt?: Date | null;
  completedAt?: Date | null;
  elapsed?: number | null;
  tags: Array<{
    id: number;
    name: string;
  }>;
}

const ProjectRepository: React.FC<ProjectRepositoryProps> = ({
  isSelectionMode = false,
  selectedTestCases = [],
  selectedRunIds,
  onSelectionChange,
  onConfirm,
  hideHeader = false,
  isRunMode = false,
  onTestCaseClick,
  isCompleted = false,
  compositionLocked = false,
  projectId,
  ApplicationArea: _ApplicationArea,
  selectedTestCaseId,
  overridePagination,
  skipDndProvider = false,
}) => {
  const params = useParams();
  const projectIdParam = params.projectId as string;
  const searchParams = useSearchParams();
  const nodeParam = searchParams.get("node");
  const viewParam = searchParams.get("view");

  // Parse and validate projectId early, using the projectId prop
  const numericProjectId = parseInt(projectId, 10);
  const isValidProjectId = !isNaN(numericProjectId);

  const { data: session, status: sessionStatus } = useSession();

  // Use the validated numericProjectId here
  const { permissions: projectPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, "TestCaseRepository");

  // Fetch permissions specifically for Test Runs
  const { permissions: testRunPermissions } = useProjectPermissions(
    numericProjectId,
    "TestRuns"
  );

  const _ALL_VALUES_FILTER = "__ALL__"; // Special value for All Values filter

  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    nodeParam ? parseInt(nodeParam, 10) : null
  );
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [addCaseOpen, setAddCaseOpen] = useState(false);
  const [generateWizardOpen, setGenerateWizardOpen] = useState(false);

  // Collapse the list-pane header actions (Import / Generate / Add Case) into
  // a kebab menu when the pane is narrow, mirroring the other action bars.
  const { ref: listHeaderRef, compact: listHeaderCompact } =
    useContainerCompact();

  const [, setPanelWidth] = useState<number>(100);
  const [folderHierarchy, setFolderHierarchy] = useState<FolderNode[]>([]);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const panelRef = useRef<PanelImperativeHandle>(null);
  const listPanelRef = useRef<PanelImperativeHandle>(null);
  const refetchFoldersRef = useRef<(() => Promise<unknown>) | null>(null);
  // Ref for scoping DnD events when used in portaled contexts (modals)
  const dndContainerRef = useRef<HTMLDivElement>(null);

  // --- Docked case-details panel (Testiny-style) ---------------------------
  // The selected case (`case` URL param) renders as a details panel to the right
  // of the list; on narrow widths (or via the toggle) it takes over full width,
  // collapsing the folder tree + list. Only in plain repository browsing — run
  // mode has its own run-page sheet and selection mode opens the case in a tab.
  const caseParam = searchParams.get("case");
  const selectedCaseId =
    !isRunMode && !isSelectionMode && caseParam ? caseParam : null;
  const [caseNav, setCaseNav] = useState<CaseNav | null>(null);
  const [detailsFullWidth, setDetailsFullWidth] = useState(false);
  const [isNarrowForDetails, setIsNarrowForDetails] = useState(false);
  const collapsedBeforeFullWidthRef = useRef<boolean | null>(null);
  const effectiveFullWidth =
    !!selectedCaseId && (detailsFullWidth || isNarrowForDetails);

  // Persist the full-width preference across sessions.
  useEffect(() => {
    try {
      setDetailsFullWidth(
        window.localStorage.getItem("repository-details-fullwidth") === "1"
      );
    } catch {
      /* ignore private-mode / quota */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "repository-details-fullwidth",
        detailsFullWidth ? "1" : "0"
      );
    } catch {
      /* ignore */
    }
  }, [detailsFullWidth]);

  // Responsive takeover: below a viewport width the panel goes full-width.
  useEffect(() => {
    const check = () => setIsNarrowForDetails(window.innerWidth < 1200);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // When full-width, collapse the folder tree (mirrors the ES-search auto-
  // collapse); restore it to the user's prior state on exit.
  useEffect(() => {
    if (effectiveFullWidth) {
      if (collapsedBeforeFullWidthRef.current === null) {
        collapsedBeforeFullWidthRef.current = isCollapsed;
        if (!isCollapsed && panelRef.current) {
          setIsTransitioning(true);
          panelRef.current.collapse();
          setIsCollapsed(true);
          setTimeout(() => setIsTransitioning(false), 300);
        }
      }
    } else {
      if (collapsedBeforeFullWidthRef.current === false && panelRef.current) {
        setIsTransitioning(true);
        panelRef.current.expand();
        setIsCollapsed(false);
        setTimeout(() => setIsTransitioning(false), 300);
      }
      collapsedBeforeFullWidthRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFullWidth]);

  // Full-width also collapses the list panel (in the nested list|details group)
  // so the details view fills the pane; expand it back on exit. The folder tree
  // collapses separately (effect above). collapse()/expand() preserve a user-
  // dragged split ratio when toggling back.
  useEffect(() => {
    const panel = listPanelRef.current;
    if (!panel) return;
    if (effectiveFullWidth) {
      if (!panel.isCollapsed()) panel.collapse();
    } else if (panel.isCollapsed()) {
      panel.expand();
    }
  }, [effectiveFullWidth]);

  // --- Single owner for this component's URL writes ------------------------
  // App Router navigations are async, so two `router.replace` calls composed
  // from separate `window.location.search` reads each see the pre-write URL
  // and the second silently drops the first's param. Every writer here goes
  // through this helper, which composes from the freshest search string it
  // knows: the value it last wrote, until the router commits it and
  // window.location catches up. `useSearchParams` is deliberately not the
  // source — TreeView writes `node` through raw history.replaceState and the
  // snapshot lags (ColumnSelection documents the same). The codec's
  // readability pass runs on the way out so readable `f` tokens written by
  // useRepositoryFilters are not re-encoded on an unrelated write.
  const pendingUrlWriteRef = useRef<{ from: string; to: string } | null>(null);
  const replaceUrlParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const currentSearch = window.location.search;
      const pending = pendingUrlWriteRef.current;
      const baseSearch =
        pending && pending.from === currentSearch ? pending.to : currentSearch;
      const query = new URLSearchParams(baseSearch);
      const before = query.toString();
      mutate(query);
      const after = query.toString();
      if (after === before) return;
      pendingUrlWriteRef.current = {
        from: currentSearch,
        to: after ? `?${after}` : "",
      };
      const qs = applyReadabilityPass(after);
      // commitUrlSearch instead of router.replace: same-route URL-state sync
      // (see lib/urlState.ts — the router must not be involved, and readers
      // subscribe through useLocationSearch).
      const url = new URL(window.location.href);
      url.search = qs ? `?${qs}` : "";
      commitUrlSearch(url);
    },
    []
  );

  // Once the router commits (window.location moves off the value the overlay
  // was composed against) the overlay is spent. Dropping it keeps a later
  // back-navigation that happens to land on the same URL from replaying it.
  useEffect(() => {
    const pending = pendingUrlWriteRef.current;
    if (pending && window.location.search !== pending.from) {
      pendingUrlWriteRef.current = null;
    }
  }, [searchParams]);

  const closeDetails = useCallback(() => {
    replaceUrlParams((p) => p.delete("case"));
  }, [replaceUrlParams]);

  const goToCase = useCallback(
    (id: number) => {
      replaceUrlParams((p) => p.set("case", String(id)));
    },
    [replaceUrlParams]
  );

  const toggleDetailsFullWidth = useCallback(
    () => setDetailsFullWidth((v) => !v),
    []
  );

  // Folder copy/move state — wired from TreeView context menu to Cases dialog
  const [copyMoveFolderId, setCopyMoveFolderId] = useState<number | null>(null);
  const [copyMoveFolderName, setCopyMoveFolderName] = useState<string>("");

  // "Show all descendants" toggle state
  const [showDescendants, setShowDescendants] = useState(false);

  const handleCopyMoveFolder = useCallback(
    (folderId: number, folderName: string) => {
      setCopyMoveFolderId(folderId);
      setCopyMoveFolderName(folderName);
    },
    []
  );

  const handleCopyMoveFolderDialogClose = useCallback(() => {
    setCopyMoveFolderId(null);
    setCopyMoveFolderName("");
  }, []);

  // Elasticsearch-powered search state. The box exists ONLY in the
  // case-selection dialog, because the app's Unified Search is not reachable
  // from inside that dialog. The repository view is covered by Unified Search
  // and by the in-table name filter, so a second input there would compete with
  // both. The query text lives in memory only — the dialog never writes to the
  // host page's URL (spec §10).
  //
  // The run page flips between run view and edit (selection) mode on one
  // component instance, so this also guarantees a query typed in edit mode
  // stops filtering after the flip back.
  const isEsSearchAvailable = isSelectionMode;
  const [esSearchQuery, setEsSearchQuery] = useState("");
  const debouncedEsSearchQuery = useDebounce(esSearchQuery, 300);
  const [esSearchResultIds, setEsSearchResultIds] = useState<number[] | null>(
    null
  );
  // The debounced query `esSearchResultIds` was resolved for. Moves in lockstep
  // with the id array, so it identifies that array for React Query keys without
  // hashing 10,000 ids on every render.
  const [esSearchResultsQuery, setEsSearchResultsQuery] = useState("");
  const [_esSearchLoading, setEsSearchLoading] = useState(false);
  const [_esSearchTotal, setEsSearchTotal] = useState<number>(0);
  // True when the match count exceeded the Elasticsearch result window: the id
  // set (and therefore the table and the facet counts) covers only the top
  // ES_MAX_RESULT_WINDOW matches.
  const [esSearchTruncated, setEsSearchTruncated] = useState(false);
  // The last resolution attempt failed (non-ok response, a rejected page fetch
  // mid-paging, or a throw). The ids are a hard AND'd filter now, so a failure
  // must NOT leave the table rendering the whole repository as if the search
  // matched everything (spec §9: no silent fallback to unfiltered).
  const [esSearchFailed, setEsSearchFailed] = useState(false);
  // What the table and the counts actually intersect with. Null wherever the
  // search box isn't offered, so a query held over from edit mode can't filter
  // the run view (or silently disable its drag-reorder).
  const activeSearchResultIds = isEsSearchAvailable ? esSearchResultIds : null;
  const activeSearchKey = isEsSearchAvailable ? esSearchResultsQuery : "";
  // The text the table is scoped to, resolved or not. It is the search half of
  // the "current view" identity: pagination, the bulk selection and any
  // in-flight select-all belong to a (folder, axis, predicates, search) tuple,
  // and a change to any of them invalidates the others.
  const activeSearchText = isEsSearchAvailable ? esSearchQuery.trim() : "";
  const searchFailed = isEsSearchAvailable && esSearchFailed;
  // A query is on screen but its id set is not usable yet. The table must show
  // loading rather than the unfiltered list — the dialog would otherwise offer
  // every case in the repository for selection while the search resolves.
  const searchPending =
    activeSearchText.length > 0 &&
    !searchFailed &&
    (activeSearchResultIds === null || activeSearchKey !== activeSearchText);

  const t = useTranslations();
  const locale = useLocale();
  // The search effect toasts on failure but must not re-run (and re-issue the
  // search) just because the translator's identity changed.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Sync URL parameter to state when it changes
  // Only depends on nodeParam to avoid feedback loops
  useEffect(() => {
    const newFolderId = nodeParam ? parseInt(nodeParam, 10) : null;
    setSelectedFolderId(newFolderId);
  }, [nodeParam]);

  const { data: project, isLoading: isProjectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: {
        AND: [
          {
            isDeleted: false,
          },
          { id: numericProjectId },
        ],
      },
    },
    { enabled: isValidProjectId && sessionStatus !== "loading" } // Only query when project ID is valid and session is loaded
  );

  const { data: repository, isLoading: isRepositoryLoading } = useClientQueries(
    schema
  ).repositories.useFindFirst(
    {
      where: {
        AND: [
          {
            isDeleted: false,
            isActive: true,
            isArchived: false,
          },
          { projectId: numericProjectId },
        ],
      },
    },
    { enabled: isValidProjectId }
  );

  // Whether the project has an active AI model integration. The Generate Test
  // Cases wizard requires one — without it the wizard renders nothing — so the
  // toolbar button is gated on this to avoid a button that does nothing.
  const { data: activeLlmIntegrations } = useClientQueries(
    schema
  ).projectLlmIntegration.useFindMany(
    {
      where: { projectId: numericProjectId, isActive: true },
      select: { id: true },
      take: 1,
    },
    { enabled: isValidProjectId }
  );
  const hasActiveLlm =
    !!activeLlmIntegrations && activeLlmIntegrations.length > 0;

  // Multi-dimension filter state (FilterBar chips). Run dims only exist in run
  // view mode; selection mode keeps predicates in memory so the dialog never
  // pollutes the host page's URL (spec §10).
  //
  // The registry's dynamic-field dimensions come from the view-options
  // response, but the view-options request carries the predicates parsed
  // against that registry — a data cycle. It is broken with a render-time
  // mirror of the last response's dynamicFields: the first render parses URL
  // predicates against the static dimensions only, and the response's arrival
  // re-renders with the full registry (dynamic-field predicates resolve then).
  const includeRunDimensions = isRunMode && !isSelectionMode;
  const persistFiltersToUrl = !isSelectionMode;
  const [mirroredDynamicFields, setMirroredDynamicFields] = useState<{
    signature: string;
    fields?: Record<string, DynamicFieldDescriptor>;
  }>({ signature: "" });
  const filterRegistry = useMemo(
    () =>
      buildFilterDimensions({
        dynamicFields: mirroredDynamicFields.fields,
        includeRunDimensions,
      }),
    [mirroredDynamicFields.fields, includeRunDimensions]
  );

  const {
    predicates,
    setPredicates,
    addPredicate,
    updatePredicate,
    removePredicate,
    clearPredicates,
    canonicalKey,
    truncation: filterTruncation,
  } = useRepositoryFilters({
    registry: filterRegistry,
    persistToUrl: persistFiltersToUrl,
  });

  // Counts are computed under the predicates the TABLE is actually using, and
  // under the same search id snapshot (spec §8/§9): search is cross-cutting —
  // every dimension's counts respect it, and it never self-excludes.
  //
  // The key carries `esSearchResultsQuery`, not the id array: it changes exactly
  // when the ids do, so a cache entry can never hold counts computed from a
  // different id set than the key implies.
  const searchCaseIdsForCounts = activeSearchResultIds ?? undefined;

  // Fetch aggregated view options for filters (lightweight query)
  const {
    data: viewOptionsData,
    isError: viewOptionsIsError,
    isPlaceholderData: viewOptionsIsPlaceholder,
  } = useQuery({
    queryKey: [
      "viewOptions",
      numericProjectId,
      isRunMode,
      selectedTestCases,
      params.runId,
      selectedRunIds,
      canonicalKey,
      activeSearchKey,
    ],
    queryFn: async () => {
      const response = await fetch("/api/repository-cases/view-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: numericProjectId,
          isRunMode,
          selectedTestCases: isRunMode ? selectedTestCases : undefined,
          runId: isRunMode && params.runId ? Number(params.runId) : undefined,
          runIds: isRunMode && selectedRunIds ? selectedRunIds : undefined,
          predicates,
          searchCaseIds: searchCaseIdsForCounts,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch view options");
      }

      return response.json();
    },
    enabled: isValidProjectId && sessionStatus !== "loading",
    staleTime: 30000, // Cache for 30 seconds
    // Predicate edits re-key the query; keep the previous counts visible
    // (muted via countsMuted) instead of flashing empty during the refetch.
    placeholderData: keepPreviousData,
  });

  // Mirror on the field SET, not the payload's identity: every chip edit
  // re-keys the counts query, so a fresh object arrives on each refetch even
  // when the fields are unchanged. Comparing by reference rebuilt the registry
  // (and remounted the open dimension picker) on every filter change, which
  // dropped clicks mid-interaction.
  const dynamicFieldSignature = useMemo(() => {
    const fields = viewOptionsData?.dynamicFields as
      Record<string, DynamicFieldDescriptor> | undefined;
    if (!fields) return "";
    return Object.values(fields)
      .map((field) => `${field.fieldId}:${field.type}`)
      .sort()
      .join("|");
  }, [viewOptionsData?.dynamicFields]);
  if (
    dynamicFieldSignature &&
    dynamicFieldSignature !== mirroredDynamicFields.signature
  ) {
    // Render-time state adjustment (not an effect) so the full registry is
    // committed in the same pass the response lands.
    setMirroredDynamicFields({
      signature: dynamicFieldSignature,
      fields: viewOptionsData.dynamicFields,
    });
  }

  // Run-mode "assigned to me" auto-seed (spec §10). The snapshot must be taken
  // from the initial URL at mount — before TestCasesSection auto-writes
  // `selectedCase` for the first case, and immune to later chip adds.
  // `selectedCase` deep-links (result-history, prev/next) suppress the seed so
  // it can't filter the linked case out from under the runner sheet.
  const initialUrlRef = useRef<{
    hadZeroFParams: boolean;
    hadSelectedCase: boolean;
  } | null>(null);
  if (initialUrlRef.current === null) {
    initialUrlRef.current = {
      // Both URL forms count as "carries filters": the compressed `fz` param
      // replaces the readable `f` set above the URL budget.
      hadZeroFParams:
        searchParams.getAll("f").length === 0 && !searchParams.get("fz"),
      hadSelectedCase: searchParams.get("selectedCase") !== null,
    };
  }
  const seedDecidedRef = useRef(false);
  const sessionUserId = session?.user?.id;
  useEffect(() => {
    if (seedDecidedRef.current) return;
    if (viewOptionsIsError) {
      // Query error => decision = no-seed.
      seedDecidedRef.current = true;
      return;
    }
    const runOptions = viewOptionsData?.testRunOptions;
    if (!runOptions) return;
    // Decide exactly once, on the first render where testRunOptions resolved.
    // The ref is set on decision (not seed success) so there is no retry loop,
    // and it survives the run page's edit<->view flip (single instance).
    seedDecidedRef.current = true;
    if (!isRunMode || isSelectionMode) return;
    if (!sessionUserId) return;
    if (!initialUrlRef.current?.hadZeroFParams) return;
    if (initialUrlRef.current.hadSelectedCase) return;
    if (predicates.length !== 0) return;
    if (
      !runOptions.assignedTo?.some(
        (user: { id: string }) => user.id === sessionUserId
      )
    ) {
      return;
    }
    setPredicates([
      { dimension: "assignedTo", operator: "in", values: [sessionUserId] },
    ]);
  }, [
    viewOptionsIsError,
    viewOptionsData,
    isRunMode,
    isSelectionMode,
    sessionUserId,
    predicates,
    setPredicates,
  ]);

  // Fetch folder statistics to optimize queries
  const { data: folderStatsData, refetch: refetchFolderStats } = useFolderStats(
    {
      projectId: numericProjectId,
      enabled: isValidProjectId,
    }
  );

  // Listen for repository cases changes (e.g., after import or bulk delete) to refresh folder stats
  useEffect(() => {
    const handleRepositoryCasesChanged = () => {
      void refetchFolderStats();
      // Also refetch the folder tree — imports may create new subfolders
      void refetchFoldersRef.current?.();
    };

    window.addEventListener(
      "repositoryCasesChanged",
      handleRepositoryCasesChanged as EventListener
    );
    return () => {
      window.removeEventListener(
        "repositoryCasesChanged",
        handleRepositoryCasesChanged as EventListener
      );
    };
  }, [refetchFolderStats]);

  // Get the total case count for the selected folder
  const selectedFolderCaseCount = useMemo(() => {
    if (!selectedFolderId || !folderStatsData) return null;
    const stats = folderStatsData.find((s) => s.folderId === selectedFolderId);
    return stats?.totalCaseCount ?? null;
  }, [selectedFolderId, folderStatsData]);

  // Get the name of the selected folder
  const selectedFolderName = useMemo(() => {
    if (!selectedFolderId || folderHierarchy.length === 0) return null;
    const folder = folderHierarchy.find((f) => f.id === selectedFolderId);
    return folder?.text ?? null;
  }, [selectedFolderId, folderHierarchy]);

  // Compute descendant folder IDs when showDescendants is active
  const descendantFolderIds = useMemo(() => {
    if (!showDescendants || !selectedFolderId || folderHierarchy.length === 0)
      return null;
    const ids: number[] = [selectedFolderId];
    const queue = [selectedFolderId];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const folder of folderHierarchy) {
        if (folder.parent === parentId) {
          ids.push(folder.id);
          queue.push(folder.id);
        }
      }
    }
    return ids;
  }, [showDescendants, selectedFolderId, folderHierarchy]);

  // Build folder path map for displaying relative paths when showDescendants is active
  const folderPathMap = useMemo(() => {
    if (!showDescendants || !selectedFolderId || folderHierarchy.length === 0)
      return null;
    const map = new Map<number, string>();
    const folderById = new Map(folderHierarchy.map((f) => [f.id, f]));

    const buildPath = (folderId: number): string => {
      const parts: string[] = [];
      let currentId: number | null = folderId;
      while (currentId !== null && currentId !== selectedFolderId) {
        const folder = folderById.get(currentId);
        if (!folder) break;
        parts.unshift(folder.text);
        currentId = typeof folder.parent === "number" ? folder.parent : null;
      }
      // Prepend the selected folder name
      const selectedFolder = folderById.get(selectedFolderId);
      if (selectedFolder) parts.unshift(selectedFolder.text);
      return parts.join(" › ");
    };

    for (const folder of folderHierarchy) {
      map.set(folder.id, buildPath(folder.id));
    }
    return map;
  }, [showDescendants, selectedFolderId, folderHierarchy]);

  const { data: testRunCasesWithLoading } = useClientQueries(
    schema
  ).testRunCases.useFindMany(
    {
      where: {
        testRunId: Number(params.runId),
        isDeleted: false,
      },
      select: {
        id: true,
        repositoryCaseId: true,
        order: true,
        statusId: true,
        status: {
          select: {
            id: true,
            name: true,
            color: {
              select: {
                value: true,
              },
            },
          },
        },
        assignedToId: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
        isCompleted: true,
        notes: true,
        startedAt: true,
        completedAt: true,
        elapsed: true,
      },
    },
    {
      enabled:
        isRunMode &&
        !!session?.user &&
        !!params.runId &&
        !isNaN(Number(params.runId)),
      refetchOnWindowFocus: true,
    }
  );
  const _testRunCases = testRunCasesWithLoading as TestRunCase[] | undefined;

  const { data: caseFoldersWithLoading } = useClientQueries(
    schema
  ).repositoryCases.useFindMany(
    {
      where: {
        AND: [
          { isDeleted: false, isArchived: false },
          { projectId: numericProjectId },
          { id: { in: selectedTestCases } },
          { folder: { isDeleted: false } },
        ],
      },
      select: {
        folderId: true,
      },
    },
    {
      enabled: isValidProjectId && isRunMode && selectedTestCases.length > 0,
    }
  );
  const caseFolders = caseFoldersWithLoading;

  const folderIdsWithTestCases = useMemo(() => {
    if (!caseFolders) return [];
    const folderIds = caseFolders.map((item) => item.folderId);
    return [...new Set(folderIds)];
  }, [caseFolders]);

  const handleSelectFolder = useCallback(
    (folderId: number | null) => {
      if (isRunMode && folderId !== null) {
        if (!folderIdsWithTestCases.includes(folderId)) {
          setSelectedFolderId(folderId);
          return;
        }
      }

      setSelectedFolderId(folderId);
    },
    [isRunMode, folderIdsWithTestCases]
  );

  const viewOptions = useMemo<ViewOptions>(() => {
    if (!viewOptionsData) {
      return {
        templates: [],
        states: [],
        creators: [],
        automated: [],
        parameterized: [],
        attachments: [],
        dynamicFields: {},
        tags: [],
        issues: [],
      };
    }

    // Transform API response to match ViewOptions interface
    const tagOptions = viewOptionsData.tags.map((tag: any) => ({
      id: tag.id,
      name:
        tag.id === "any"
          ? t("repository.views.anyTag")
          : tag.id === "none"
            ? t("repository.views.noTags")
            : tag.name,
      count: tag.count,
    }));

    // Convert dynamic fields to the expected format
    const dynamicFields: Record<string, DynamicField> = {};
    Object.entries(viewOptionsData.dynamicFields).forEach(
      ([key, field]: [string, any]) => {
        dynamicFields[key] = {
          type: field.type,
          fieldId: field.fieldId,
          options: field.options,
          values:
            field.values && Array.isArray(field.values)
              ? new Set(field.values)
              : new Set(),
          counts: field.counts,
        };
      }
    );

    // Transform API response for issues
    const issueOptions = (viewOptionsData.issues || []).map((issue: any) => ({
      id: issue.id,
      name:
        issue.id === "any"
          ? t("repository.views.anyIssue")
          : issue.id === "none"
            ? t("repository.views.noIssues")
            : issue.name,
      count: issue.count,
    }));

    return {
      templates: viewOptionsData.templates,
      states: viewOptionsData.states,
      creators: viewOptionsData.creators,
      automated: viewOptionsData.automated || [],
      parameterized: viewOptionsData.parameterized || [],
      attachments: viewOptionsData.attachments || [],
      dynamicFields,
      tags: tagOptions,
      issues: issueOptions,
      testRunOptions: viewOptionsData.testRunOptions,
      // Per-dimension self-excluded totals: the "All …" rows must share a base
      // with the option rows beneath them, or they render smaller than their
      // own options once a filter is active.
      dimensionTotals: viewOptionsData.dimensionTotals,
    };
  }, [viewOptionsData, t]);

  const viewItems = useMemo(() => {
    const baseItems = [
      {
        id: "folders",
        name: t("repository.folders"),
        icon: FolderTree,
      },
      {
        id: "templates",
        name: t("common.fields.template"),
        icon: LayoutTemplate,
      },
      {
        id: "states",
        name: t("common.fields.state"),
        icon: Workflow,
      },
      {
        id: "creators",
        name: t("reports.dimensions.creator"),
        icon: User,
      },
      {
        id: "automated",
        name: t("repository.views.byAutomation"),
        icon: Bot,
      },
      {
        id: "parameterized",
        name: t("repository.views.byParameterized"),
        icon: SquareStack,
      },
      {
        id: "attachments",
        name: t("repository.views.byAttachments"),
        icon: Paperclip,
      },
      // Always include Tags view
      {
        id: "tags",
        name: t("repository.views.byTag"),
        icon: Tags,
        options: viewOptions.tags.map((tag) => ({ ...tag })), // Populate options from viewOptions
      },
    ];

    // Only include Issues view if there are cases with issues
    const casesWithIssues = viewOptions.issues.find((i) => i.id === "any");
    const issuesViewItem =
      casesWithIssues && casesWithIssues.count && casesWithIssues.count > 0
        ? [
            {
              id: "issues",
              name: t("repository.views.byIssue"),
              icon: Bug,
              options: viewOptions.issues.map((issue) => ({ ...issue })),
            },
          ]
        : [];

    const runModeItems = [
      {
        id: "assignedTo",
        name: t("common.fields.assignedTo"),
        icon: UserCog,
        options: [
          {
            id: "unassigned",
            name: t("common.labels.unassigned"),
            count: viewOptionsData?.testRunOptions?.unassignedCount || 0,
          },
          ...(viewOptionsData?.testRunOptions?.assignedTo || []).sort(
            (a: any, b: any) => a.name.localeCompare(b.name)
          ),
        ],
      },
      {
        id: "status",
        name: t("common.actions.status"),
        icon: CircleCheckBig,
        options: [
          {
            id: "untested",
            name: t("common.labels.untested"),
            count: viewOptionsData?.testRunOptions?.untestedCount || 0,
          },
          ...(viewOptionsData?.testRunOptions?.statuses || []),
        ],
      },
    ];

    const dynamicFields = Object.entries(viewOptions.dynamicFields)
      .filter(
        ([_, field]: [string, DynamicField]) =>
          field.type === "Dropdown" ||
          field.type === "Multi-Select" ||
          field.type === "Link" ||
          field.type === "Steps" ||
          field.type === "Checkbox" ||
          field.type === "Integer" ||
          field.type === "Number" ||
          field.type === "Date" ||
          field.type === "Text Long" ||
          field.type === "Text String"
      )
      .map(([displayName, field]: [string, DynamicField]) => ({
        id: `dynamic_${field.fieldId}_${field.type}`,
        name: displayName,
        icon:
          field.type === "Dropdown"
            ? ChevronsUpDown
            : field.type === "Multi-Select"
              ? ListChecks
              : field.type === "Link"
                ? Link
                : field.type === "Steps"
                  ? ListOrdered
                  : field.type === "Checkbox"
                    ? SquareCheckBig
                    : field.type === "Integer" || field.type === "Number"
                      ? Hash
                      : field.type === "Date"
                        ? Calendar
                        : Type,
        field,
      }));

    // Alphabetical by the translated name so the axis list scans in one pass in
    // every locale; "Folders" stays pinned first as the structural default view
    // rather than sorting into the F's.
    const collator = new Intl.Collator(locale, {
      sensitivity: "base",
      numeric: true,
    });
    const sortByName = <T extends { id: string; name: string }>(items: T[]) => {
      const folders = items.filter((item) => item.id === "folders");
      const rest = items
        .filter((item) => item.id !== "folders")
        .sort((a, b) => collator.compare(a.name, b.name));
      return [...folders, ...rest];
    };

    if (isRunMode) {
      // Combine runModeItems (excluding Tags) with baseItems and dynamicFields
      const runModeBaseItems = runModeItems.filter(
        (item) => item.id !== "tags"
      );
      return sortByName([
        ...runModeBaseItems,
        ...baseItems,
        ...issuesViewItem,
        ...dynamicFields,
      ]);
    }

    // For non-run mode, just return baseItems (which now includes Tags), Issues, and dynamicFields
    return sortByName([...baseItems, ...issuesViewItem, ...dynamicFields]);
  }, [
    locale,
    viewOptions.dynamicFields,
    t,
    isRunMode,
    viewOptionsData,
    viewOptions.tags,
    viewOptions.issues,
  ]);

  const [selectedItem, setSelectedItem] = useState<string>(() => {
    const validViewTypes = [
      "folders",
      "templates",
      "states",
      "creators",
      "automated",
      "parameterized",
      "attachments",
      "status",
      "assignedTo",
      "tags",
      "issues",
    ];

    if (viewParam) {
      if (validViewTypes.includes(viewParam)) {
        return viewParam;
      }

      if (viewParam.startsWith("dynamic_")) {
        const [_, fieldKey] = viewParam.split("_");
        const [fieldId, _fieldType] = fieldKey.split("_");
        const numericFieldId = parseInt(fieldId);
        const field = Object.values(viewOptions?.dynamicFields || {}).find(
          (f) => f.fieldId === numericFieldId
        );
        if (field) {
          return viewParam;
        }
      }
    }

    if (isRunMode) {
      return "assignedTo";
    }

    return "folders";
  });

  // Sync selectedItem state when URL's view parameter changes (e.g., from folder link click)
  // Use a ref to track the previous viewParam to avoid infinite loops
  const prevViewParamRef = useRef(viewParam);
  useEffect(() => {
    // Run when viewParam changes OR when viewOptions loads and we have a dynamic field that needs syncing
    const shouldSync =
      viewParam &&
      (viewParam !== prevViewParamRef.current ||
        (viewParam.startsWith("dynamic_") &&
          viewOptions &&
          selectedItem !== viewParam));

    if (shouldSync) {
      prevViewParamRef.current = viewParam;

      const validViewTypes = [
        "folders",
        "templates",
        "states",
        "creators",
        "automated",
        "parameterized",
        "attachments",
        "status",
        "assignedTo",
        "tags",
        "issues",
      ];

      if (validViewTypes.includes(viewParam)) {
        setSelectedItem(viewParam);
      } else if (viewParam.startsWith("dynamic_") && viewOptions) {
        const [_, fieldKey] = viewParam.split("_");
        const [fieldId, _fieldType] = fieldKey.split("_");
        const numericFieldId = parseInt(fieldId);
        const field = Object.values(viewOptions.dynamicFields).find(
          (f) => f.fieldId === numericFieldId
        );
        if (field) {
          setSelectedItem(viewParam);
        }
      }
    }
  }, [viewParam, viewOptions, selectedItem]);

  const deferredFolderId = useDeferredValue(selectedFolderId);

  const handleHierarchyChange = useCallback((hierarchy: FolderNode[]) => {
    setFolderHierarchy(hierarchy);
  }, []);

  const handleRefetchFolders = useCallback(
    (refetch: () => Promise<unknown>) => {
      refetchFoldersRef.current = refetch;
    },
    []
  );

  const getBreadcrumbItems = useMemo(() => {
    if (!deferredFolderId || folderHierarchy.length === 0) return [];
    const breadcrumbs = [];
    let currentFolder = folderHierarchy.find(
      (folder) => folder.id === deferredFolderId
    );
    while (currentFolder) {
      breadcrumbs.unshift(currentFolder);
      currentFolder = folderHierarchy.find(
        (folder) => folder.id === currentFolder?.parent
      );
    }
    return breadcrumbs;
  }, [deferredFolderId, folderHierarchy]);

  const handleBreadcrumbClick = useCallback(
    (folderId: number) => {
      handleSelectFolder(folderId);
    },
    [handleSelectFolder]
  );

  // Elasticsearch search effect - search for test cases in this project.
  // Fetches all matching IDs by paginating through ES results.
  // IDs are passed to Cases which uses a POST-based fetch (not ZenStack GET hooks)
  // to avoid URL length limits, and to the view-options counts route.
  //
  // Failure is a hard state, never a fallback: the ids AND into the table's
  // where, so publishing a partial set (or leaving the previous/null set in
  // place) would show cases the search excludes. Any non-ok response, any
  // rejected page fetch and any throw drop the whole attempt, raise
  // `esSearchFailed` and toast (spec §9).
  const trimmedSearchQuery = debouncedEsSearchQuery.trim();
  useEffect(() => {
    if (!trimmedSearchQuery) {
      setEsSearchResultIds(null);
      setEsSearchResultsQuery("");
      setEsSearchTotal(0);
      setEsSearchTruncated(false);
      setEsSearchFailed(false);
      return;
    }

    let cancelled = false;
    const PAGE_SIZE = 500;
    // `from + size` can never exceed index.max_result_window (10,000 by
    // default), so the id set tops out there. Requesting past it is a hard ES
    // error, hence the clamp; the overflow is surfaced as a banner instead of
    // being dropped silently. search_after/PIT streaming is the documented
    // follow-up for lifting the ceiling.
    const MAX_PAGES = Math.ceil(ES_MAX_RESULT_WINDOW / PAGE_SIZE);
    const searchBody = (page: number) => ({
      filters: {
        query: trimmedSearchQuery,
        entityTypes: ["repository_case"],
        repositoryCase: {
          projectIds: [numericProjectId],
          // Archived cases are never shown in the table, so letting them
          // consume slots in a capped id window only loses real matches.
          isArchived: false,
        },
      },
      pagination: { page, size: PAGE_SIZE },
      highlight: false,
      // Without this the total saturates at 10,000 and truncation is
      // indistinguishable from an exactly-full result set.
      trackTotalHits: true,
    });

    const doSearch = async () => {
      setEsSearchLoading(true);
      try {
        // First page
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(searchBody(1)),
        });

        if (cancelled) return;
        if (!response.ok) {
          throw new Error(`Search request failed: ${response.status}`);
        }

        const data = await response.json();
        const total = data.total as number;
        const allIds: number[] = data.hits.map((hit: any) => hit.source.id);

        // Fetch remaining pages if needed
        const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
        if (totalPages > 1) {
          const remainingPages = Array.from(
            { length: totalPages - 1 },
            (_, i) => i + 2
          );
          const pageResults = await Promise.all(
            remainingPages.map((page) =>
              fetch("/api/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(searchBody(page)),
              }).then((r) => {
                // A dropped page is a partial id set, and a partial set AND'd
                // into the where hides matching cases with no signal at all.
                // Fail the whole resolution instead.
                if (!r.ok) {
                  throw new Error(`Search page ${page} failed: ${r.status}`);
                }
                return r.json();
              })
            )
          );

          if (cancelled) return;

          for (const pageData of pageResults) {
            for (const hit of pageData.hits) {
              allIds.push(hit.source.id);
            }
          }
        }

        setEsSearchResultIds(allIds);
        setEsSearchResultsQuery(trimmedSearchQuery);
        setEsSearchTotal(total);
        setEsSearchTruncated(total > ES_MAX_RESULT_WINDOW);
        setEsSearchFailed(false);
      } catch (err) {
        if (cancelled) return;
        console.error("ES search error:", err);
        // Drop any previously resolved set: it belongs to a different query.
        setEsSearchResultIds(null);
        setEsSearchResultsQuery("");
        setEsSearchTotal(0);
        setEsSearchTruncated(false);
        setEsSearchFailed(true);
        toast.error(tRef.current("common.errors.fetchFailed"));
      } finally {
        if (!cancelled) setEsSearchLoading(false);
      }
    };

    void doSearch();
    return () => {
      cancelled = true;
    };
  }, [trimmedSearchQuery, numericProjectId]);

  // Re-state the filter family from the authoritative predicate array. The
  // FilterBar's writer (useRepositoryFilters) and this component's writers are
  // separate `router.replace` calls, so a `view` write composed from a stale
  // window.location.search can carry a stale `f` set. Re-encoding from
  // `predicates` — which is parsed from the committed URL — makes the filter
  // family correct in whatever this component writes. Held back until the
  // registry's dynamic fields have arrived: before that, dynamic-field
  // predicates are not yet parseable and re-encoding would delete them.
  // Predicates a saved view just applied. `predicates` is parsed from the
  // COMMITTED URL, so between the apply and the router commit it still holds
  // the pre-apply set — re-stating that set would immediately undo the view.
  // Every write from here re-states the applied set until the URL catches up.
  const appliedViewFiltersRef = useRef<{
    key: string;
    predicates: FilterPredicate[];
  } | null>(null);

  const reassertFilterParams = useCallback(
    (query: URLSearchParams) => {
      if (!persistFiltersToUrl || mirroredDynamicFields.fields === undefined)
        return;
      const encoding = encodeFilterPredicatesForUrl(
        appliedViewFiltersRef.current?.predicates ?? predicates
      );
      query.delete(FILTER_PARAM);
      query.delete(COMPRESSED_FILTER_PARAM);
      if (encoding.compressed) {
        query.set(COMPRESSED_FILTER_PARAM, encoding.compressed);
      }
      for (const token of encoding.fParams) {
        query.append(FILTER_PARAM, token);
      }
    },
    [persistFiltersToUrl, mirroredDynamicFields.fields, predicates]
  );

  // The applied set is spent as soon as the committed URL parses back to it.
  useEffect(() => {
    if (appliedViewFiltersRef.current?.key === canonicalKey) {
      appliedViewFiltersRef.current = null;
    }
  }, [canonicalKey]);

  const cancelEsSearch = useCallback(() => {
    setEsSearchQuery("");
    setEsSearchResultIds(null);
    setEsSearchResultsQuery("");
    setEsSearchTotal(0);
    setEsSearchTruncated(false);
    setEsSearchFailed(false);
  }, []);

  const toggleCollapse = () => {
    setIsTransitioning(true);
    if (panelRef.current) {
      if (isCollapsed) {
        panelRef.current.expand();
      } else {
        panelRef.current.collapse();
      }
      setIsCollapsed(!isCollapsed);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  // Axis switching is pure grouping: it never seeds or clears predicates
  // (spec §6). The `?view=` write is gated off in selection mode so the
  // case-selection dialog cannot leak its grouping into the host URL (§10).
  const handleViewChange = useCallback(
    (value: string) => {
      setSelectedItem(value);

      if (value === "folders") {
        handleSelectFolder(null);
      }

      if (!isSelectionMode) {
        // Through the shared writer: a just-written `f` param may not have
        // reached window.location yet and would otherwise be dropped.
        replaceUrlParams((params) => params.set("view", value));
      }
    },
    [replaceUrlParams, handleSelectFolder, isSelectionMode]
  );

  // --- Saved views ---------------------------------------------------------
  // A saved view is the curated twin of the shareable URL: same state, named
  // and reusable. Applying one goes through the SAME setters the FilterBar and
  // the ViewSelector use, so the URL updates and the applied view stays
  // shareable by link. A view whose grouping axis no longer resolves (a
  // deleted dynamic field) falls back to the surface's default rather than
  // grouping by nothing — the menu says what it skipped.
  // The axis this surface groups by when a view does not name one.
  const defaultViewAxis = isRunMode ? "assignedTo" : "folders";

  const resolveSavedViewAxis = useCallback(
    (axis: string | null): string => {
      const fallback = defaultViewAxis;
      if (!axis) return fallback;
      if ((REPOSITORY_VIEW_STATIC_AXES as readonly string[]).includes(axis)) {
        return axis;
      }
      if (axis.startsWith("dynamic_")) {
        const fieldId = parseInt(axis.split("_")[1], 10);
        const exists = Object.values(viewOptions.dynamicFields || {}).some(
          (field) => field.fieldId === fieldId
        );
        return exists ? axis : fallback;
      }
      return fallback;
    },
    [defaultViewAxis, viewOptions.dynamicFields]
  );

  const handleApplySavedView = useCallback(
    (criteria: SavedRepositoryViewCriteria) => {
      const axis = resolveSavedViewAxis(criteria.axis);

      // The FilterBar's own predicate setter — the URL write (or the in-memory
      // set in selection mode) is identical to editing the chips by hand.
      appliedViewFiltersRef.current = {
        key: canonicalPredicateKey(criteria.predicates),
        predicates: criteria.predicates,
      };
      setPredicates(criteria.predicates);

      setSelectedItem(axis);
      if (axis === "folders") {
        handleSelectFolder(null);
      }

      // A view carries no search text, so the selection dialog's box is left
      // as the user typed it and intersects with the filters just applied.
      if (isSelectionMode) return;

      // One composed write for the axis and the freshly applied filter family:
      // `setPredicates` replaced the URL moments ago and window.location has
      // not caught up, so re-stating `f` here is what keeps this write from
      // dropping it.
      replaceUrlParams((query) => {
        query.set("view", axis);
        if (axis === "folders") {
          // The selection was just reset to the root; leaving `node` behind
          // would restore a folder the saved view never described on reload.
          query.delete("node");
        }
        reassertFilterParams(query);
      });
    },
    [
      resolveSavedViewAxis,
      setPredicates,
      handleSelectFolder,
      isSelectionMode,
      replaceUrlParams,
      reassertFilterParams,
    ]
  );

  // --- ViewSelector row-click bridge (spec §6) -----------------------------
  // Rows toggle values in the dimension's `in` predicate (tags/issues: `any`;
  // boolean dims: `is`); the pinned Any/None and has-value/no-value rows
  // toggle the bare `any`/`none` predicate. Row clicks never touch predicates
  // created with other operators.
  const rowClickTarget = useCallback(
    (
      dimension: FilterDimension,
      value: string | number
    ): { operator: string; mode: "bare" | "boolean" | "value" } => {
      if (dimension.valueType === "boolean") {
        return { operator: "is", mode: "boolean" };
      }
      if (
        (value === "any" || value === "none") &&
        dimension.operators.includes(value)
      ) {
        return { operator: value, mode: "bare" };
      }
      return {
        operator: dimension.operators.includes("in") ? "in" : "any",
        mode: "value",
      };
    },
    []
  );

  const isFilterValueActive = useCallback(
    (dimensionKey: string, value: string | number | null) => {
      const dimension = filterRegistry.get(dimensionKey);
      if (!dimension) return false;
      if (value === null) {
        // The "All ..." row: active while the dimension is unfiltered.
        return !predicates.some(
          (predicate) => predicate.dimension === dimensionKey
        );
      }
      const target = rowClickTarget(dimension, value);
      const predicate = predicates.find(
        (candidate) =>
          candidate.dimension === dimensionKey &&
          candidate.operator === target.operator
      );
      if (!predicate) return false;
      if (target.mode === "bare") return predicate.values.length === 0;
      if (target.mode === "boolean") {
        return String(predicate.values[0]) === String(value);
      }
      return predicate.values.some(
        (candidate) => String(candidate) === String(value)
      );
    },
    [filterRegistry, predicates, rowClickTarget]
  );

  const handleToggleFilterValue = useCallback(
    (dimensionKey: string, value: string | number | null) => {
      const dimension = filterRegistry.get(dimensionKey);
      if (!dimension) return;
      if (value === null) {
        // The "All ..." row clears the row-click-reachable predicates for the
        // dimension (`in`/`any`/`is` chips and bare `none`), leaving operator
        // chips built in the FilterBar (e.g. `all`, `between`) untouched.
        const next = predicates.filter((predicate) => {
          if (predicate.dimension !== dimensionKey) return true;
          if (dimension.valueType === "boolean") {
            return predicate.operator !== "is";
          }
          const rowOperator = dimension.operators.includes("in") ? "in" : "any";
          if (predicate.operator === rowOperator) return false;
          return !(
            (predicate.operator === "any" || predicate.operator === "none") &&
            predicate.values.length === 0
          );
        });
        if (next.length !== predicates.length) setPredicates(next);
        return;
      }
      const target = rowClickTarget(dimension, value);
      const existing = predicates.find(
        (candidate) =>
          candidate.dimension === dimensionKey &&
          candidate.operator === target.operator
      );
      if (target.mode === "bare") {
        if (existing && existing.values.length === 0) {
          removePredicate(dimensionKey, target.operator);
        } else {
          addPredicate({
            dimension: dimensionKey,
            operator: target.operator,
            values: [],
          });
        }
        return;
      }
      if (target.mode === "boolean") {
        if (existing && String(existing.values[0]) === String(value)) {
          removePredicate(dimensionKey, "is");
        } else {
          addPredicate({
            dimension: dimensionKey,
            operator: "is",
            values: [typeof value === "number" ? value : Number(value)],
          });
        }
        return;
      }
      if (!existing) {
        addPredicate({
          dimension: dimensionKey,
          operator: target.operator,
          values: [value],
        });
        return;
      }
      const has = existing.values.some(
        (candidate) => String(candidate) === String(value)
      );
      const nextValues = has
        ? existing.values.filter(
            (candidate) => String(candidate) !== String(value)
          )
        : [...existing.values, value];
      if (nextValues.length === 0) {
        // Removing the last row-clicked value removes the chip (spec §6).
        removePredicate(dimensionKey, target.operator);
      } else {
        updatePredicate(dimensionKey, target.operator, {
          ...existing,
          values: nextValues,
        });
      }
    },
    [
      filterRegistry,
      predicates,
      rowClickTarget,
      setPredicates,
      addPredicate,
      updatePredicate,
      removePredicate,
    ]
  );

  // Run mode opens on the first folder that holds cases — but a link that
  // arrives carrying filters is already a project-wide view: active predicates
  // bypass the folder wall (spec §7.1), so auto-selecting a folder here would
  // silently narrow the shared result set. The decision reads the mount-time
  // URL snapshot, not live `predicates`, so it can't flip when the viewer
  // edits chips after load.
  useEffect(() => {
    if (!initialUrlRef.current?.hadZeroFParams) return;
    if (isRunMode && folderIdsWithTestCases.length > 0 && !selectedFolderId) {
      handleSelectFolder(folderIdsWithTestCases[0]);
    }
  }, [isRunMode, folderIdsWithTestCases, selectedFolderId, handleSelectFolder]);

  const isComponentLoading =
    sessionStatus === "loading" ||
    isProjectLoading ||
    isRepositoryLoading ||
    isLoadingPermissions;

  const { currentPage, setCurrentPage, pageSize } = usePagination();

  // Any predicate add/remove/edit resets pagination to page 1 (spec §5),
  // through the override setter when the host owns pagination (spec §10).
  // The search text narrows the same result set, so it resets the page too —
  // otherwise a search run from page 4 lands on a page that no longer exists.
  const overrideSetCurrentPage = overridePagination?.setCurrentPage;
  const effectiveSetCurrentPage = overrideSetCurrentPage ?? setCurrentPage;
  const prevResultSetKeyRef = useRef(`${canonicalKey}|${activeSearchText}`);
  useEffect(() => {
    const resultSetKey = `${canonicalKey}|${activeSearchText}`;
    if (prevResultSetKeyRef.current === resultSetKey) return;
    prevResultSetKeyRef.current = resultSetKey;
    effectiveSetCurrentPage(1);
  }, [canonicalKey, activeSearchText, effectiveSetCurrentPage]);

  // Fetch minimal case position data for auto-paging in run mode
  const { data: casePositions } = useClientQueries(
    schema
  ).testRunCases.useFindMany(
    {
      where: { testRunId: Number(params.runId), isDeleted: false },
      orderBy: { order: "asc" },
      select: { repositoryCaseId: true },
    },
    {
      enabled:
        isRunMode &&
        !!params.runId &&
        !isNaN(Number(params.runId)) &&
        !!selectedTestCaseId,
    }
  );

  // Auto-navigate to page containing the selected test case
  useEffect(() => {
    if (
      casePositions &&
      selectedTestCaseId &&
      typeof pageSize === "number" &&
      pageSize > 0
    ) {
      const index = casePositions.findIndex(
        (c) => c.repositoryCaseId === selectedTestCaseId
      );
      if (index >= 0) {
        const targetPage = Math.floor(index / pageSize) + 1;
        if (targetPage !== currentPage) {
          setCurrentPage(targetPage);
        }
      }
    }
  }, [
    casePositions,
    selectedTestCaseId,
    pageSize,
    currentPage,
    setCurrentPage,
  ]);

  // Drag/drop from desktop to import CSV (hooks must be before early returns)
  const canAddEdit = projectPermissions?.canAddEdit ?? false;
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const tFileDropZone = useTranslations("common.fileDropZone");

  // Keyboard shortcut: Shift+N to open the Add Folder dialog. Lives on the
  // parent page so the modal can be conditionally mounted (approach B).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.shiftKey &&
        e.key === "N" &&
        !addFolderOpen &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        const target = e.target as HTMLElement;
        const isInputElement =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;

        if (!isInputElement) {
          e.preventDefault();
          setAddFolderOpen(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addFolderOpen]);

  const { isDragActive } = usePageFileDrop({
    acceptedExtensions: [".csv"],
    enabled:
      canAddEdit &&
      !isSelectionMode &&
      !isRunMode &&
      !importDialogOpen &&
      !addCaseOpen,
    onDrop: (files) => {
      setDroppedFile(files[0]);
      setImportDialogOpen(true);
    },
    unsupportedMessage: tFileDropZone("unsupportedFileType", {
      expected: ".csv",
    }),
  });

  // Check if user has access to more than 1 project (needed for copy/move visibility)
  // Must be before early returns to satisfy Rules of Hooks
  const { data: projectCount } = useClientQueries(schema).projects.useCount({
    where: { isDeleted: false },
  });
  const showCopyMove = canAddEdit && (projectCount ?? 0) > 1;

  if (isComponentLoading) {
    return null;
  }

  if (!project || !repository) {
    // Show a message instead of blank page
    return (
      <Card>
        <CardContent className="p-8">
          <div className="text-center">
            <p className="text-lg font-semibold mb-2">
              {!project
                ? "Project not found or no access"
                : "Repository not accessible"}
            </p>
            <p className="text-sm text-muted-foreground">
              {!project
                ? `Unable to access project ${numericProjectId}`
                : "The repository for this project could not be loaded. You may not have permission to view it."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;
  const canDelete = projectPermissions?.canDelete ?? false;

  if (session && session.user.access !== "NONE") {
    return (
      <div>
        <PageFileDropOverlay
          isDragActive={isDragActive}
          message={tFileDropZone("dropToImportTestCases")}
          subtitle={tFileDropZone("supportedCsvFormats")}
        />
        <Card className="flex w-full min-w-[400px]">
          <div className="flex-1 w-full">
            {!hideHeader ? (
              <CardHeader>
                <SectionHeader className="flex items-center gap-2">
                  <CardTitle>{t("repository.title")}</CardTitle>
                  <HelpPopover helpKey="projectRepository" />
                </SectionHeader>
                <CardDescription>
                  <span className="flex items-center gap-2">
                    <ProjectIcon iconUrl={project?.iconUrl} />
                    {project?.name}
                  </span>
                </CardDescription>
              </CardHeader>
            ) : (
              <div className="my-4" />
            )}
            <CardContent ref={dndContainerRef}>
              <ConditionalDndWrapper skipDndProvider={skipDndProvider}>
                <ResizablePanelGroup
                  direction="horizontal"
                  autoSaveId="project-repository-panels"
                  data-testid="repository-layout"
                >
                  <ResizablePanel
                    id="repository-left"
                    order={1}
                    ref={panelRef}
                    defaultSize={20}
                    onResize={(size: any) => setPanelWidth(size)}
                    collapsedSize={0}
                    minSize={10}
                    maxSize={70}
                    collapsible
                    onCollapse={() => setIsCollapsed(true)}
                    onExpand={() => setIsCollapsed(false)}
                    className={`p-0 m-0 ${
                      isTransitioning
                        ? "transition-all duration-300 ease-in-out"
                        : ""
                    }`}
                    data-testid="repository-left-panel"
                  >
                    <div className="flex flex-col h-full">
                      <div
                        className="flex items-start justify-between me-2 shrink-0"
                        data-testid="repository-left-panel-header"
                      >
                        <ViewSelector
                          selectedItem={selectedItem}
                          onValueChange={handleViewChange}
                          viewItems={viewItems}
                          isFilterValueActive={isFilterValueActive}
                          onToggleFilterValue={handleToggleFilterValue}
                          isRunMode={isRunMode}
                          viewOptions={viewOptions}
                          totalCount={viewOptionsData?.totalCount || 0}
                          countsMuted={
                            viewOptionsIsPlaceholder ||
                            searchPending ||
                            searchFailed
                          }
                        />
                        <div className="ms-4">
                          {selectedItem === "folders" &&
                            !hideHeader &&
                            canAddEdit && (
                              <>
                                <Button
                                  className="mt-0.5 group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
                                  variant="secondary"
                                  data-testid="add-folder-button"
                                  title={`${t("repository.addFolder")} (Shift+N)`}
                                  onClick={() => setAddFolderOpen(true)}
                                >
                                  <FolderPlus className="w-4 shrink-0" />
                                  <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                                    {t("repository.addFolder")}
                                  </span>
                                </Button>
                                {addFolderOpen && (
                                  <AddFolder
                                    projectId={numericProjectId}
                                    parentId={selectedFolderId}
                                    repositoryId={repository.id}
                                    open={addFolderOpen}
                                    onClose={() => setAddFolderOpen(false)}
                                    onFolderCreated={async (
                                      newFolderId: number,
                                      createdParentId: number | null
                                    ) => {
                                      if (refetchFoldersRef.current) {
                                        // Wait for refetch to complete before selecting the new folder
                                        await refetchFoldersRef.current();
                                      }
                                      // Small delay to ensure tree has re-rendered with new data
                                      setTimeout(() => {
                                        window.dispatchEvent(
                                          new CustomEvent(
                                            "folderSelectionChanged",
                                            {
                                              detail: {
                                                folderId: newFolderId,
                                                expandParentId: createdParentId,
                                              },
                                            }
                                          )
                                        );
                                      }, 50);
                                    }}
                                  />
                                )}
                              </>
                            )}
                        </div>
                      </div>
                      <DropZoneOverlay
                        kind="tree"
                        enabled={selectedItem === "folders"}
                        className="flex-1 mt-4 min-h-10"
                        testId="tree-drop-zone"
                      >
                        {selectedItem === "folders" ? (
                          <TreeView
                            onSelectFolder={handleSelectFolder}
                            onHierarchyChange={handleHierarchyChange}
                            onRefetchFolders={handleRefetchFolders}
                            onRefetchStats={refetchFolderStats}
                            selectedFolderId={selectedFolderId}
                            filteredFolders={
                              isRunMode ? folderIdsWithTestCases : undefined
                            }
                            canAddEdit={canAddEdit}
                            runId={
                              isRunMode && params.runId
                                ? Number(params.runId)
                                : undefined
                            }
                            folderStatsData={folderStatsData}
                            dndRootElement={
                              skipDndProvider
                                ? // eslint-disable-next-line react-hooks/refs
                                  dndContainerRef.current
                                : undefined
                            }
                            onCopyMoveFolder={
                              showCopyMove ? handleCopyMoveFolder : undefined
                            }
                          />
                        ) : null}
                      </DropZoneOverlay>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle className="w-1" />
                  <div className="shrink-0 pt-0.5">
                    <Button
                      type="button"
                      onClick={toggleCollapse}
                      variant="secondary"
                      className="p-0 -ms-1 rounded-s-none"
                    >
                      {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
                    </Button>
                  </div>
                  <ResizablePanel
                    id="repository-right"
                    order={2}
                    defaultSize={80}
                    className="p-0 m-0 min-w-[400px]"
                  >
                    {/* Empty state is now handled by TreeView component */}
                    <ResizablePanelGroup
                      direction="horizontal"
                      autoSaveId="repository-details-split"
                      className="h-full w-full min-w-0"
                    >
                      <ResizablePanel
                        order={1}
                        ref={listPanelRef}
                        collapsible
                        collapsedSize={0}
                        defaultSize={56}
                        minSize={30}
                        className="min-w-0"
                        data-testid="repository-list-pane"
                      >
                        <div
                          ref={listHeaderRef}
                          data-testid="repository-right-panel-header"
                        >
                          <div className="flex items-center justify-between mx-2 pt-0.5 gap-2">
                            <div className="text-primary text-lg md:text-xl font-extrabold shrink-0">
                              <div className="flex items-center space-x-1">
                                <ListChecks className="w-5 h-5 min-w-5 min-h-5" />
                                <div>{t("common.fields.testCases")}</div>
                              </div>
                            </div>
                            {/* Elasticsearch search bar for selection mode —
                                the dialog has no access to Unified Search.
                                Composes with folder scope and filter chips
                                (spec §9) rather than bypassing them. */}
                            {isEsSearchAvailable && (
                              <div className="relative flex-1 max-w-md min-w-0">
                                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                                <Input
                                  type="text"
                                  placeholder={t(
                                    "search.placeholder.thisProject"
                                  )}
                                  value={esSearchQuery}
                                  onChange={(e) =>
                                    setEsSearchQuery(e.target.value)
                                  }
                                  className="ps-10 pe-10 h-8"
                                  data-testid="es-search-input"
                                />
                                {esSearchQuery && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute end-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
                                    onClick={cancelEsSearch}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )}
                            {!isSelectionMode && !isRunMode && canAddEdit && (
                              <div className="flex gap-2 items-center">
                                {importDialogOpen && (
                                  <ImportCasesWizard
                                    onImportComplete={refetchFolderStats}
                                    open={importDialogOpen}
                                    onClose={() => {
                                      setImportDialogOpen(false);
                                      setDroppedFile(null);
                                    }}
                                    initialFile={droppedFile}
                                  />
                                )}
                                {hasActiveLlm && generateWizardOpen && (
                                  <GenerateTestCasesWizard
                                    folderId={selectedFolderId ?? 0}
                                    folderName={selectedFolderName}
                                    onImportComplete={refetchFolderStats}
                                    open={generateWizardOpen}
                                    onOpenChange={setGenerateWizardOpen}
                                  />
                                )}
                                {/* Stateful control (progress bar / results
                                    link) — stays outside the overflow menu. */}
                                <FindDuplicatesButton
                                  projectId={projectIdParam}
                                  disabled={
                                    !folderStatsData ||
                                    folderStatsData.reduce(
                                      (sum, s) => sum + s.totalCaseCount,
                                      0
                                    ) === 0
                                  }
                                />
                                <ActionOverflow
                                  compact={listHeaderCompact}
                                  menuLabel={t("common.actions.actionsLabel")}
                                  menuTestId="repository-actions-menu"
                                  actions={[
                                    {
                                      key: "import",
                                      icon: Download,
                                      label: t(
                                        "repository.cases.importWizard.title"
                                      ),
                                      onClick: () => setImportDialogOpen(true),
                                      testId: "import-cases-button",
                                    },
                                    {
                                      // The wizard requires an active AI model
                                      // integration; without one it renders
                                      // nothing, so the action is gated on the
                                      // same condition to avoid an action that
                                      // does nothing.
                                      key: "generate",
                                      icon: Sparkles,
                                      label: t(
                                        "repository.generateTestCases.buttonText"
                                      ),
                                      onClick: () =>
                                        setGenerateWizardOpen(true),
                                      disabled: folderHierarchy.length === 0,
                                      hidden: !hasActiveLlm,
                                      testId: "generate-cases-button",
                                    },
                                    {
                                      key: "addCase",
                                      icon: CirclePlus,
                                      label: t("repository.cases.addCase"),
                                      onClick: () => setAddCaseOpen(true),
                                      disabled: !selectedFolderId,
                                      variant: "default",
                                      testId: "add-case-button",
                                    },
                                  ]}
                                />
                                {addCaseOpen && (
                                  <AddCase
                                    folderId={selectedFolderId ?? 0}
                                    open={addCaseOpen}
                                    onClose={() => setAddCaseOpen(false)}
                                  />
                                )}
                              </div>
                            )}
                          </div>

                          {/* Search no longer bypasses folder scope, so the
                              breadcrumb and the descendants toggle stay
                              visible while searching (spec §9). */}
                          {selectedItem === "folders" && !isRunMode && (
                            <>
                              <div className="@container flex items-center justify-between mt-2">
                                <BreadcrumbComponent
                                  breadcrumbItems={getBreadcrumbItems}
                                  projectId={projectIdParam}
                                  onClick={handleBreadcrumbClick}
                                  isLastClickable={false}
                                />
                                {selectedFolderId !== null && (
                                  <Toggle
                                    variant="outline"
                                    size="sm"
                                    pressed={showDescendants}
                                    onPressedChange={setShowDescendants}
                                    aria-label={t("repository.showDescendants")}
                                    className="group h-7 gap-0 hover:gap-1 focus-visible:gap-1 @lg:gap-1 text-xs me-2 shrink-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                                  >
                                    <FolderDown className="h-3.5 w-3.5 shrink-0" />
                                    <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-64 group-focus-visible:max-w-64 @lg:max-w-64 select-none">
                                      {t("repository.showDescendants")}
                                    </span>
                                  </Toggle>
                                )}
                              </div>
                              {/* Display Folder Documentation */}
                              {selectedItem === "folders" &&
                                !isRunMode &&
                                selectedFolderId !== null &&
                                (() => {
                                  const selectedFolderNode =
                                    folderHierarchy.find(
                                      (folder) => folder.id === selectedFolderId
                                    );
                                  if (selectedFolderNode?.data?.docs) {
                                    const docsContent = parseTipTapContent(
                                      selectedFolderNode.data.docs
                                    );
                                    const isEmpty = isTiptapEmpty(docsContent);

                                    if (!isEmpty) {
                                      return (
                                        <div className="ms-4 bg-muted rounded-lg">
                                          <TipTapEditor
                                            content={docsContent}
                                            readOnly={true}
                                            projectId={projectIdParam}
                                            className="prose prose-sm max-w-none dark:prose-invert"
                                          />
                                        </div>
                                      );
                                    }
                                  }
                                  return null;
                                })()}
                            </>
                          )}
                        </div>
                        <div className="mx-2 mt-2">
                          <RepositoryFilterBar
                            predicates={predicates}
                            onAdd={addPredicate}
                            onUpdate={updatePredicate}
                            onRemove={removePredicate}
                            onClearAll={clearPredicates}
                            registry={filterRegistry}
                            viewOptions={viewOptions}
                            isRunMode={isRunMode && !isSelectionMode}
                            truncation={filterTruncation}
                            searchTruncated={
                              isEsSearchAvailable && esSearchTruncated
                            }
                            searchWindow={ES_MAX_RESULT_WINDOW}
                            // Counts intersect the resolved search id set; while
                            // that set is missing (still resolving, or failed)
                            // they answer a wider question than the table does.
                            countsMuted={
                              viewOptionsIsPlaceholder ||
                              searchPending ||
                              searchFailed
                            }
                            savedViews={{
                              projectId: numericProjectId,
                              // null = "this surface's default grouping", so a
                              // bare page is correctly nothing worth saving.
                              axis:
                                selectedItem === defaultViewAxis
                                  ? null
                                  : selectedItem,
                              onApply: handleApplySavedView,
                            }}
                          />
                        </div>
                        <DropZoneOverlay
                          kind="reorder"
                          testId="reorder-drop-zone"
                        >
                          {/* Search intersects, it no longer bypasses (spec
                              §9): folder scope, grouping axis and predicates
                              all stay real; the resolved id set rides
                              alongside as searchResultIds. */}
                          <Cases
                            folderId={selectedFolderId}
                            viewType={selectedItem}
                            predicates={predicates}
                            filterRegistry={filterRegistry}
                            predicatesKey={canonicalKey}
                            onClearFilters={clearPredicates}
                            isSelectionMode={isSelectionMode}
                            selectedTestCases={selectedTestCases}
                            selectedRunIds={selectedRunIds}
                            onSelectionChange={onSelectionChange}
                            onConfirm={onConfirm}
                            hideHeader={hideHeader}
                            isRunMode={isRunMode}
                            onTestCaseClick={onTestCaseClick}
                            isCompleted={isCompleted}
                            compositionLocked={compositionLocked}
                            canAddEdit={canAddEdit}
                            canAddEditRun={canAddEditRun}
                            canDelete={canDelete}
                            selectedFolderCaseCount={selectedFolderCaseCount}
                            overridePagination={overridePagination}
                            searchResultIds={activeSearchResultIds}
                            searchKey={activeSearchKey}
                            searchText={activeSearchText}
                            searchPending={searchPending}
                            searchFailed={searchFailed}
                            copyMoveFolderId={copyMoveFolderId}
                            copyMoveFolderName={copyMoveFolderName}
                            onCopyMoveFolderDialogClose={
                              handleCopyMoveFolderDialogClose
                            }
                            descendantFolderIds={descendantFolderIds}
                            showDescendants={showDescendants}
                            folderPathMap={folderPathMap}
                            onCaseNavChange={setCaseNav}
                          />
                        </DropZoneOverlay>
                      </ResizablePanel>
                      {selectedCaseId && (
                        <>
                          <ResizableHandle
                            withHandle
                            id="repository-details-resize-handle"
                            className={cn(effectiveFullWidth && "hidden")}
                          />
                          <ResizablePanel
                            order={2}
                            defaultSize={44}
                            minSize={28}
                            className="h-full min-w-0"
                            data-testid="repository-details-pane"
                          >
                            <CaseDetailsPanel
                              caseId={selectedCaseId}
                              projectId={String(numericProjectId)}
                              fullWidth={effectiveFullWidth}
                              onToggleFullWidth={toggleDetailsFullWidth}
                              onClose={closeDetails}
                              onPrev={() =>
                                caseNav?.prevId != null &&
                                goToCase(caseNav.prevId)
                              }
                              onNext={() =>
                                caseNav?.nextId != null &&
                                goToCase(caseNav.nextId)
                              }
                              hasPrev={!!caseNav?.hasPrev}
                              hasNext={!!caseNav?.hasNext}
                              position={caseNav?.position ?? null}
                              total={caseNav?.total ?? 0}
                            />
                          </ResizablePanel>
                        </>
                      )}
                    </ResizablePanelGroup>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ConditionalDndWrapper>
            </CardContent>
          </div>
        </Card>
      </div>
    );
  }

  return null;
};

export default function ProjectRepositoryPage({
  ...props
}: ProjectRepositoryProps) {
  return (
    <PaginationProvider>
      <ProjectRepository {...props} />
    </PaginationProvider>
  );
}
