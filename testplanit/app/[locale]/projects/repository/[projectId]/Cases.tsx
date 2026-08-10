import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import AddTestRunModal from "@/[locale]/projects/runs/[projectId]/AddTestRunModal";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { Button } from "@/components/ui/button";
import { AutoTagWizardDialog } from "@/components/auto-tag/AutoTagWizardDialog";
import { useDebounce } from "@/components/Debounce";
import {
  PendingReviewBadge,
  type PendingReviewSummary,
} from "@/components/reviews/PendingReviewBadge";
import { SelectedTestCasesDrawer } from "@/components/SelectedTestCasesDrawer";
import {
  ColumnMetadata,
  ColumnSelection,
  CustomColumnDef,
  readStoredColumnSort,
  writeStoredColumnSort,
} from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  ActionOverflow,
  useContainerCompact,
} from "@/components/ui/action-bar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
  RepositoryCasesFindManyArgs,
  RepositoryCasesSelect,
  RepositoryCasesWhereInput,
  TestRunCasesFindManyArgs,
  TestRunCasesSelect,
  TestRunCasesWhereInput,
} from "~/zenstack/input";
import type { Tags as TagModel, Issue as IssueModel } from "~/zenstack/models";

// The repositoryCases/testRunCases query results are typed loosely for the
// list (the select's relations aren't fully reflected), but at runtime they
// carry the explicit-join rows. This documents that known shape so the legacy
// tags/issues arrays can be derived without an `as any`.
type CaseJoinRels = {
  caseTags?: { tag: TagModel }[];
  caseIssues?: { issue: IssueModel }[];
};

// In multi-config run mode the mapped case carries a testRunCaseId; the list
// item union doesn't declare it, so reads use this scoped assertion.
type MaybeRunModeCase = { testRunCaseId?: number };
import {
  RowSelectionState,
  Updater as TableUpdater,
} from "@tanstack/react-table";
import type { FilterDimensionRegistry } from "~/lib/repository/filterDimensions";
import {
  compileRepoPredicates,
  compileRunPredicates,
  extractPostFetchFilters,
} from "~/lib/repository/filterWhereCompiler";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import {
  ArrowRightLeft,
  PenSquare,
  PlayCircle,
  ScrollText,
  Tags,
  Upload,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { fetchAllCasesForExport as fetchAllCasesAction } from "~/app/actions/exportActions";
import { TFunction, useExportData } from "~/hooks/useExportData";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  useRepositoryCasesInvalidation,
  useRepositoryCasesQuery,
} from "~/hooks/useRepositoryCasesQuery";
import type { PostFetchFilter } from "~/hooks/useRepositoryCasesWithFilteredFields";
import { usePagination } from "~/lib/contexts/PaginationContext";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { usePathname, useRouter } from "~/lib/navigation";
import { LatestResultsCell } from "@/components/tables/LatestResultsCell";
import { useLatestTestResults } from "~/hooks/useLatestTestResults";
import { useCaseIdsByLatestStatus } from "~/hooks/useCaseIdsByLatestStatus";
import { useCaseIdsByFieldOption } from "~/hooks/useCaseIdsByFieldOption";
import { LATEST_RESULTS_COUNT } from "~/lib/types/latestTestResults";
import { AddCaseRow } from "./AddCaseRow";
import { AddResultModal } from "./AddResultModal";
import { BulkEditModal } from "./BulkEditModal";
import { CopyMoveDialog } from "@/components/copy-move/CopyMoveDialog";
import { getColumns } from "./columns";
import { ExportModal, ExportOptions } from "./ExportModal";
import { QuickScriptModal } from "./QuickScriptModal";

type PageSizeOption = number | "All";

// Shared select fragments for the repository-case row shape. Both the
// repository list query (REPOSITORY_CASE_LIST_SELECT) and the run-mode
// testRunCases query further down embed these identical fragments so the
// shared column renderers in ./columns receive the same row shape in either
// mode. Keeping them in one place stops the two query paths from silently
// drifting — run mode previously rendered raw field values because its
// caseFieldValues select omitted the nested field.type the renderer keys off.
const CASE_STATE_SELECT = {
  select: {
    id: true,
    name: true,
    workflowType: true,
    icon: {
      select: {
        name: true,
      },
    },
    color: {
      select: {
        value: true,
      },
    },
  },
} as const;

const CASE_TEMPLATE_SELECT = {
  select: {
    id: true,
    templateName: true,
    caseFields: {
      select: {
        caseField: {
          select: {
            id: true,
            defaultValue: true,
            displayName: true,
            type: {
              select: {
                type: true,
              },
            },
            fieldOptions: {
              select: {
                fieldOption: {
                  select: {
                    id: true,
                    icon: true,
                    iconColor: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const CASE_FIELD_VALUES_SELECT = {
  select: {
    id: true,
    value: true,
    fieldId: true,
    field: {
      select: {
        id: true,
        displayName: true,
        type: {
          select: {
            type: true,
          },
        },
      },
    },
  },
  where: { field: { isEnabled: true, isDeleted: false } },
} as const;

const CASE_ATTACHMENTS_SELECT = {
  orderBy: { createdAt: "desc" },
  where: { isDeleted: false },
} as const;

// Kept as a standalone (non-`as const`) array so the OR clause types as a
// mutable WhereInput[]; a readonly tuple produced by `as const` is rejected by
// the generated query-args type.
const STEP_VISIBILITY_OR = [
  { sharedStepGroupId: null },
  { sharedStepGroup: { isDeleted: false } },
];

const CASE_STEPS_SELECT = {
  where: {
    isDeleted: false,
    OR: STEP_VISIBILITY_OR,
  },
  orderBy: { order: "asc" },
  select: {
    id: true,
    order: true,
    step: true,
    expectedResult: true,
    sharedStepGroupId: true,
    sharedStepGroup: {
      select: {
        name: true,
      },
    },
  },
} as const;

const CASE_TAGS_SELECT = {
  where: { tag: { isDeleted: false } },
  include: { tag: true },
} as const;

const CASE_ISSUES_SELECT = {
  where: { issue: { isDeleted: false } },
  include: {
    issue: {
      include: {
        integration: true,
      },
    },
  },
} as const;

// UI sort columns that map 1:1 to a RepositoryCases scalar column. The
// remembered sort (localStorage, per project) can hold ANY column id from
// either the repository or the run view — including UI-computed ones like
// latestResults/forecast and numeric custom-field ids. Both orderBy builders
// pass through only these names; anything else falls back to the default
// order, because one unknown field in orderBy makes the server reject the
// whole findMany and the table renders empty. Columns that can't be an
// orderBy but ARE sortable (latestResults, Dropdown custom fields) order via
// server-resolved page ids instead — see sortedPageIds.
const REPOSITORY_CASE_SORTABLE_SCALARS = new Set([
  "id",
  "name",
  "estimate",
  "stateId",
  "automated",
  "currentVersion",
  "createdAt",
  "order",
  "source",
]);

// Select shape for the repository case list. Module-level so the query key
// never has to hash it — callers name the shape with a short `selectKey`
// instead.
const REPOSITORY_CASE_LIST_SELECT = {
  id: true,
  projectId: true,
  project: true,
  creator: true,
  folder: true,
  repositoryId: true,
  folderId: true,
  templateId: true,
  name: true,
  stateId: true,
  estimate: true,
  forecastManual: true,
  forecastAutomated: true,
  order: true,
  createdAt: true,
  creatorId: true,
  automated: true,
  hasParameters: true,
  isArchived: true,
  isDeleted: true,
  currentVersion: true,
  source: true,
  state: CASE_STATE_SELECT,
  template: CASE_TEMPLATE_SELECT,
  caseFieldValues: CASE_FIELD_VALUES_SELECT,
  attachments: CASE_ATTACHMENTS_SELECT,
  steps: CASE_STEPS_SELECT,
  caseTags: CASE_TAGS_SELECT,
  caseIssues: CASE_ISSUES_SELECT,
  testRuns: {
    select: {
      id: true,
      testRun: {
        select: {
          id: true,
          name: true,
          projectId: true,
          isDeleted: true,
          isCompleted: true,
        },
      },
    },
  },
  linksFrom: {
    select: {
      caseBId: true,
      type: true,
      isDeleted: true,
    },
  },
  linksTo: {
    select: {
      caseAId: true,
      type: true,
      isDeleted: true,
    },
  },
  _count: {
    select: {
      comments: {
        where: {
          isDeleted: false,
        },
      },
    },
  },
} as const satisfies RepositoryCasesSelect;

// Select shape for the run-mode case list (TestRunCases rows with the
// repository case nested under `repositoryCase`). Module-level so the query
// key never has to hash it and so the run list and its id list agree.
const TEST_RUN_CASE_LIST_SELECT = {
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
  // Phase 3 — surface iteration count so the status cell can detect
  // parameterized cases and render its read-only sheet-opener.
  totalIterations: true,
  testRun: {
    select: {
      id: true,
      configuration: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  repositoryCase: {
    select: {
      id: true,
      projectId: true,
      project: true,
      creator: true,
      folder: true,
      repositoryId: true,
      folderId: true,
      templateId: true,
      name: true,
      stateId: true,
      estimate: true,
      forecastManual: true,
      forecastAutomated: true,
      order: true,
      createdAt: true,
      creatorId: true,
      automated: true,
      hasParameters: true,
      isArchived: true,
      isDeleted: true,
      currentVersion: true,
      source: true,
      state: CASE_STATE_SELECT,
      template: CASE_TEMPLATE_SELECT,
      caseFieldValues: CASE_FIELD_VALUES_SELECT,
      attachments: CASE_ATTACHMENTS_SELECT,
      steps: CASE_STEPS_SELECT,
      caseTags: CASE_TAGS_SELECT,
      caseIssues: CASE_ISSUES_SELECT,
      testRuns: {
        select: {
          id: true,
          testRun: {
            select: {
              id: true,
              name: true,
              projectId: true,
              isDeleted: true,
              isCompleted: true,
            },
          },
        },
      },
      linksFrom: {
        select: {
          caseBId: true,
          type: true,
          isDeleted: true,
        },
      },
      linksTo: {
        select: {
          caseAId: true,
          type: true,
          isDeleted: true,
        },
      },
      _count: {
        select: {
          comments: {
            where: {
              isDeleted: false,
            },
          },
        },
      },
    },
  },
} as const satisfies TestRunCasesSelect;

/**
 * Prev/next context for the docked case-details panel. Cases owns the list's
 * filter/sort so it derives the ordered id set and the selected case's position
 * within it; ProjectRepository consumes this to drive the panel's stepper.
 */
export interface CaseNav {
  /** 1-based position of the selected case in the full filtered set, or null. */
  position: number | null;
  /** Total cases in the current filtered result set. */
  total: number;
  prevId: number | null;
  nextId: number | null;
  hasPrev: boolean;
  hasNext: boolean;
}

interface CasesProps {
  folderId: number | null;
  viewType: string;
  /** Active filter predicates (implicit AND). Compiled to where fragments via
   * lib/repository/filterWhereCompiler; folder scoping stays separate. */
  predicates: FilterPredicate[];
  /** The active mode's dimension registry (buildFilterDimensions). */
  filterRegistry: FilterDimensionRegistry;
  /** Canonical serialization of `predicates` (useRepositoryFilters.canonicalKey).
   * Keys every reset effect and remount key that previously keyed on the
   * single-axis filterId. */
  predicatesKey: string;
  /** Clears all active predicates — the zero-result empty state's CTA. */
  onClearFilters?: () => void;
  isSelectionMode?: boolean;
  selectedTestCases?: number[];
  selectedRunIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  onConfirm?: (selectedIds: number[]) => void;
  hideHeader?: boolean;
  isRunMode?: boolean;
  onTestCaseClick?: (caseId: number) => void;
  /** Lifts prev/next context for the selected `?case` up to ProjectRepository,
   * which renders the docked details panel. Null when no case is selected. */
  onCaseNavChange?: (nav: CaseNav | null) => void;
  isCompleted?: boolean;
  /** When the run's composition is locked, reordering is frozen — hides drag
   * handles and disables drag-to-reorder. */
  compositionLocked?: boolean;
  canAddEdit: boolean;
  canAddEditRun: boolean;
  canDelete: boolean;
  selectedFolderCaseCount?: number | null;
  overridePagination?: {
    currentPage: number;
    setCurrentPage: (page: number) => void;
    pageSize: number;
    setPageSize: (size: number) => void;
    totalItems: number;
    setTotalItems: (total: number) => void;
  };
  /** Relevance-ordered id set from Elasticsearch. Intersected with the folder
   * scope, the predicates and the in-table name filter (spec §9) — never a
   * bypass. Null when no search is active; an empty array means the search
   * matched nothing. */
  searchResultIds?: number[] | null;
  /** Identity of `searchResultIds` for query keys — the debounced query string
   * the ids were resolved for, never the array itself. */
  searchKey?: string;
  /** The search text the table is scoped to, resolved or not. Part of the
   * "current view" identity alongside folder/axis/predicates: a change to it
   * invalidates the bulk selection and any in-flight select-all. */
  searchText?: string;
  /** A query is on screen but its id set has not resolved yet. The ids are an
   * AND'd filter, so the list must show loading rather than the unfiltered
   * repository (spec §9). */
  searchPending?: boolean;
  /** The search could not be resolved. Same reasoning as `searchPending`, but
   * terminal: the table shows the error state instead of an unfiltered list. */
  searchFailed?: boolean;
  /** When set, opens CopyMoveDialog in folder mode for the given folder */
  copyMoveFolderId?: number | null;
  copyMoveFolderName?: string;
  onCopyMoveFolderDialogClose?: () => void;
  /** When showDescendants is active, filter cases to these folder IDs (selected + all descendants) */
  descendantFolderIds?: number[] | null;
  /** Whether the "show all descendants" toggle is active */
  showDescendants?: boolean;
  /** Map of folderId to full folder path string, for display when showDescendants is active */
  folderPathMap?: Map<number, string> | null;
}

export default function Cases({
  folderId,
  viewType,
  predicates,
  filterRegistry,
  predicatesKey,
  onClearFilters,
  isSelectionMode = false,
  selectedTestCases = [],
  selectedRunIds,
  onSelectionChange,
  onConfirm: _onConfirm,
  hideHeader = false,
  isRunMode = false,
  onTestCaseClick,
  onCaseNavChange,
  isCompleted = false,
  compositionLocked = false,
  canAddEdit,
  canAddEditRun,
  canDelete,
  selectedFolderCaseCount,
  overridePagination,
  searchResultIds,
  searchKey,
  searchText = "",
  searchPending = false,
  searchFailed = false,
  copyMoveFolderId,
  copyMoveFolderName,
  onCopyMoveFolderDialogClose,
  descendantFolderIds,
  showDescendants = false,
  folderPathMap,
}: CasesProps) {
  const t = useTranslations();

  // Guard to prevent auto-select effect from double-firing (React Strict Mode)
  const hasAutoSelectedRef = useRef(false);

  // Performance logging - use refs to avoid re-renders
  const _performanceLog = useRef({
    componentStart: Date.now(),
    templatesLoaded: null as number | null,
    mainDataLoaded: null as number | null,
    firstRender: null as number | null,
  });

  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams();
  const projectIdParam = params.projectId;
  const isValidProjectId = !!(projectIdParam && !Array.isArray(projectIdParam));
  const projectId = isValidProjectId ? parseInt(projectIdParam) : -1;
  const runId = params?.runId ? Number(params.runId) : undefined;
  const isRunIdValidNumeric = runId !== undefined && !isNaN(runId);

  // The selected case (`case` URL param) is rendered by ProjectRepository as a
  // docked details panel to the right of the list. Cases only needs it to build
  // the prev/next navigation context (see `onCaseNavChange` below). Only in plain
  // repository browsing — run mode has its own run-page sheet, and selection mode
  // opens the case in a new tab.
  const selectedCaseIdParam =
    !isRunMode && !isSelectionMode ? searchParams.get("case") : null;

  // Collapse the pagination controls when the list pane is narrow (e.g. the
  // details panel is open in split mode). Measured via ResizeObserver on the
  // pagination footer so it reflects the actual available width in any context.
  const [paginationCompact, setPaginationCompact] = useState(false);
  const paginationResizeObserverRef = useRef<ResizeObserver | null>(null);
  const setPaginationFooterRef = useCallback((node: HTMLDivElement | null) => {
    paginationResizeObserverRef.current?.disconnect();
    if (node && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        setPaginationCompact(width > 0 && width < 440);
      });
      ro.observe(node);
      paginationResizeObserverRef.current = ro;
    }
  }, []);

  // Collapse the bulk-action buttons into a single kebab menu when the list
  // pane is narrow, mirroring the run/session/milestone header action bars.
  const { ref: casesHeaderRef, compact: casesToolbarCompact } =
    useContainerCompact();

  // Use override pagination if provided (for modal), otherwise use context (for normal page)
  const contextPagination = usePagination();

  const currentPage =
    overridePagination?.currentPage ?? contextPagination.currentPage;
  const setCurrentPage =
    overridePagination?.setCurrentPage ?? contextPagination.setCurrentPage;
  const pageSize = overridePagination?.pageSize ?? contextPagination.pageSize;
  const setPageSize =
    overridePagination?.setPageSize ?? contextPagination.setPageSize;
  const totalItems =
    overridePagination?.totalItems ?? contextPagination.totalItems;
  const setTotalItems =
    overridePagination?.setTotalItems ?? contextPagination.setTotalItems;

  // Calculate derived pagination values
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const startIndex =
    totalItems > 0 ? (currentPage - 1) * effectivePageSize + 1 : 0;
  const endIndex = Math.min(startIndex + effectivePageSize - 1, totalItems);
  const totalPages =
    effectivePageSize > 0 ? Math.ceil(totalItems / effectivePageSize) : 1;

  // Restore a remembered sort (per project, alongside column visibility/order/
  // width). No stored sort means the default order — isDefaultSort stays true.
  const [sortConfig, setSortConfig] = useState<
    { column: string; direction: "asc" | "desc" } | undefined
  >(
    () =>
      readStoredColumnSort(`repository-cases:${projectId}`) ?? {
        column: "order",
        direction: "asc",
      }
  );
  const [isDefaultSort, setIsDefaultSort] = useState(
    () => readStoredColumnSort(`repository-cases:${projectId}`) === null
  );
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const deferredSearchString = useDeferredValue(debouncedSearchString);

  const { mutateAsync: updateRepositoryCases } = useClientQueries(
    schema
  ).repositoryCases.useUpdate({
    optimisticUpdate: false,
  });
  const { mutateAsync: updateTestRunCases } = useClientQueries(
    schema
  ).testRunCases.useUpdate({
    optimisticUpdate: false,
  });
  const [, startTransition] = useTransition();
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<any[]>([]);

  // Add state for modal open
  const [, setIsModalOpen] = useState(false);

  // State for AddResultModal - lifted from StatusCell to prevent re-render issues
  const [addResultModalState, setAddResultModalState] = useState<{
    isOpen: boolean;
    testRunCaseId?: number;
    testRunId?: number;
    caseName?: string;
    projectId?: number;
    defaultStatusId?: string;
    isBulkResult?: boolean;
    selectedCases?: any[];
    steps?: any[];
    configuration?: { id: number; name: string } | null;
  }>({ isOpen: false });

  // State for bulk edit selection
  const [selectedCaseIdsForBulkEdit, setSelectedCaseIdsForBulkEdit] = useState<
    number[]
  >([]);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [isCopyMoveOpen, setIsCopyMoveOpen] = useState(false);

  // Folder copy/move state — driven by props from ProjectRepository
  const [activeCopyMoveFolderId, setActiveCopyMoveFolderId] = useState<
    number | null
  >(null);
  const [activeCopyMoveFolderName, setActiveCopyMoveFolderName] =
    useState<string>("");

  // Store rowSelection state here, it will be controlled by the useLayoutEffect
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Track last selected row index for shift-click functionality
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );

  // State for shift+click select all across pages functionality
  const [fetchAllIdsForSelection, setFetchAllIdsForSelection] = useState(false);
  const [selectAllAction, setSelectAllAction] = useState<
    "select" | "deselect" | null
  >(null);

  // Local state for immediate reorder feedback
  const [optimisticReorder, setOptimisticReorder] = useState<{
    inProgress: boolean;
    cases: any[] | null;
  }>({ inProgress: false, cases: null });

  // Fetch permissions
  const { permissions: testRunResultPermissions } = useProjectPermissions(
    projectId,
    "TestRunResults"
  );
  const canAddEditResults = testRunResultPermissions?.canAddEdit ?? false;

  // Check if user has access to more than 1 project (needed for copy/move visibility)
  const { data: projectCount } = useClientQueries(schema).projects.useCount({
    where: { isDeleted: false },
  });
  const showCopyMove = canAddEdit && (projectCount ?? 0) > 1;

  // Total project case count — and the ANCHOR for seam 2 of
  // useRepositoryCasesInvalidation. It is the live ZenStack RepositoryCases
  // query that a hand-rolled `queryClient.invalidateQueries` (AddCase's inline
  // save) lands on, which is how that path reaches the POST-routed list. Do not
  // remove or disable it without giving that seam another RepositoryCases query
  // to observe.
  const { data: totalProjectCasesCountData } = useClientQueries(
    schema
  ).repositoryCases.useCount(
    {
      where: {
        projectId: projectId,
        isDeleted: false,
        isArchived: false,
      },
    },
    {
      // Correctly pass boolean for enabled option
      enabled: !!(isValidProjectId && session?.user),
      refetchOnWindowFocus: false,
    }
  );
  const totalProjectCases = totalProjectCasesCountData ?? 0;

  const { data: projectSettings } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: projectId },
      select: {
        quickScriptEnabled: true,
        excludeNotStartedFromRuns: true,
      },
    },
    { enabled: isValidProjectId }
  );
  const quickScriptEnabled = projectSettings?.quickScriptEnabled ?? false;
  const excludeNotStartedFromRuns =
    projectSettings?.excludeNotStartedFromRuns ?? false;

  // Check if project has an active LLM integration (for auto-tag)
  const { data: projectLlmIntegrations } = useClientQueries(
    schema
  ).projectLlmIntegration.useFindMany(
    {
      where: { projectId },
    },
    { enabled: isValidProjectId }
  );
  const hasLlmIntegration =
    projectLlmIntegrations && projectLlmIntegrations.length > 0;

  // Lightweight project-wide template field discovery
  const { data: projectTemplates, isLoading: isTemplatesLoading } =
    useClientQueries(schema).templates.useFindMany(
      {
        where: {
          projects: { some: { projectId: projectId } },
          isDeleted: false,
          isEnabled: true,
        },
        select: {
          id: true,
          caseFields: {
            select: {
              caseField: {
                select: {
                  id: true,
                  displayName: true,
                  type: {
                    select: {
                      type: true,
                    },
                  },
                },
              },
            },
            where: {
              caseField: { isDeleted: false, isEnabled: true },
            },
            orderBy: { order: "asc" },
          },
        },
      },
      {
        enabled: Boolean(
          // Skip query if we know the selected folder has 0 cases. Active
          // predicates bypass the folder wall (spec §7.1), so they also bypass
          // this shortcut.
          predicates.length === 0 &&
            viewType === "folders" &&
            selectedFolderCaseCount === 0
            ? false
            : !!projectId
        ),
      }
    );

  const uniqueCaseFieldList = useMemo(() => {
    const caseFieldMap = new Map();
    projectTemplates?.forEach((template) => {
      template.caseFields.forEach((field) => {
        caseFieldMap.set(field.caseField.id, field.caseField);
      });
    });
    return Array.from(caseFieldMap.values());
  }, [projectTemplates]);

  // Fetch folders to auto-select first folder when needed
  const { data: projectFolders, isLoading: isFoldersLoading } =
    useClientQueries(schema).repositoryFolders.useFindMany(
      {
        where: {
          projectId: projectId,
          isDeleted: false,
          parentId: null,
        },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          order: true,
        },
      },
      {
        enabled: !!(projectId && viewType === "folders" && !folderId),
      }
    );

  // Fetch test run configuration for run mode
  const { data: testRunData } = useClientQueries(schema).testRuns.useFindFirst(
    {
      where: {
        id: runId,
      },
      select: {
        id: true,
        configuration: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
    {
      enabled: isRunMode && isRunIdValidNumeric,
    }
  );

  // Add state for the export modal
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isQuickScriptModalOpen, setIsQuickScriptModalOpen] = useState(false);
  const [quickScriptCaseIds, setQuickScriptCaseIds] = useState<number[] | null>(
    null
  );
  const [isAutoTagOpen, setIsAutoTagOpen] = useState(false);

  // Reset auto-select guard when switching away from folders view
  useEffect(() => {
    if (viewType !== "folders") {
      hasAutoSelectedRef.current = false;
    }
  }, [viewType]);

  // Auto-select first folder when view is folders and no folder is selected
  useEffect(() => {
    if (
      viewType === "folders" &&
      !folderId &&
      projectFolders &&
      projectFolders.length > 0 &&
      !isFoldersLoading &&
      !hasAutoSelectedRef.current
    ) {
      hasAutoSelectedRef.current = true;
      const firstFolder = projectFolders[0];

      // Navigate to the first folder by updating the URL
      const currentSearchParams = new URLSearchParams(searchParams.toString());
      currentSearchParams.set("node", firstFolder.id.toString());
      currentSearchParams.set("view", "folders");

      const newUrl = `${pathname}?${currentSearchParams.toString()}`;
      router.replace(newUrl);

      // Dispatch a custom event to notify the tree component
      // Use a small timeout to ensure the URL change propagates
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("folderSelectionChanged", {
            detail: { folderId: firstFolder.id },
          })
        );

        // Also dispatch a popstate event to simulate URL change
        // Skip this if a tour is active — popstate closes the NextStep overlay
        // Use global flag instead of URL params since navigation can strip them
        const activeTour = (window as Window & { __activeTour?: unknown })
          .__activeTour;
        if (!activeTour) {
          window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
        }
      }, 100);
    }
  }, [
    viewType,
    folderId,
    projectFolders,
    isFoldersLoading,
    router,
    pathname,
    searchParams,
  ]);

  // Add effect to listen for modal state changes
  useEffect(() => {
    const handleModalStateChange = (event: CustomEvent) => {
      setIsModalOpen(event.detail.isOpen);
    };

    window.addEventListener(
      "modalStateChange",
      handleModalStateChange as EventListener
    );
    return () => {
      window.removeEventListener(
        "modalStateChange",
        handleModalStateChange as EventListener
      );
    };
  }, []);

  const handleSelect = useCallback((attachments: any[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  }, []);

  const handleSortChange = (column: string) => {
    if (isCompleted) return;

    if (column === sortConfig?.column) {
      if (sortConfig.direction === "asc") {
        setSortConfig({ column, direction: "desc" });
      } else {
        setSortConfig(undefined);
        setIsDefaultSort(true);
      }
    } else {
      setSortConfig({ column, direction: "asc" });
      setIsDefaultSort(false);
    }
  };

  // Explicit-direction sort from the column header menu (asc/desc/clear),
  // unlike handleSortChange which only cycles.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (isCompleted) return;
    if (direction === null) {
      setSortConfig(undefined);
      setIsDefaultSort(true);
    } else {
      setSortConfig({ column, direction });
      setIsDefaultSort(false);
    }
  };

  // Remember the active sort per project. Store nothing for the default order
  // (isDefaultSort) so a reload restores the default rather than a stale sort.
  useEffect(() => {
    writeStoredColumnSort(
      `repository-cases:${projectId}`,
      isDefaultSort || !sortConfig ? null : sortConfig
    );
  }, [projectId, sortConfig, isDefaultSort]);

  // Single, stable visibility setter shared by the Columns control and the
  // header "Hide column" menu. Stable (useCallback) so ColumnSelection's emit
  // effect doesn't re-fire on every render, and shallow-equal-guarded so an
  // equal-but-new-reference map (the two controls echoing each other) bails
  // instead of looping.
  const handleColumnVisibilityChange = useCallback(
    (next: Record<string, boolean>) => {
      setColumnVisibility((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        for (const key of keys) {
          if (prev[key] !== next[key]) return next;
        }
        return prev;
      });
    },
    []
  );

  // ColumnSelection assigns its "hide a column" function here; the header "Hide
  // column" menu calls it so the hide goes through the Columns control's own
  // state (persists + keeps the checkboxes in sync), not a table round-trip.
  const columnHideRef = useRef<((columnId: string) => void) | null>(null);

  // This callback is passed to Filter, which Filter should call with its internally debounced value.
  const handleFilterChange = useCallback((value: string) => {
    setSearchString(value);
  }, []); // setSearchString is stable

  // Memoize the filter component.
  // It should now be more stable as its direct dependencies are less volatile.
  const filterComponent = useMemo(
    () => {
      return (
        <div className="text-muted-foreground w-full text-nowrap">
          <Filter
            placeholder={t("repository.cases.filter")}
            // Pass current searchString from parent for Filter's initialization/reset needs
            initialSearchString={searchString}
            // Filter component should have its own internal state for typing,
            // and call this onSearchChange prop with its debounced value.
            onSearchChange={handleFilterChange}
            dataTestId="search-input"
          />
        </div>
      );
    },
    // searchString is included so Filter can re-initialize if parent changes it externally.
    // handleFilterChange is stable. t is stable within a locale.
    [handleFilterChange, searchString, t]
  );

  // Build repository case where clause (used for filtering by folder, view, template, etc.)
  // This excludes test run-specific filters like assignedTo and status
  // NOTE: While the POST route owns the list (active search, or a where too
  // large for a GET) the ZenStack hooks are disabled and this same clause
  // travels in the request body instead.
  const repositoryCaseWhereClause: RepositoryCasesWhereInput = useMemo(() => {
    const baseConditions: RepositoryCasesWhereInput[] = [
      {
        name: {
          contains: deferredSearchString,
          mode: "insensitive" as "default" | "insensitive",
        },
      },
      {
        isDeleted: false,
        isArchived: false,
        projectId,
      },
    ];

    if (isSelectionMode && excludeNotStartedFromRuns) {
      baseConditions.push({
        state: { workflowType: { not: "NOT_STARTED" } },
      });
    }

    if (viewType === "folders" && folderId) {
      // Folder view with specific folder (or folder + all descendants)
      if (descendantFolderIds && descendantFolderIds.length > 0) {
        baseConditions.push({ folderId: { in: descendantFolderIds } });
      } else {
        baseConditions.push({ folderId: { equals: folderId } });
      }
    }

    // One self-contained fragment per predicate, AND'd with the base
    // conditions. Run-scoped predicates (status/assignedTo) are skipped by the
    // compiler and applied to the TestRunCases where instead; text/link/steps
    // operator predicates compile to their value-not-null SQL pre-filter only —
    // postFetchFilters below carries their in-memory half.
    baseConditions.push(...compileRepoPredicates(predicates, filterRegistry));

    const finalWhereClause: RepositoryCasesWhereInput = {
      AND: baseConditions,
    };
    return finalWhereClause;
  }, [
    deferredSearchString,
    projectId,
    viewType,
    folderId,
    predicates,
    filterRegistry,
    descendantFolderIds,
    isSelectionMode,
    excludeNotStartedFromRuns,
  ]);

  // Post-fetch filters for text/link/steps operator predicates — the in-memory
  // half of the fragments compileRepoPredicates pre-filters as value-not-null.
  const postFetchFilters: PostFetchFilter[] = useMemo(
    () => extractPostFetchFilters(predicates, filterRegistry),
    [predicates, filterRegistry]
  );

  // --- One transport (spec §9) ---------------------------------------------
  // The list, the count and the id list all come from POST /cases/query, in
  // repository AND run mode. The table used to choose per query between the
  // ZenStack GET hooks, the by-folder-descendants POST and this route, based on
  // whether a search was active and how long the serialized `where` was — and
  // the list query and the count query made that choice independently, so a
  // disagreement showed rows and a total that did not match. "Show all
  // descendants" needs no separate endpoint here: `descendantFolderIds` is
  // already resolved client-side into `repositoryCaseWhereClause`, and a POST
  // body has no URI length to overflow.
  const searchActive = Array.isArray(searchResultIds);
  // A search is in play whose id set is unusable — still resolving, or failed.
  // Before Phase 4 the ids were a bypass and a missing set simply meant "no
  // search"; now they are an AND'd filter, so falling through to the ordinary
  // query would render the ENTIRE repository as if the search had matched
  // everything. Every list/count query is gated off here and the render shows
  // loading (pending) or the error state (failed) instead — spec §9's "no
  // silent fallback to unfiltered".
  const searchUnresolved = searchPending || searchFailed;

  // A plain useQuery sits outside ZenStack's model-keyed query graph, so the
  // automatic post-mutation invalidation the GET hooks had is re-established
  // centrally here — one seam for every mutation site, present and future.
  // It also hands back the manual invalidator the few call sites below use.
  const invalidateCaseList = useRepositoryCasesInvalidation();

  // Run-scoped predicate fragments (status/assignedTo). Every fragment carries
  // an OR key, so they MUST be combined in an explicit AND array — spreading
  // two as siblings silently overwrites the first (compiler contract).
  const runPredicateFragments: TestRunCasesWhereInput[] = useMemo(
    () => (isRunMode ? compileRunPredicates(predicates, filterRegistry) : []),
    [isRunMode, predicates, filterRegistry]
  );

  // Create orderBy for TestRunCases based on sortConfig
  const testRunCasesOrderBy: NonNullable<TestRunCasesFindManyArgs["orderBy"]> =
    useMemo(() => {
      if (!sortConfig || isDefaultSort) {
        return { order: "asc" }; // Default to run order
      }

      const column = sortConfig.column;
      const direction = sortConfig.direction;

      // Map column names to TestRunCases fields
      if (column === "order") {
        return { order: direction };
      } else if (column === "assignedTo") {
        return { assignedTo: { name: direction } };
      } else if (column === "testRunStatus" || column === "status") {
        return { status: { name: direction } };
      } else if (column === "name") {
        return { repositoryCase: { name: direction } };
      } else if (column === "state") {
        return { repositoryCase: { state: { name: direction } } };
      } else if (column === "template") {
        return { repositoryCase: { template: { templateName: direction } } };
      } else if (column === "folder") {
        return { repositoryCase: { folder: { name: direction } } };
      } else if (column === "createdAt") {
        return { repositoryCase: { createdAt: direction } };
      } else if (column === "creator") {
        return { repositoryCase: { creator: { name: direction } } };
      } else if (column === "linkedCases") {
        return { repositoryCase: { linksFrom: { _count: direction } } };
      } else if (column === "testRuns") {
        return { repositoryCase: { testRuns: { _count: direction } } };
      } else if (column === "comments") {
        return { repositoryCase: { comments: { _count: direction } } };
      } else if (column === "attachments") {
        return { repositoryCase: { attachments: { _count: direction } } };
      } else if (column === "steps") {
        return { repositoryCase: { steps: { _count: direction } } };
      } else if (column === "tags") {
        return { repositoryCase: { caseTags: { _count: direction } } };
      } else if (column === "issues") {
        return { repositoryCase: { caseIssues: { _count: direction } } };
      } else if (REPOSITORY_CASE_SORTABLE_SCALARS.has(column)) {
        return { repositoryCase: { [column]: direction } };
      }
      // UI-only sorts (latestResults, forecast, custom-field columns) have no
      // TestRunCases counterpart. The sort is remembered per project and shared
      // with the repository view, so an orderBy the server rejects would empty
      // the whole table — fall back to run order instead.
      return { order: "asc" };
    }, [sortConfig, isDefaultSort]);

  // Determine which run IDs to query - use selectedRunIds if provided (multi-config), otherwise use single runId
  const effectiveRunIds =
    selectedRunIds && selectedRunIds.length > 0
      ? selectedRunIds
      : runId
        ? [runId]
        : [];

  // Run-mode TestRunCases predicate. The route forces the run scope, the
  // project on both ends and (in search) the case id set; this carries only
  // what the client owns — soft-delete plus the run-scoped predicate fragments
  // (status/assignedTo). The repository half travels as `repositoryCaseWhere`.
  const testRunCasesWhere = useMemo(
    () => ({ isDeleted: false, AND: runPredicateFragments }),
    [runPredicateFragments]
  );

  // orderBy for repository cases (used in non-run mode)
  const orderBy: NonNullable<RepositoryCasesFindManyArgs["orderBy"]> =
    useMemo(() => {
      if (isDefaultSort) {
        return { order: "asc" };
      }
      if (!sortConfig) {
        return { order: "asc" };
      }

      const column = sortConfig.column;
      const direction = sortConfig.direction;

      // Count-based sorting using relation aggregate input
      if (column === "linkedCases") {
        return { linksFrom: { _count: direction } };
      }
      if (column === "testRuns") {
        return { testRuns: { _count: direction } };
      }
      if (column === "comments") {
        return { comments: { _count: direction } };
      }
      if (column === "attachments") {
        return { attachments: { _count: direction } };
      }
      if (column === "steps") {
        return { steps: { _count: direction } };
      }
      if (column === "tags") {
        return { caseTags: { _count: direction } };
      }
      if (column === "issues") {
        return { caseIssues: { _count: direction } };
      }

      // Text-based sorting on related entities
      if (column === "template") {
        return { template: { templateName: direction } };
      }
      if (column === "creator") {
        return { creator: { name: direction } };
      }

      // Ordered by a window function over the result tables instead, so the
      // query keeps its default order and the page ids come from
      // useCaseIdsByLatestStatus below.
      if (column === "latestResults") {
        return { order: "asc" };
      }

      if (REPOSITORY_CASE_SORTABLE_SCALARS.has(column)) {
        return { [column]: direction };
      }
      // Dropdown custom-field sorts order via resolved page ids (see
      // fieldOptionPageIds below), so the query keeps its default order here.
      // Remaining UI-only sorts (forecast, non-dropdown custom-field columns)
      // and run-view sorts remembered under the shared per-project key
      // (status, assignedTo) have no RepositoryCases column — an orderBy the
      // server rejects would empty the whole table, so fall back to the
      // default order instead.
      return { order: "asc" };
    }, [sortConfig, isDefaultSort]);

  // Counts no longer have a query of their own: the list response carries
  // the total for the same intersection it paged, so rows and total cannot
  // disagree. The only exception is an id-resolved sort, whose page request is
  // scoped to one page of ids — see postQueryCountResult below.

  // Text/link/steps filters are applied in JS to the fetched rows, so the
  // select-all ids query has to carry the relations those filters read — with
  // the same visibility rules as the list query, or select-all would resolve to
  // a different set of cases than the one on screen.
  const selectAllIdsSelect = useMemo<RepositoryCasesSelect>(() => {
    const select: RepositoryCasesSelect = { id: true, isDeleted: true };
    if (postFetchFilters.length === 0) return select;

    const valueFieldIds = postFetchFilters
      .filter((filter) => filter.type === "text" || filter.type === "link")
      .map((filter) => filter.fieldId);

    if (valueFieldIds.length > 0) {
      select.template = {
        select: {
          caseFields: { select: { caseField: { select: { id: true } } } },
        },
      };
      select.caseFieldValues = {
        where: {
          ...CASE_FIELD_VALUES_SELECT.where,
          fieldId: { in: valueFieldIds },
        },
        select: { fieldId: true, value: true },
      };
    }

    if (postFetchFilters.some((filter) => filter.type === "steps")) {
      select.steps = {
        where: { isDeleted: false, OR: STEP_VISIBILITY_OR },
        select: { id: true },
      };
    }

    return select;
  }, [postFetchFilters]);

  // Stable name of the select-all row shape for the query key. The select
  // itself varies only with the post-fetch filters it has to feed, so the field
  // ids it carries are the whole of its identity — hashing the object would
  // just be a bigger way of saying this.
  const selectAllIdsSelectKey = useMemo(
    () =>
      postFetchFilters.length === 0
        ? "ids"
        : `selectAll:${postFetchFilters
            .map((filter) => `${filter.type}:${filter.fieldId}`)
            .sort()
            .join(",")}`,
    [postFetchFilters]
  );

  // Search active + default sort => Elasticsearch relevance wins, and that
  // order lives only in the position of searchResultIds, so the route is asked
  // for it by omitting orderBy. A user-chosen (or remembered) column sort wins
  // over relevance — the table must obey its own sort header (spec §9).
  const useRelevanceOrder = searchActive && isDefaultSort;

  // The full intersected id list behind select-all and the details panel's
  // prev/next. `idsOnly` is enough unless text/link/steps matchers have to run
  // in memory — those need the rows the matchers read, so the same request
  // carries the select-all select instead.
  const allIdsNeedRows = postFetchFilters.length > 0;
  const allIdsWanted =
    fetchAllIdsForSelection ||
    Boolean(selectedCaseIdParam && !isRunMode && !isSelectionMode);
  const postQueryAllIdsResult = useRepositoryCasesQuery(
    {
      projectId,
      where: repositoryCaseWhereClause,
      orderBy: useRelevanceOrder ? undefined : orderBy,
      select: allIdsNeedRows ? selectAllIdsSelect : undefined,
      selectKey: selectAllIdsSelectKey,
      idsOnly: !allIdsNeedRows,
      searchCaseIds: searchResultIds ?? undefined,
      searchKey,
      enabled: Boolean(
        allIdsWanted && !isRunMode && !searchUnresolved && !!session?.user
      ),
      // The ids are consumed as soon as they arrive; a previous view's set must
      // never be applied to the cases now on screen.
      keepPreviousData: false,
    },
    allIdsNeedRows ? postFetchFilters : undefined
  );

  const postQueryAllCaseIds = useMemo<number[] | undefined>(() => {
    if (allIdsNeedRows) {
      return postQueryAllIdsResult.data?.map((row: { id: number }) => row.id);
    }
    return postQueryAllIdsResult.ids;
  }, [allIdsNeedRows, postQueryAllIdsResult.data, postQueryAllIdsResult.ids]);

  // Memoized: it keys the select-all effect below, and an unstable identity
  // would re-run that effect on every render. `idsOnly` returns bare ids; the
  // effect reads {id, isDeleted} rows (policy and isDeleted filtering already
  // happened server-side).
  const allCaseIdsData = useMemo(
    () => postQueryAllCaseIds?.map((id) => ({ id, isDeleted: false })),
    [postQueryAllCaseIds]
  );

  const isTotalLoading = false;

  // Handle Shift+Click Select All/Deselect All across all pages
  useEffect(() => {
    if (allCaseIdsData && Array.isArray(allCaseIdsData) && selectAllAction) {
      const selectableAllCaseIds = allCaseIdsData
        .filter((tc: any) => !tc.isDeleted)
        .map((tc: any) => tc.id);

      if (selectAllAction === "select") {
        // Select all cases across all pages
        if (isSelectionMode && onSelectionChange) {
          onSelectionChange(selectableAllCaseIds);
        } else {
          setSelectedCaseIdsForBulkEdit(selectableAllCaseIds);
        }
        toast.success(
          t("repository.selectedAllCases", {
            count: selectableAllCaseIds.length,
          })
        );
      } else if (selectAllAction === "deselect") {
        // Deselect all cases across all pages
        if (isSelectionMode && onSelectionChange) {
          onSelectionChange([]);
        } else {
          setSelectedCaseIdsForBulkEdit([]);
        }
        setRowSelection({});
        toast.success(t("repository.deselectedAllCases"));
      }

      // Reset the fetch state
      setFetchAllIdsForSelection(false);
      setSelectAllAction(null);
    }
  }, [allCaseIdsData, selectAllAction, isSelectionMode, onSelectionChange, t]);

  // The id-resolved sorts run during a search too, by AND'ing the resolved
  // Elasticsearch ids into the where they resolve against. Skipping them
  // instead (the pre-review behaviour) silently degraded the table to default
  // order while the sort header still claimed the sort and the relevance pill
  // stayed hidden — the UI would name an order it was not using. Both
  // resolvers are server actions, so the where travels in a POST body and even
  // a 10,000-id set cannot overflow a URL.
  const idSortWhere = useMemo(
    () =>
      searchActive
        ? {
            AND: [
              repositoryCaseWhereClause,
              { id: { in: searchResultIds as number[] } },
            ],
          }
        : repositoryCaseWhereClause,
    [searchActive, repositoryCaseWhereClause, searchResultIds]
  );

  // Sorting by Latest Results orders on the status of each case's most recent
  // result, which no ZenStack orderBy can express. The ids for the page are
  // resolved first, then handed to the query below as the whole filter, so the
  // existing hook still does the hydration, policy checks and caching.
  const isLatestResultsSort =
    !isDefaultSort && sortConfig?.column === "latestResults";
  const { pageIds: latestStatusPageIds } = useCaseIdsByLatestStatus({
    where: idSortWhere,
    direction: sortConfig?.direction ?? "asc",
    skip: (currentPage - 1) * (pageSize === "All" ? 0 : pageSize),
    take: pageSize === "All" ? undefined : pageSize,
    enabled: Boolean(
      isLatestResultsSort &&
      !isRunMode &&
      // An unresolved search would resolve the page against the un-searched
      // superset.
      !searchUnresolved &&
      // Works in descendants mode too: this is a server action (the where goes
      // in the POST body), so a large folder subtree can't overflow a URL.
      postFetchFilters.length === 0
    ),
  });

  // A custom-field column stores its numeric field id as the sort column id.
  // Only Dropdown fields sort this way — their options carry an admin-defined
  // order — so resolve the id back to a field and keep it only when that field
  // is a Dropdown. Like latest results, the option order lives behind a Json
  // value no ZenStack orderBy can reach, so the ordered page ids are resolved
  // by a server action and handed to the query below as the whole filter.
  const fieldOptionSortFieldId = useMemo(() => {
    if (isDefaultSort || !sortConfig) return null;
    if (!/^\d+$/.test(sortConfig.column)) return null;
    const fieldId = Number(sortConfig.column);
    const field = uniqueCaseFieldList.find((f) => f.id === fieldId);
    return field?.type?.type === "Dropdown" ? fieldId : null;
  }, [isDefaultSort, sortConfig, uniqueCaseFieldList]);
  const isFieldOptionSort = fieldOptionSortFieldId !== null;
  const { pageIds: fieldOptionPageIds } = useCaseIdsByFieldOption({
    where: idSortWhere,
    fieldId: fieldOptionSortFieldId ?? 0,
    direction: sortConfig?.direction ?? "asc",
    skip: (currentPage - 1) * (pageSize === "All" ? 0 : pageSize),
    take: pageSize === "All" ? undefined : pageSize,
    enabled: Boolean(
      isFieldOptionSort &&
      !isRunMode &&
      !searchUnresolved &&
      postFetchFilters.length === 0
    ),
  });

  // Whichever id-resolved sort is active (they are mutually exclusive: one
  // sort column at a time).
  const sortedPageIds = latestStatusPageIds ?? fieldOptionPageIds;

  // An id-resolved sort that resolved to an empty page: the ordered page-id
  // list came back empty (no matching cases, or a transient during the sort).
  // The list derives empty from this anyway, so skip the id-filtered fetch that
  // would otherwise query `id: { in: [] }`.
  const sortedPageEmpty =
    (isLatestResultsSort || isFieldOptionSort) &&
    Array.isArray(sortedPageIds) &&
    sortedPageIds.length === 0;

  // ---- THE list query -----------------------------------------------------
  // Repository mode and run mode differ only in scope operands and row shape,
  // so both go through the same POST hook. The response carries the rows AND
  // the total for the same intersection, which is why there is no separate
  // count query to drift out of step with it.
  // Text/link/steps matchers run in memory, so those requests fetch the whole
  // matching set and paginate client-side. Run mode does NOT do this — it never
  // has, and the matchers would have to reach through `repositoryCase` — so a
  // text predicate there still pre-filters in SQL only.
  const clientPaginated = !isRunMode && postFetchFilters.length > 0;
  const postQuerySkip = (currentPage - 1) * (pageSize === "All" ? 0 : pageSize);
  const postQueryTake = pageSize === "All" ? undefined : pageSize;

  // The selected folder is known to be empty and no predicate is active, so the
  // answer is "no rows" without asking (spec §7.1).
  const knownEmptyFolder =
    predicates.length === 0 &&
    viewType === "folders" &&
    selectedFolderCaseCount === 0;

  const listEnabled = Boolean(
    !!session?.user &&
    isValidProjectId &&
    // A search whose ids are unresolved or failed must not fall through to a
    // query without them — that would render the whole repository as if the
    // search had matched everything.
    !searchUnresolved &&
    (isRunMode
      ? effectiveRunIds.length > 0
      : // An id-resolved sort that resolved to an empty page has nothing to
        // fetch; the list derives empty from it anyway.
        !sortedPageEmpty && !knownEmptyFolder)
  );

  const postQueryResult = useRepositoryCasesQuery(
    {
      projectId,
      testRunIds: isRunMode ? effectiveRunIds : undefined,
      // An id-resolved sort narrows the page to the ids it resolved, but the
      // predicates travel WITH them: the resolution and this fetch are separate
      // round trips, and in the window where the predicates changed and the
      // ids have not re-resolved, an id-only where would show rows the active
      // filters exclude. The where rides in a POST body, so no size argument
      // for an id-only form applies.
      where: isRunMode
        ? testRunCasesWhere
        : sortedPageIds
          ? { ...repositoryCaseWhereClause, id: { in: sortedPageIds } }
          : repositoryCaseWhereClause,
      repositoryCaseWhere: isRunMode ? repositoryCaseWhereClause : undefined,
      orderBy: isRunMode
        ? testRunCasesOrderBy
        : useRelevanceOrder
          ? undefined
          : orderBy,
      select: isRunMode
        ? TEST_RUN_CASE_LIST_SELECT
        : REPOSITORY_CASE_LIST_SELECT,
      selectKey: isRunMode ? "runList" : "list",
      skip: clientPaginated || sortedPageIds ? undefined : postQuerySkip,
      take: clientPaginated || sortedPageIds ? undefined : postQueryTake,
      searchCaseIds: searchResultIds ?? undefined,
      searchKey,
      enabled: listEnabled,
      // Run rows carry other people's live results; the repository list does
      // not change under you the same way.
      refetchOnWindowFocus: isRunMode,
    },
    clientPaginated ? postFetchFilters : undefined,
    clientPaginated ? { skip: postQuerySkip, take: postQueryTake } : undefined
  );

  // An id-resolved sort's page request above is scoped to one page of ids, so
  // its totalCount is the page size. The honest total comes from a count-only
  // request (no `select`) carrying the real where.
  const postQueryCountResult = useRepositoryCasesQuery({
    projectId,
    where: repositoryCaseWhereClause,
    selectKey: "count",
    searchCaseIds: searchResultIds ?? undefined,
    searchKey,
    enabled: Boolean(
      !isRunMode &&
      !!sortedPageIds &&
      !searchUnresolved &&
      !!session?.user &&
      isValidProjectId
    ),
  });

  // Run mode's rows are TestRunCases with the case nested under
  // `repositoryCase`; repository mode's rows ARE the cases. Downstream consumers
  // still read the two under their historical names.
  const testRunCasesData = isRunMode
    ? (postQueryResult.data ?? undefined)
    : undefined;
  const data = isRunMode ? undefined : postQueryResult.data;
  const isLoading = searchPending
    ? // Every list query is gated off while the ids resolve, so nothing is
      // "loading" in React Query's sense — but the rows on screen do not answer
      // the query the user just typed (or arrived with in `?q=`), and showing
      // them unfiltered is the corruption this state exists to prevent.
      true
    : postQueryResult.isLoading;
  const filteredTotalCount =
    !isRunMode && sortedPageIds
      ? postQueryCountResult.totalCount
      : postQueryResult.totalCount;

  // A failed query keeps the previous rows on screen (keepPreviousData) — the
  // toast is the only signal, because silently falling back to an unfiltered
  // list would show cases the filters exclude.
  const postQueryError = postQueryResult.error ?? postQueryCountResult.error;
  const reportedQueryErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (!postQueryError) {
      reportedQueryErrorRef.current = null;
      return;
    }
    if (reportedQueryErrorRef.current === postQueryError) return;
    reportedQueryErrorRef.current = postQueryError;
    console.error("Repository cases query failed:", postQueryError);
    toast.error(t("common.errors.fetchFailed"));
  }, [postQueryError, t]);

  // Every consumer that used to reach for one query's `refetch` now goes
  // through the shared invalidator, so the list, the count and the id list are
  // refreshed together and no caller has to know how many queries there are.
  const refetchData = invalidateCaseList;

  // The list response's count is the intersection's real size: it applies the
  // predicates, the folder scope, the run scope, the name filter AND row-level
  // read policy, where the old search path just counted the raw Elasticsearch
  // id array (over-counting archived and policy-hidden hits).
  const totalRepositoryCases = useMemo(() => {
    // A folder known to be empty with no predicate active answers 0 without a
    // query (spec §7.1) — the list query is gated off in that case, so its
    // placeholder total must not leak through.
    if (!isRunMode && knownEmptyFolder) return 0;
    return filteredTotalCount ?? 0;
  }, [isRunMode, knownEmptyFolder, filteredTotalCount]);

  // Update total items in pagination context
  useEffect(() => {
    setTotalItems(totalRepositoryCases);
  }, [totalRepositoryCases, setTotalItems]);

  // Kept as a named alias because callers throughout this file (bulk edit,
  // reorder recovery, modals) read as "refresh the cases". List, count and id
  // list are one invalidation now, so there is nothing else to fan out to.
  const refetchRepositoryCases = refetchData;

  // For isRunMode, flatten testRunCasesData for the table
  const cases = useMemo(() => {
    // If we're actively reordering, use the optimistic order
    if (optimisticReorder.inProgress && optimisticReorder.cases) {
      return optimisticReorder.cases;
    }

    if (isRunMode && testRunCasesData) {
      // In run mode, testRunCasesData is already filtered and paginated server-side
      // Just map it to include all the test run-specific fields
      return testRunCasesData.map((trc) => ({
        ...trc.repositoryCase,
        // Derive the legacy tags/issues array shape from the explicit join rows
        // so downstream consumers (columns) are unaffected.
        tags:
          (trc.repositoryCase as CaseJoinRels).caseTags?.map((ct) => ct.tag) ??
          [],
        issues:
          (trc.repositoryCase as CaseJoinRels).caseIssues?.map(
            (ci) => ci.issue
          ) ?? [],
        testRunCaseId: trc.id,
        testRunStatus: trc.status,
        testRunStatusId: trc.statusId,
        assignedTo: trc.assignedTo,
        assignedToId: trc.assignedToId,
        isCompleted: trc.isCompleted,
        notes: trc.notes,
        startedAt: trc.startedAt,
        completedAt: trc.completedAt,
        elapsed: trc.elapsed,
        order: trc.order,
        testRunId: trc.testRun?.id,
        testRunConfiguration: trc.testRun?.configuration,
        // Phase 3 — surface the iteration count so the status cell can
        // detect parameterized cases and render read-only.
        totalIterations: (trc as { totalIterations?: number }).totalIterations,
      }));
    }
    // Not in isRunMode. Use 'data' directly (already server-side paginated and filtered).
    if (data) {
      const mapped = data.map((caseItem) => ({
        ...caseItem,
        // Derive the legacy tags/issues array shape from the explicit join rows
        // so downstream consumers (columns) are unaffected.
        tags: (caseItem as CaseJoinRels).caseTags?.map((ct) => ct.tag) ?? [],
        issues:
          (caseItem as CaseJoinRels).caseIssues?.map((ci) => ci.issue) ?? [],
      }));

      // The query was filtered by the ordered page ids but returns them in its
      // own order, so re-impose the one they were resolved in.
      if (sortedPageIds) {
        const byId = new Map(mapped.map((c) => [c.id, c]));
        return sortedPageIds
          .map((id) => byId.get(id))
          .filter((c): c is (typeof mapped)[number] => c !== undefined);
      }
      return mapped;
    }
    return [];
  }, [isRunMode, testRunCasesData, data, optimisticReorder, sortedPageIds]);

  // Bulk-fetch PENDING ReviewRequests for the visible page (D-06; one round
  // trip per page render — never per-row, per RESEARCH §"Pitfall 6").
  const { enabled: reviewFeatureEnabled } = useReviewFeatureEnabled(projectId);
  const visibleCaseIds = useMemo(
    () => cases.map((c: { id: number }) => c.id),
    [cases]
  );

  // Ordered id list of the FULL filtered result set (all pages), powering the
  // docked details panel's prev/next stepper. It comes from the same POST route
  // the list does — `postQueryAllIdsResult` above, whose `idsOnly` response is
  // the intersected, ordered id set (NOT the raw Elasticsearch ids, which still
  // contain archived, policy-hidden and filtered-out cases).

  // Same window-function ordering the list applies through `latestStatusPageIds`,
  // but unpaginated: the details panel's prev/next must step across the whole
  // filtered set, not just the current page. Latest-results sort can't be
  // expressed as an `orderBy`, so the ids-only list stays in default order
  // and can't drive prev/next when this sort is active. Works in descendants
  // mode too — the where scopes to the resolved descendant folders and this is
  // a POST server action, so a deep subtree can't overflow a URL.
  const { pageIds: latestStatusAllIds } = useCaseIdsByLatestStatus({
    where: idSortWhere,
    direction: sortConfig?.direction ?? "asc",
    enabled: Boolean(
      isLatestResultsSort &&
      !isRunMode &&
      !isSelectionMode &&
      !!selectedCaseIdParam &&
      !searchUnresolved &&
      postFetchFilters.length === 0 &&
      !!session?.user
    ),
  });

  // Dropdown-field sort's counterpart to `latestStatusAllIds`: same option
  // ordering the list applies through `fieldOptionPageIds`, but unpaginated so
  // prev/next steps across the whole filtered set.
  const { pageIds: fieldOptionAllIds } = useCaseIdsByFieldOption({
    where: idSortWhere,
    fieldId: fieldOptionSortFieldId ?? 0,
    direction: sortConfig?.direction ?? "asc",
    enabled: Boolean(
      isFieldOptionSort &&
      !isRunMode &&
      !isSelectionMode &&
      !!selectedCaseIdParam &&
      !searchUnresolved &&
      postFetchFilters.length === 0 &&
      !!session?.user
    ),
  });

  const allCaseIds = useMemo<number[]>(() => {
    // Id-resolved sorts (latest results, dropdown field option) order through
    // `sortedPageIds` for the list, not via `orderBy`, so the ids-only list is
    // in default order. Walk the full id-resolved ordering instead to keep
    // prev/next in step with the sorted list. During a search they resolve
    // against the intersected id set (idSortWhere), so they agree with the
    // list there too; relevance order only applies when no column sort is on.
    if (latestStatusAllIds) return latestStatusAllIds;
    if (fieldOptionAllIds) return fieldOptionAllIds;
    if (!postQueryAllCaseIds) return visibleCaseIds;
    // A drag-reorder only shuffles the current page, but the ids-only list
    // keeps the pre-reorder order until its query refetches. The current page
    // is a contiguous block within `ids` (same orderBy), so while the
    // optimistic reorder is in flight, overwrite that block with the reordered
    // visible ids — otherwise prev/next steps through the stale order.
    if (optimisticReorder.inProgress) {
      const visibleSet = new Set(visibleCaseIds);
      let vi = 0;
      return postQueryAllCaseIds.map((id) =>
        visibleSet.has(id) ? visibleCaseIds[vi++] : id
      );
    }
    return postQueryAllCaseIds;
  }, [
    postQueryAllCaseIds,
    latestStatusAllIds,
    fieldOptionAllIds,
    visibleCaseIds,
    optimisticReorder.inProgress,
  ]);

  // Lift the selected case's prev/next context up to ProjectRepository, which
  // renders the docked details panel.
  useEffect(() => {
    if (!onCaseNavChange) return;
    if (isRunMode || isSelectionMode || !selectedCaseIdParam) {
      onCaseNavChange(null);
      return;
    }
    const id = Number(selectedCaseIdParam);
    const idx = allCaseIds.indexOf(id);
    const total = allCaseIds.length;
    if (idx === -1) {
      onCaseNavChange({
        position: null,
        total,
        prevId: null,
        nextId: null,
        hasPrev: false,
        hasNext: false,
      });
      return;
    }
    onCaseNavChange({
      position: idx + 1,
      total,
      prevId: idx > 0 ? allCaseIds[idx - 1] : null,
      nextId: idx < total - 1 ? allCaseIds[idx + 1] : null,
      hasPrev: idx > 0,
      hasNext: idx < total - 1,
    });
  }, [
    allCaseIds,
    selectedCaseIdParam,
    isRunMode,
    isSelectionMode,
    onCaseNavChange,
  ]);

  const { data: pendingReviewsForVisibleCases } = useClientQueries(
    schema
  ).reviewRequest.useFindMany(
    {
      where: {
        entityType: "CASE",
        entityId: { in: visibleCaseIds },
        status: "PENDING",
        isDeleted: false,
      },
      select: {
        id: true,
        status: true,
        entityId: true,
        assigneeUserId: true,
        assigneeRoleId: true,
        assigneeUser: { select: { name: true } },
        assigneeRole: { select: { name: true } },
      },
    },
    {
      enabled: reviewFeatureEnabled === true && visibleCaseIds.length > 0,
    }
  );
  const pendingByCaseId = useMemo(() => {
    const map = new Map<number, PendingReviewSummary>();
    const rows = pendingReviewsForVisibleCases as
      Array<PendingReviewSummary & { entityId: number }> | undefined;
    rows?.forEach((row) => {
      map.set(row.entityId, row);
    });
    return map;
  }, [pendingReviewsForVisibleCases]);
  const renderPendingBadge = useCallback(
    (caseId: number) => (
      <PendingReviewBadge pendingRequest={pendingByCaseId.get(caseId)} />
    ),
    [pendingByCaseId]
  );

  // Recent executions for the visible page, one round trip per render like the
  // review badges above.
  const latestResultsByCase = useLatestTestResults(visibleCaseIds);
  const renderLatestResults = useCallback(
    (caseId: number, caseProjectId: number) => (
      <LatestResultsCell
        executions={latestResultsByCase[caseId] ?? []}
        slots={LATEST_RESULTS_COUNT}
        projectId={caseProjectId}
        testCaseId={caseId}
      />
    ),
    [latestResultsByCase]
  );

  // Clear optimistic reorder when underlying data changes
  useEffect(() => {
    setOptimisticReorder({ inProgress: false, cases: null });
  }, [currentPage, sortConfig, folderId, viewType, predicatesKey, searchText]);

  // Scope the bulk-edit selection to the current view. Switching folders (or
  // changing the view/filter that determines which cases are shown) clears the
  // selection so a bulk action can't silently span cases the user can no longer
  // see. Pagination and sorting within the same view intentionally keep the
  // selection (that is what the cross-page merge logic is for). Run-mode
  // selection is owned by the parent and may legitimately span folders, so it
  // is left untouched here.
  // The search text is part of that identity: it narrows the visible set
  // exactly like a predicate does, so a selection made before a search must not
  // survive it.
  const previousViewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSelectionMode) return;

    const viewKey = `${folderId}-${viewType}-${predicatesKey}-${searchText}`;
    if (
      previousViewKeyRef.current !== null &&
      previousViewKeyRef.current !== viewKey
    ) {
      setSelectedCaseIdsForBulkEdit([]);
      setRowSelection({});
      setLastSelectedIndex(null);
    }
    previousViewKeyRef.current = viewKey;
  }, [folderId, viewType, predicatesKey, searchText, isSelectionMode]);

  // A Shift+click select-all belongs to the view it was started from. Changing
  // the view — including changing the search that scopes it — abandons the
  // in-flight ids fetch so its result can't be applied to the cases the user is
  // now looking at.
  useEffect(() => {
    setFetchAllIdsForSelection(false);
    setSelectAllAction(null);
  }, [folderId, viewType, predicatesKey, searchText]);

  // Check if we're in multi-config mode (multiple test runs selected)
  const isMultiConfigMode =
    isRunMode && selectedRunIds && selectedRunIds.length > 1;

  // Handle selection changes
  const _handleSelectAll = useCallback(() => {
    if (!isSelectionMode || !onSelectionChange || !cases) return;
    // In multi-config mode, use testRunCaseId for unique identification
    const currentPageIds = cases.map((tc) =>
      isMultiConfigMode && (tc as MaybeRunModeCase).testRunCaseId
        ? (tc as MaybeRunModeCase).testRunCaseId
        : tc.id
    );
    const allSelected = currentPageIds.every((id) =>
      selectedTestCases.includes(id)
    );

    const newSelection = allSelected
      ? selectedTestCases.filter((id) => !currentPageIds.includes(id))
      : [...new Set([...selectedTestCases, ...currentPageIds])];

    onSelectionChange(newSelection);
  }, [
    isSelectionMode,
    onSelectionChange,
    cases,
    selectedTestCases,
    isMultiConfigMode,
  ]);

  // Handle bulk edit selection changes
  const _handleBulkEditSelectionChange = useCallback((ids: number[]) => {
    setSelectedCaseIdsForBulkEdit(ids);
  }, []);

  // Effect to initialize table selection state based on props
  // This is Effect 1: External Global Selection -> Internal Table rowSelection
  useLayoutEffect(() => {
    const newRowSelectionModel: RowSelectionState = {};
    const currentExternalSelection = isSelectionMode
      ? selectedTestCases
      : selectedCaseIdsForBulkEdit;

    const MappedCases = cases ?? [];
    MappedCases.forEach((caseItem, index) => {
      // In multi-config mode, use testRunCaseId for unique identification
      // Otherwise use repositoryCaseId (caseItem.id)
      const caseKey =
        isMultiConfigMode && (caseItem as MaybeRunModeCase).testRunCaseId
          ? (caseItem as MaybeRunModeCase).testRunCaseId
          : caseItem.id;

      if (currentExternalSelection.includes(caseKey)) {
        newRowSelectionModel[index.toString()] = true;
      }
    });

    if (JSON.stringify(newRowSelectionModel) !== JSON.stringify(rowSelection)) {
      setRowSelection(newRowSelectionModel);
    }
  }, [
    cases,
    isSelectionMode,
    selectedTestCases,
    selectedCaseIdsForBulkEdit,
    rowSelection,
    isMultiConfigMode,
  ]);

  // New handler for the table's onRowSelectionChange prop
  const handleTableRowSelectionChange = useCallback(
    (updater: TableUpdater<RowSelectionState>) => {
      const MappedCases = cases ?? []; // Cases currently visible in the DataTable
      const currentLocalRowSelection = rowSelection;

      const newRowSelectionState =
        typeof updater === "function"
          ? updater(currentLocalRowSelection)
          : updater;

      // Translate this newRowSelectionState (index-based) to ID-based for the current page
      // In multi-config mode, use testRunCaseId for unique identification
      const newlySelectedIdsOnCurrentPage = Object.entries(newRowSelectionState)
        .filter(([_, isSelected]) => isSelected === true)
        .map(([rowIndexString]) => {
          const rowIndex = parseInt(rowIndexString);
          const caseItem = MappedCases[rowIndex];
          if (!caseItem) return undefined;
          // Use testRunCaseId in multi-config mode for unique row identification
          return isMultiConfigMode &&
            (caseItem as MaybeRunModeCase).testRunCaseId
            ? (caseItem as MaybeRunModeCase).testRunCaseId
            : caseItem.id;
        })
        .filter((id): id is number => id !== undefined);

      if (isSelectionMode && onSelectionChange) {
        // Get IDs of all cases currently visible in the DataTable
        const allCaseIdsOnCurrentPage = MappedCases.map((tc) =>
          isMultiConfigMode && (tc as MaybeRunModeCase).testRunCaseId
            ? (tc as MaybeRunModeCase).testRunCaseId
            : tc.id
        );

        // Get IDs that were selected from *other* pages/views
        const selectedIdsFromOtherPages = selectedTestCases.filter(
          (id) => !allCaseIdsOnCurrentPage.includes(id)
        );

        // Combine selections from other pages with the new selections on the current page
        const combinedSelectedIds = Array.from(
          new Set([
            ...selectedIdsFromOtherPages,
            ...newlySelectedIdsOnCurrentPage,
          ])
        );

        if (
          JSON.stringify(combinedSelectedIds) !==
          JSON.stringify(selectedTestCases)
        ) {
          onSelectionChange(combinedSelectedIds);
        }
      } else if (!isSelectionMode) {
        // Bulk edit mode - preserve selections from other pages
        const allCaseIdsOnCurrentPage = MappedCases.map((tc) =>
          isMultiConfigMode && (tc as MaybeRunModeCase).testRunCaseId
            ? (tc as MaybeRunModeCase).testRunCaseId
            : tc.id
        );

        // Get IDs that were selected from *other* pages/views
        const selectedIdsFromOtherPages = selectedCaseIdsForBulkEdit.filter(
          (id) => !allCaseIdsOnCurrentPage.includes(id)
        );

        // Combine selections from other pages with the new selections on the current page
        const combinedSelectedIds = Array.from(
          new Set([
            ...selectedIdsFromOtherPages,
            ...newlySelectedIdsOnCurrentPage,
          ])
        );

        if (
          JSON.stringify(combinedSelectedIds) !==
          JSON.stringify(selectedCaseIdsForBulkEdit)
        ) {
          setSelectedCaseIdsForBulkEdit(combinedSelectedIds);
        }
      }
    },
    [
      cases,
      rowSelection,
      isSelectionMode,
      onSelectionChange,
      selectedTestCases, // Important: selectedTestCases is the global selection state
      selectedCaseIdsForBulkEdit,
      setSelectedCaseIdsForBulkEdit,
      isMultiConfigMode,
    ]
  );

  // Handle checkbox click with shift-click support
  const handleCheckboxClick = useCallback(
    (rowIndex: number, event: React.MouseEvent) => {
      const MappedCases = cases ?? [];

      if (
        event.shiftKey &&
        lastSelectedIndex !== null &&
        lastSelectedIndex !== rowIndex
      ) {
        // Handle shift-click for range selection
        const startIndex = Math.min(lastSelectedIndex, rowIndex);
        const endIndex = Math.max(lastSelectedIndex, rowIndex);

        // Create new selection state with range selected
        const rangeSelection: RowSelectionState = { ...rowSelection };

        // Select all rows in the range
        for (let i = startIndex; i <= endIndex; i++) {
          if (MappedCases[i] && !MappedCases[i].isDeleted) {
            rangeSelection[i.toString()] = true;
          }
        }

        // Update both the local state and the global selection
        setRowSelection(rangeSelection);

        // Convert to IDs for the global selection
        const getCaseId = (tc: (typeof MappedCases)[number]) =>
          isMultiConfigMode && (tc as MaybeRunModeCase).testRunCaseId
            ? (tc as MaybeRunModeCase).testRunCaseId
            : tc.id;
        const selectedIds = Object.entries(rangeSelection)
          .filter(([_, isSelected]) => isSelected)
          .map(([index]) => {
            const tc = MappedCases[parseInt(index)];
            return tc ? getCaseId(tc) : undefined;
          })
          .filter((id): id is number => id !== undefined);

        if (isSelectionMode && onSelectionChange) {
          // Get IDs from other pages
          const allCaseIdsOnCurrentPage = MappedCases.map(getCaseId);
          const selectedIdsFromOtherPages = selectedTestCases.filter(
            (id) => !allCaseIdsOnCurrentPage.includes(id)
          );
          const combinedSelectedIds = Array.from(
            new Set([...selectedIdsFromOtherPages, ...selectedIds])
          );
          onSelectionChange(combinedSelectedIds);
        } else {
          setSelectedCaseIdsForBulkEdit(selectedIds);
        }
      } else {
        // Regular click - toggle single row
        const newSelection = { ...rowSelection };
        newSelection[rowIndex.toString()] = !newSelection[rowIndex.toString()];
        handleTableRowSelectionChange(() => newSelection);

        // Update last selected index only if selecting (not deselecting)
        if (!rowSelection[rowIndex.toString()]) {
          setLastSelectedIndex(rowIndex);
        }
      }
    },
    [
      cases,
      isMultiConfigMode,
      lastSelectedIndex,
      rowSelection,
      handleTableRowSelectionChange,
      isSelectionMode,
      onSelectionChange,
      selectedTestCases,
      setSelectedCaseIdsForBulkEdit,
    ]
  );

  // Handle select all checkbox click with shift support
  const handleSelectAllClick = useCallback(
    (event: React.MouseEvent) => {
      const MappedCases = cases ?? [];

      if (event.shiftKey) {
        // Shift+Click: Select/Deselect all cases across all pages
        const _selectableRows = MappedCases.filter((tc) => !tc.isDeleted);
        const selectableIndices = MappedCases.map((tc, index) =>
          !tc.isDeleted ? index : null
        ).filter((index) => index !== null) as number[];

        const allSelectableSelected = selectableIndices.every(
          (index) => rowSelection[index.toString()]
        );

        // Search takes the same path as everything else now: the ids come from
        // the intersected route result, never from the raw Elasticsearch set
        // (which still holds archived, policy-hidden and filtered-out cases).
        if (allSelectableSelected) {
          // Deselect all cases across all pages
          setFetchAllIdsForSelection(true);
          setSelectAllAction("deselect");
        } else {
          // Select all cases across all pages
          setFetchAllIdsForSelection(true);
          setSelectAllAction("select");
        }
      } else {
        // Regular click: Toggle selection for current page only
        const selectableRows = MappedCases.filter((tc) => !tc.isDeleted);
        const selectableIndices = MappedCases.map((tc, index) =>
          !tc.isDeleted ? index : null
        ).filter((index) => index !== null) as number[];

        const allSelectableSelected = selectableIndices.every(
          (index) => rowSelection[index.toString()]
        );

        if (allSelectableSelected) {
          // Deselect all on current page
          const newSelection = { ...rowSelection };
          selectableIndices.forEach((index) => {
            delete newSelection[index.toString()];
          });
          setRowSelection(newSelection);

          const getDeselectCaseId = (tc: (typeof MappedCases)[number]) =>
            isMultiConfigMode && (tc as MaybeRunModeCase).testRunCaseId
              ? (tc as MaybeRunModeCase).testRunCaseId
              : tc.id;
          const currentPageIds = selectableRows.map(getDeselectCaseId);

          if (isSelectionMode && onSelectionChange) {
            // Remove current page IDs from selection
            onSelectionChange(
              selectedTestCases.filter((id) => !currentPageIds.includes(id))
            );
          } else {
            // For bulk edit mode, remove current page IDs from selection
            setSelectedCaseIdsForBulkEdit(
              selectedCaseIdsForBulkEdit.filter(
                (id) => !currentPageIds.includes(id)
              )
            );
          }
        } else {
          // Select all selectable rows on current page
          const newSelection: RowSelectionState = { ...rowSelection };
          selectableIndices.forEach((index) => {
            newSelection[index.toString()] = true;
          });
          setRowSelection(newSelection);

          const getSelectAllCaseId = (tc: (typeof MappedCases)[number]) =>
            isMultiConfigMode && (tc as MaybeRunModeCase).testRunCaseId
              ? (tc as MaybeRunModeCase).testRunCaseId
              : tc.id;
          const selectedIds = selectableRows.map(getSelectAllCaseId);

          if (isSelectionMode && onSelectionChange) {
            // Add current page IDs to existing selection
            const currentPageIds = MappedCases.map(getSelectAllCaseId);
            const selectedIdsFromOtherPages = selectedTestCases.filter(
              (id) => !currentPageIds.includes(id)
            );
            const combinedSelectedIds = Array.from(
              new Set([...selectedIdsFromOtherPages, ...selectedIds])
            );
            onSelectionChange(combinedSelectedIds);
          } else {
            // For bulk edit mode, add to existing selection
            const combinedSelectedIds = Array.from(
              new Set([...selectedCaseIdsForBulkEdit, ...selectedIds])
            );
            setSelectedCaseIdsForBulkEdit(combinedSelectedIds);
          }
        }
      }
    },
    [
      cases,
      isMultiConfigMode,
      rowSelection,
      isSelectionMode,
      onSelectionChange,
      selectedTestCases,
      selectedCaseIdsForBulkEdit,
      setSelectedCaseIdsForBulkEdit,
    ]
  );

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const timeFormat = session?.user?.preferences?.timeFormat;
  const userPreferencesForColumns = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone, timeFormat } } }),
    [dateFormat, timezone, timeFormat]
  );

  const handleCopyMove = useCallback((caseIds?: number[]) => {
    if (caseIds) {
      setSelectedCaseIdsForBulkEdit(caseIds);
    }
    setIsCopyMoveOpen(true);
  }, []);

  // Open dialog in folder mode when copyMoveFolderId prop is set by ProjectRepository
  useEffect(() => {
    if (copyMoveFolderId != null) {
      setActiveCopyMoveFolderId(copyMoveFolderId);
      setActiveCopyMoveFolderName(copyMoveFolderName ?? "");
      setIsCopyMoveOpen(true);
    }
  }, [copyMoveFolderId, copyMoveFolderName]);

  const columns: CustomColumnDef<any>[] = useMemo(() => {
    return getColumns(
      userPreferencesForColumns,
      uniqueCaseFieldList,
      handleSelect,
      {
        name: t("common.name"),
        estimate: t("common.fields.estimate"),
        state: t("common.fields.state"),
        automated: t("common.fields.automated"),
        template: t("common.fields.template"),
        createdAt: t("common.fields.createdAt"),
        createdBy: t("common.fields.createdBy"),
        attachments: t("common.fields.attachments"),
        steps: t("common.fields.steps"),
        tags: t("common.fields.tags"),
        actions: t("common.actions.actionsLabel"),
        status: t("common.actions.status"),
        assignedTo: t("common.fields.assignedTo"),
        unassigned: t("common.labels.unassigned"),
        selectCase: t("repository.columns.selectCase"),
        testRuns: t("enums.ApplicationArea.TestRuns"),
        runOrder: t("repository.columns.runOrder"),
        issues: t("common.fields.issues"),
        forecast: t("common.fields.forecast"),
        id: t("common.fields.id"),
        linkedCases: t("repository.fields.linkedCases"),
        versions: t("common.fields.version"),
        clickToViewFullContent: t("repository.fields.clickToViewFullContent"),
        comments: t("comments.title"),
        configuration: t("common.fields.configuration"),
        latestResults: t("repository.columns.latestResults"),
        newBadge: t("common.labels.new"),
      },
      isRunMode,
      isSelectionMode,
      onTestCaseClick,
      viewType,
      runId,
      isCompleted,
      canAddEditResults,
      canDelete,
      canAddEditRun,
      sortConfig, // Pass sortConfig here
      handleCheckboxClick, // Pass the checkbox click handler
      handleSelectAllClick, // Pass the select all handler
      // Callback to open AddResultModal from StatusCell
      (modalData) => {
        setAddResultModalState({
          isOpen: true,
          ...modalData,
          configuration:
            modalData.configuration !== undefined
              ? modalData.configuration
              : testRunData?.configuration || null,
        });
      },
      // Pass isMultiConfigRun flag
      selectedRunIds && selectedRunIds.length > 1,
      // Pass totalItems for shift+click tooltip
      totalItems,
      // Pass selectedCount for determining if all are selected
      isSelectionMode
        ? selectedTestCases.length
        : selectedCaseIdsForBulkEdit.length,
      // Pass enableReorder to show/hide grip handle
      // Disabled in multi-config mode: ordering a merged view of multiple runs is undefined.
      // Disabled when the run's composition is locked: reordering is frozen.
      isDefaultSort &&
        !isSelectionMode &&
        !isCompleted &&
        !compositionLocked &&
        !isMultiConfigMode &&
        ((isRunMode && canAddEditRun) || (!isRunMode && canAddEdit)),
      // QuickScript per-row action
      quickScriptEnabled,
      canAddEdit,
      (caseId: number) => {
        setQuickScriptCaseIds([caseId]);
        setIsQuickScriptModalOpen(true);
      },
      // Copy/Move per-row action (only when user has write access and multiple projects)
      showCopyMove
        ? (caseId: number) => {
            handleCopyMove([caseId]);
          }
        : undefined,
      // Show descendants mode - display folder badge on each case
      showDescendants,
      folderPathMap,
      renderPendingBadge,
      renderLatestResults,
      excludeNotStartedFromRuns
    );
  }, [
    userPreferencesForColumns,
    uniqueCaseFieldList,
    handleSelect,
    t,
    isRunMode,
    isSelectionMode,
    onTestCaseClick,
    viewType,
    runId,
    isCompleted,
    canAddEditResults,
    canDelete,
    canAddEditRun,
    canAddEdit,
    isDefaultSort,
    sortConfig,
    handleCheckboxClick,
    handleSelectAllClick,
    testRunData?.configuration,
    selectedRunIds,
    totalItems,
    selectedTestCases.length,
    selectedCaseIdsForBulkEdit.length,
    quickScriptEnabled,
    handleCopyMove,
    showCopyMove,
    showDescendants,
    folderPathMap,
    renderPendingBadge,
    renderLatestResults,
    excludeNotStartedFromRuns,
    compositionLocked,
    isMultiConfigMode,
  ]);

  // Create lightweight column metadata for ColumnSelection component
  // This avoids passing the full column definitions with all their render functions
  const columnMetadata: ColumnMetadata[] = useMemo(() => {
    return columns.map((column) => ({
      id: column.id as string,
      label: typeof column.header === "string" ? column.header : "",
      isVisible: column.meta?.isVisible,
      enableHiding: column.enableHiding,
    }));
  }, [columns]);

  const pageSizeOptions: PageSizeOption[] = useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);

  // Initialize column visibility with a memoized function
  const getInitialColumnVisibility = useMemo(() => {
    if (columns.length === 0) return {};

    const columnVisibilityQuery = searchParams.get("columns");
    const initialVisibility: Record<string, boolean> = {};

    columns.forEach((column) => {
      // Always show columns that cannot be hidden
      if (column.enableHiding === false) {
        initialVisibility[column.id as string] = true;
      } else {
        // For other columns, use the existing logic
        if (
          column.id === columns[0].id ||
          column.id === columns[columns.length - 1].id
        ) {
          initialVisibility[column.id as string] = true;
        } else {
          initialVisibility[column.id as string] =
            column.meta?.isVisible ?? true;
        }
      }
    });

    if (columnVisibilityQuery && columnVisibilityQuery !== "none") {
      const visibleColumns = columnVisibilityQuery.split(",");
      columns.forEach((column) => {
        // Skip columns that cannot be hidden
        if (column.enableHiding === false) {
          return;
        }
        // Skip first and last columns
        if (
          column.id !== columns[0].id &&
          column.id !== columns[columns.length - 1].id
        ) {
          initialVisibility[column.id as string] = visibleColumns.includes(
            column.id as string
          );
        }
      });
    }

    return initialVisibility;
  }, [columns, searchParams]);

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(getInitialColumnVisibility);

  // Only reset page if we have valid totalItems and we're truly beyond the last page
  // Add a small delay to prevent resetting during query refetches
  useEffect(() => {
    if (totalItems === undefined || totalItems === 0) {
      // Don't reset page when totalItems is loading or empty
      return;
    }

    const effectivePageSize =
      typeof pageSize === "number" ? pageSize : totalItems;
    const totalPages = Math.ceil(totalItems / effectivePageSize);

    if (currentPage > totalPages) {
      // Use a small timeout to avoid resetting during transient states
      const timeoutId = setTimeout(() => {
        setCurrentPage(Math.max(1, totalPages));
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [totalItems, currentPage, pageSize, setCurrentPage]);

  // Separate effect for page reset to avoid interfering with search input
  useEffect(() => {
    if (deferredSearchString !== searchString) {
      startTransition(() => {
        setCurrentPage(1);
      });
    }
  }, [deferredSearchString, searchString, setCurrentPage]);

  const handlePageSizeChange = (value: string | number) => {
    const newSize =
      value === "All" ? totalItems : parseInt(value.toString(), 10);
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const handleReorder = async (dragIndex: number, hoverIndex: number) => {
    const originalCases = cases; // Use current state 'cases' as the source of truth for this operation
    const draggedItem = originalCases[dragIndex];

    if (!draggedItem) {
      return;
    }

    let reorderedCases: any[];

    // Check if the dragged item is part of the selection and there's a selection
    const isDraggingSelectedBlock =
      selectedCaseIdsForBulkEdit.includes(draggedItem.id) &&
      selectedCaseIdsForBulkEdit.length > 0;

    // Check if selected items span multiple pages
    if (isDraggingSelectedBlock) {
      const currentPageIds = new Set(originalCases.map((c) => c.id));
      const selectedItemsOnOtherPages = selectedCaseIdsForBulkEdit.filter(
        (id) => !currentPageIds.has(id)
      );

      if (selectedItemsOnOtherPages.length > 0) {
        toast.error(t("repository.cases.cannotReorderAcrossPages"));
        return;
      }
    }

    if (isDraggingSelectedBlock) {
      // Logic for dragging a selected item (potentially as part of a block)
      const selectedItemsGroup: any[] = [];
      // Extract selected items, maintaining their original relative order
      originalCases.forEach((item) => {
        if (selectedCaseIdsForBulkEdit.includes(item.id)) {
          selectedItemsGroup.push(item);
        }
      });
      const remainingItems = originalCases.filter(
        (item) => !selectedCaseIdsForBulkEdit.includes(item.id)
      );
      // Determine the target insertion index in the 'remainingItems' list.
      let targetInsertionPointInRemaining = 0;
      for (let i = 0; i < hoverIndex; i++) {
        if (
          i < originalCases.length &&
          !selectedCaseIdsForBulkEdit.includes(originalCases[i].id)
        ) {
          targetInsertionPointInRemaining++;
        }
      }
      const tempReorderedCases = [...remainingItems];
      tempReorderedCases.splice(
        targetInsertionPointInRemaining,
        0,
        ...selectedItemsGroup
      );
      reorderedCases = tempReorderedCases;
    } else {
      // Original logic for dragging a single, unselected item
      // This logic correctly handles moving a single item relative to hoverIndex.
      const tempReorderedCases = [...originalCases];
      const [movedItem] = tempReorderedCases.splice(dragIndex, 1);

      // If dragIndex > hoverIndex, hoverIndex remains the same in the list of N-1 items.
      // However, to be safe and clear, let's use the original logic's targetIndex.
      const targetIndex = dragIndex < hoverIndex ? hoverIndex - 1 : hoverIndex;
      tempReorderedCases.splice(targetIndex, 0, movedItem);
      reorderedCases = tempReorderedCases;
    }

    // Calculate new order values for the reordered cases
    const isAllPageSize = typeof pageSize !== "number";
    const baseOrder = isAllPageSize ? 0 : (currentPage - 1) * (pageSize || 0);

    const reorderedCasesWithNewOrder = reorderedCases.map((item, index) => ({
      ...item,
      order: isAllPageSize ? index + 1 : baseOrder + index + 1,
    }));

    // Set optimistic state immediately for instant UI feedback
    setOptimisticReorder({
      inProgress: true,
      cases: reorderedCasesWithNewOrder,
    });

    // --- Backend Update Logic ---
    try {
      if (isRunMode) {
        if (!testRunCasesData) {
          console.error("Missing testRunCasesData for reordering in run mode");
          return;
        }

        const updates = reorderedCases
          .map((item, index) => {
            // testRunCaseId is only present in run mode
            const testRunCaseIdToUpdate = (item as MaybeRunModeCase)
              .testRunCaseId;
            if (testRunCaseIdToUpdate && item.order !== index + 1) {
              return updateTestRunCases({
                where: { id: testRunCaseIdToUpdate },
                data: { order: index + 1 },
              });
            }
            const originalTrCase = testRunCasesData.find(
              (trc) => trc.repositoryCaseId === item.id
            );
            if (originalTrCase && originalTrCase.order !== index + 1) {
              return updateTestRunCases({
                where: { id: originalTrCase.id },
                data: { order: index + 1 },
              });
            }
            return null;
          })
          .filter(Boolean);

        if (updates.length > 0) {
          await Promise.all(updates as Promise<any>[]);
        }
      } else {
        // Update RepositoryCases order
        const updates = reorderedCasesWithNewOrder
          .map((item) => {
            if (
              item.order !== originalCases.find((c) => c.id === item.id)?.order
            ) {
              return updateRepositoryCases({
                where: { id: item.id },
                data: { order: item.order },
              });
            }
            return null;
          })
          .filter(Boolean);

        if (updates.length > 0) {
          await Promise.all(updates as Promise<any>[]);
        }
      }

      // Clear optimistic state after a delay to allow smooth transition
      setTimeout(() => {
        setOptimisticReorder({ inProgress: false, cases: null });
      }, 100);

      // Clear selection after successful reorder
      setRowSelection({});
      setSelectedCaseIdsForBulkEdit([]);
    } catch (error) {
      console.error("Failed to reorder cases", error);
      toast.error(t("common.errors.somethingWentWrong"));

      // Clear optimistic state immediately on error
      setOptimisticReorder({ inProgress: false, cases: null });

      // If needed, we can still manually refetch to ensure consistency
      await refetchData();
    }
  };

  const handleCloseBulkEditModal = (refetchNeeded?: boolean) => {
    setIsBulkEditModalOpen(false);
    if (refetchNeeded) {
      void refetchRepositoryCases(); // list, count and id list in one go
      // Clear selection after successful bulk edit operation
      setRowSelection({});
      setSelectedCaseIdsForBulkEdit([]);
    }
  };

  // In-place Add Test Run wizard seed — non-null mounts the modal.
  const [createRunSeedIds, setCreateRunSeedIds] = useState<number[] | null>(
    null
  );

  // Add the handler for the new button
  const handleCreateTestRun = useCallback(async () => {
    if (selectedCaseIdsForBulkEdit.length === 0 || !isValidProjectId) return;

    let idsToSeed = selectedCaseIdsForBulkEdit;

    if (excludeNotStartedFromRuns) {
      try {
        const params = new URLSearchParams({
          q: JSON.stringify({
            where: {
              id: { in: selectedCaseIdsForBulkEdit },
              state: { workflowType: { not: "NOT_STARTED" } },
            },
            select: { id: true },
          }),
        });
        const resp = await fetch(
          `/api/model/repositoryCases/findMany?${params.toString()}`,
          { credentials: "include" }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json();
        const eligibleIds: number[] = (body?.data ?? []).map(
          (c: { id: number }) => c.id
        );
        const skippedCount =
          selectedCaseIdsForBulkEdit.length - eligibleIds.length;
        if (skippedCount > 0) {
          toast.info(
            t("projects.settings.advanced.excludeNotStarted.skippedToast", {
              count: skippedCount,
            })
          );
        }
        if (eligibleIds.length === 0) return;
        idsToSeed = eligibleIds;
      } catch (err) {
        console.error(
          "[exclude-not-started] failed to filter selected cases:",
          err
        );
      }
    }

    // Open the Add Test Run wizard in place — no navigation to the runs
    // page, so cancelling doesn't strand the user; the wizard's own toasts
    // report success/failure.
    setCreateRunSeedIds(idsToSeed);
  }, [
    selectedCaseIdsForBulkEdit,
    isValidProjectId,
    excludeNotStartedFromRuns,
    t,
  ]);

  // *** Prepare for useExportData Hook ***
  // Wrapper function to call the server action
  const fetchAllDataForHook = useCallback(
    async (options?: ExportOptions) => {
      // Note: When scope is "selected", we still fetch "allFiltered" data
      // because the useExportData hook will filter it to selected IDs
      const actionScope =
        options?.scope === "allProject" ? "allProject" : "allFiltered";

      const response = await fetchAllCasesAction({
        orderBy,
        where: repositoryCaseWhereClause,
        scope: actionScope,
        projectId: projectId,
        // Text/link/steps operator filters are applied post-fetch (the where
        // clause only pre-filters value-not-null); the action runs the same
        // matchers so "all filtered" exports match the table's row set.
        postFetchFilters:
          postFetchFilters.length > 0 ? postFetchFilters : undefined,
        // "All filtered" during an active search means the intersection, not
        // the un-searched superset (spec §9). Rows come back in `orderBy`
        // order, not relevance — export files carry no ranking.
        searchCaseIds: searchResultIds ?? undefined,
      });

      if (response.success) {
        return response.data; // Return only the data array on success
      } else {
        // Handle error: log it and return empty array or throw
        console.error("Error fetching data for export:", response.error);
        // Optionally, you could show a toast notification here
        return []; // Or throw new Error(response.error);
      }
    },
    [
      orderBy,
      repositoryCaseWhereClause,
      projectId,
      postFetchFilters,
      searchResultIds,
    ]
  );

  // Instantiate the hook
  const { handleExport, isExporting: _isExporting } = useExportData<any>({
    fetchAllData: fetchAllDataForHook,
    currentData: cases,
    selectedIds: selectedCaseIdsForBulkEdit,
    columns: columns,
    columnVisibility: columnVisibility,
    fileNamePrefix: "testplanit-cases",
    t: t as TFunction,
    project: data?.[0]?.project,
    isRunMode: isRunMode,
    testRunCasesData: testRunCasesData,
    isDefaultSort: isDefaultSort,
  });

  // Compute selectedItemsForDrag for drag-and-drop
  // Include ALL selected cases, even if they're on other pages
  const selectedItemsForDrag = useMemo(() => {
    const sourceIds = isSelectionMode
      ? selectedTestCases
      : selectedCaseIdsForBulkEdit;

    // Map all selected IDs to drag items
    // For cases on current page, include the name; for others, just the ID
    const currentPageCasesMap = new Map(cases.map((c) => [c.id, c.name]));

    return sourceIds.map((id) => ({
      id,
      name: currentPageCasesMap.get(id) || `Case ${id}`,
    }));
  }, [cases, isSelectionMode, selectedTestCases, selectedCaseIdsForBulkEdit]);

  if (status !== "loading" && !session) {
    router.push("/");
    return null;
  }

  if (status === "loading") return null;

  // Render invalid project ID message if needed
  if (!isValidProjectId) {
    return (
      <div className="text-muted-foreground text-pretty m-2">
        {t("repository.cases.invalidProject")}
      </div>
    );
  }

  // Main persistent Card structure
  return (
    <Card className="border-0">
      <CardHeader>
        <div ref={casesHeaderRef} className="flex flex-row items-start">
          <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
            {/* filterComponent should always be rendered if we've reached this point */}
            {filterComponent}
            {/* Which order the rows are in is otherwise invisible: a remembered
                per-project sort silently outranks relevance, so say when
                relevance is what's on screen (spec §9). Lives here rather than
                in the FilterBar because only this component owns the sort. */}
            {useRelevanceOrder && (
              <div
                className="mt-1 text-xs text-muted-foreground italic"
                data-testid="sorted-by-relevance"
              >
                {t("repository.filterBar.sortedByRelevance")}
              </div>
            )}
            <div className="mt-4">
              <ColumnSelection
                key="repository-cases-column-selection"
                storageKey={`repository-cases:${projectId}`}
                columns={columns}
                columnMetadata={columnMetadata}
                hideColumnRef={columnHideRef}
                onVisibilityChange={handleColumnVisibilityChange}
              />
            </div>
          </div>

          <div
            ref={setPaginationFooterRef}
            className="flex flex-col w-full sm:w-2/3 items-end"
          >
            {isSelectionMode && onSelectionChange && !hideHeader && (
              <div className="mb-4">
                <SelectedTestCasesDrawer
                  selectedTestCases={selectedTestCases}
                  onSelectionChange={onSelectionChange}
                  projectId={projectId}
                />
              </div>
            )}
            <div className="justify-end">
              <PaginationInfo
                key="project-pagination-info"
                startIndex={startIndex}
                endIndex={endIndex}
                totalRows={totalItems}
                searchString={searchString}
                pageSize={typeof pageSize === "number" ? pageSize : "All"}
                pageSizeOptions={pageSizeOptions}
                handlePageSizeChange={handlePageSizeChange}
                compact={paginationCompact}
              />
            </div>
            <div className="justify-end -mx-4">
              <PaginationComponent
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                compact={paginationCompact}
              />
            </div>
            <div className="flex gap-2 pt-2 items-center -mb-2">
              <ActionOverflow
                compact={casesToolbarCompact}
                menuLabel={t("common.actions.actionsLabel")}
                menuTestId="cases-actions-menu"
                actions={[
                  {
                    key: "bulkEdit",
                    icon: PenSquare,
                    label: `${t("repository.cases.bulkEdit")} (${selectedCaseIdsForBulkEdit.length})`,
                    onClick: () => setIsBulkEditModalOpen(true),
                    hidden: !(
                      canAddEdit &&
                      !isSelectionMode &&
                      !isRunMode &&
                      selectedCaseIdsForBulkEdit.length > 0
                    ),
                    testId: "bulk-edit-button",
                  },
                  {
                    key: "autoTag",
                    icon: Tags,
                    label: `${t("autoTag.actions.aiAutoTag")} (${selectedCaseIdsForBulkEdit.length})`,
                    onClick: () => setIsAutoTagOpen(true),
                    hidden: !(
                      canAddEdit &&
                      hasLlmIntegration &&
                      !isSelectionMode &&
                      !isRunMode &&
                      selectedCaseIdsForBulkEdit.length > 0
                    ),
                    testId: "auto-tag-cases-button",
                  },
                  {
                    key: "createRun",
                    icon: PlayCircle,
                    label: `${t("repository.cases.createTestRun")} (${selectedCaseIdsForBulkEdit.length})`,
                    onClick: handleCreateTestRun,
                    hidden: !(
                      !isRunMode &&
                      !isSelectionMode &&
                      canAddEditRun &&
                      selectedCaseIdsForBulkEdit.length > 0
                    ),
                    testId: "create-test-run-button",
                  },
                  {
                    key: "copyMove",
                    icon: ArrowRightLeft,
                    label: `${t("repository.cases.copyMoveToProject")} (${selectedCaseIdsForBulkEdit.length})`,
                    onClick: () => setIsCopyMoveOpen(true),
                    hidden: !(
                      showCopyMove &&
                      !isSelectionMode &&
                      !isRunMode &&
                      selectedCaseIdsForBulkEdit.length > 0
                    ),
                    testId: "copy-move-button",
                  },
                  {
                    key: "export",
                    icon: Upload,
                    label: t("repository.cases.export"),
                    onClick: () => setIsExportModalOpen(true),
                    disabled: totalItems === 0,
                    hidden: !(canAddEdit && !isSelectionMode && !isRunMode),
                    testId: "export-cases-button",
                  },
                  {
                    key: "quickScript",
                    icon: ScrollText,
                    label: t("repository.cases.quickScript"),
                    onClick: () => {
                      setQuickScriptCaseIds(null);
                      setIsQuickScriptModalOpen(true);
                    },
                    hidden: !(
                      canAddEdit &&
                      quickScriptEnabled &&
                      !isSelectionMode &&
                      !isRunMode &&
                      selectedCaseIdsForBulkEdit.length > 0
                    ),
                    testId: "quickscript-cases-button",
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {(() => {
          // A search that could not be resolved is terminal: its ids are an
          // AND'd filter, so there is no honest list to show. Anything else
          // here would be the unfiltered repository presented as the search
          // result (spec §9).
          if (searchFailed) {
            return (
              <div
                className="text-muted-foreground text-pretty m-2"
                data-testid="search-failed-message"
              >
                {t("search.errors.searchFailed")}
              </div>
            );
          }

          // Handle preliminary states first (where DataTable might not be relevant)
          // Skip folder check when ES search results are active or predicates
          // are set — active filters query project-wide (spec §7.1).
          if (
            !folderId &&
            viewType === "folders" &&
            !searchResultIds &&
            !searchPending &&
            predicates.length === 0
          ) {
            return (
              <div className="text-muted-foreground text-pretty m-2">
                {t("repository.cases.selectFolder")}
              </div>
            );
          }

          // If loading or column visibility not initialized, DataTable will show its own skeleton
          if (
            isLoading ||
            isTotalLoading ||
            isTemplatesLoading ||
            Object.keys(columnVisibility).length === 0
          ) {
            return (
              <DataTable
                key={`${folderId}-${viewType}-${predicatesKey}-loading`}
                columns={columns}
                data={[]} // Pass empty data while loading
                onSortChange={isCompleted ? undefined : handleSortChange}
                onSortColumn={isCompleted ? undefined : handleSortColumn}
                onHideColumn={(columnId) => columnHideRef.current?.(columnId)}
                sortConfig={isCompleted ? undefined : sortConfig}
                enableReorder={false} // No reorder while loading
                onReorder={handleReorder}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={handleColumnVisibilityChange}
                isLoading={true}
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                storageKey={`repository-cases:${projectId}`}
              />
            );
          }

          // Handle empty states after loading and not in preliminary states
          if (cases.length === 0) {
            // Active filters are the likeliest cause of an empty result set —
            // say so and offer the way out, in every mode.
            if (predicates.length > 0) {
              return (
                <div className="m-2 flex flex-col items-start space-y-2">
                  <div className="text-muted-foreground text-pretty">
                    {t("repository.filterBar.noMatchingCases")}
                  </div>
                  {onClearFilters && (
                    <Button variant="ghost" size="sm" onClick={onClearFilters}>
                      {t("common.actions.clearAll")}
                    </Button>
                  )}
                </div>
              );
            }
            if (isRunMode) {
              if (viewType === "folders" && folderId) {
                // Case: In a folder in run mode, no cases
                return (
                  <div className="text-muted-foreground text-pretty m-2">
                    {t("repository.cases.noTestCases")}
                  </div>
                );
              } // Case: Run mode, no specific folder (e.g. "all selected"), no cases
              return (
                <div className="text-muted-foreground text-pretty m-2">
                  {t("common.labels.noTestCasesSelected")}
                </div>
              );
            }
            // Default "no test cases" if not covered by more specific messages above
            return (
              <>
                <div className="m-1 mb-4 text-muted-foreground">
                  {t("repository.cases.noTestCases")}
                </div>
              </>
            );
          }

          // Default content: DataTable with data
          return (
            <>
              <DataTable
                key={`${folderId}-${viewType}-${predicatesKey}-datatable`}
                columns={columns}
                data={cases}
                storageKey={`repository-cases:${projectId}`}
                selectedRowId={
                  selectedCaseIdParam ? Number(selectedCaseIdParam) : null
                }
                scrollToSelectedRow={false}
                onSortChange={isCompleted ? undefined : handleSortChange}
                onSortColumn={isCompleted ? undefined : handleSortColumn}
                onHideColumn={(columnId) => columnHideRef.current?.(columnId)}
                sortConfig={isCompleted ? undefined : sortConfig}
                enableReorder={
                  isDefaultSort &&
                  // Rows sit in relevance order during a search, so a drag
                  // would compute `order` values from relevance-ordered
                  // neighbours and corrupt the persisted case order. Filter
                  // chips do NOT disable reordering (parity with the pre-chip
                  // ViewSelector filters) — they narrow the set without
                  // changing its order.
                  !searchActive &&
                  !isSelectionMode &&
                  !isCompleted &&
                  !compositionLocked &&
                  !isMultiConfigMode &&
                  ((isRunMode && canAddEditRun) || (!isRunMode && canAddEdit))
                }
                onReorder={handleReorder}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={handleColumnVisibilityChange}
                isLoading={false} // Explicitly false as loading is handled above
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                rowSelection={rowSelection}
                onRowSelectionChange={handleTableRowSelectionChange}
                selectedItemsForDrag={selectedItemsForDrag}
              />
            </>
          );
        })()}
        {/* Render the inline add-case row once, outside the loading/empty/
            populated branch swap above, so it is never unmounted when the
            folder transitions empty→populated (adding the first case). A
            remount there discards the just-restored input focus. */}
        {!isSelectionMode && !isRunMode && folderId && canAddEdit && (
          <AddCaseRow folderId={folderId} />
        )}
        {selectedAttachmentIndex !== null && (
          <AttachmentsCarousel
            attachments={selectedAttachments}
            initialIndex={selectedAttachmentIndex}
            onClose={handleClose}
            canEdit={canAddEdit}
          />
        )}
      </CardContent>

      {/* Bulk Edit Modal */}
      {isValidProjectId && (
        <BulkEditModal
          isOpen={isBulkEditModalOpen}
          onClose={() => handleCloseBulkEditModal(false)}
          onSaveSuccess={() => handleCloseBulkEditModal(true)}
          selectedCaseIds={selectedCaseIdsForBulkEdit}
          projectId={projectId}
          onCopyMove={
            showCopyMove
              ? () => {
                  setIsBulkEditModalOpen(false);
                  setIsCopyMoveOpen(true);
                }
              : undefined
          }
        />
      )}

      {/* Export Modal */}
      {isValidProjectId && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          onExport={handleExport}
          totalCases={totalItems}
          selectedCaseIds={selectedCaseIdsForBulkEdit}
          totalProjectCases={totalProjectCases}
        />
      )}

      {/* Copy/Move Dialog */}
      {isValidProjectId && (
        <CopyMoveDialog
          open={isCopyMoveOpen}
          onOpenChange={(open) => {
            setIsCopyMoveOpen(open);
            if (!open && activeCopyMoveFolderId != null) {
              setActiveCopyMoveFolderId(null);
              setActiveCopyMoveFolderName("");
              onCopyMoveFolderDialogClose?.();
            }
          }}
          selectedCaseIds={selectedCaseIdsForBulkEdit}
          sourceProjectId={projectId}
          sourceFolderId={activeCopyMoveFolderId ?? undefined}
          sourceFolderName={activeCopyMoveFolderName || undefined}
        />
      )}

      {/* QuickScript Modal */}
      {isValidProjectId && isQuickScriptModalOpen && (
        <QuickScriptModal
          isOpen={isQuickScriptModalOpen}
          onClose={() => {
            setIsQuickScriptModalOpen(false);
            setQuickScriptCaseIds(null);
          }}
          selectedCaseIds={quickScriptCaseIds ?? selectedCaseIdsForBulkEdit}
          projectId={projectId}
        />
      )}

      {/* Auto-Tag Dialog */}
      {isValidProjectId && (
        <AutoTagWizardDialog
          open={isAutoTagOpen}
          onOpenChange={setIsAutoTagOpen}
          projectId={String(projectId)}
          caseIds={selectedCaseIdsForBulkEdit}
          sessionIds={[]}
          runIds={[]}
          autoStart
        />
      )}

      {/* AddResultModal - lifted from StatusCell to prevent re-render issues */}
      {addResultModalState.isOpen && addResultModalState.testRunId && (
        <AddResultModal
          isOpen={addResultModalState.isOpen}
          onClose={() => {
            setAddResultModalState({ isOpen: false });
            // Dispatch modal close event for other listeners
            const event = new CustomEvent("modalStateChange", {
              detail: { isOpen: false },
            });
            window.dispatchEvent(event);
          }}
          testRunId={addResultModalState.testRunId}
          testRunCaseId={
            addResultModalState.isBulkResult
              ? undefined
              : addResultModalState.testRunCaseId
          }
          caseName={addResultModalState.caseName || ""}
          projectId={addResultModalState.projectId || 0}
          defaultStatusId={addResultModalState.defaultStatusId}
          isBulkResult={addResultModalState.isBulkResult}
          selectedCases={addResultModalState.selectedCases}
          steps={
            addResultModalState.isBulkResult
              ? undefined
              : addResultModalState.steps
          }
          configuration={addResultModalState.configuration}
        />
      )}

      {createRunSeedIds && (
        <AddTestRunModal
          open
          onClose={() => setCreateRunSeedIds(null)}
          initialSelectedCaseIds={createRunSeedIds}
          onSelectedCasesChange={(cases: number[]) =>
            setCreateRunSeedIds(cases)
          }
        />
      )}
    </Card>
  );
}
