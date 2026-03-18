"use client";

import BreadcrumbComponent from "@/components/BreadcrumbComponent";
import { useDebounce } from "@/components/Debounce";
import { UnifiedDragPreview } from "@/components/dnd/UnifiedDragPreview";
import { PageFileDropOverlay } from "@/components/PageFileDropOverlay";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from "@/components/ui/resizable";
import { SimpleDndProvider } from "@/components/ui/SimpleDndProvider";
import { ViewSelector } from "@/components/ViewSelector";
import { ApplicationArea } from "@prisma/client";
import { useQuery } from "@tanstack/react-query";
import {
  Bot, Bug, Calendar, ChevronLeft, ChevronRight, ChevronsUpDown, CircleCheckBig, FolderTree, Hash, LayoutTemplate, Link, ListChecks, ListOrdered, Search, SquareCheckBig, Tags, Type, User, UserCog, Workflow, X
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import * as React from "react";
import {
  useCallback, useDeferredValue, useEffect, useMemo, useRef, useState
} from "react";
import { ImperativePanelHandle } from "react-resizable-panels";
import { emptyEditorContent } from "~/app/constants";
import { ProjectIcon } from "~/components/ProjectIcon";
import { usePageFileDrop } from "~/hooks/usePageFileDrop";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  PaginationProvider,
  usePagination
} from "~/lib/contexts/PaginationContext";
import {
  useFindFirstProjects,
  useFindFirstRepositories,
  useFindManyRepositoryCases,
  useFindManyTestRunCases
} from "~/lib/hooks";
import { usePathname, useRouter } from "~/lib/navigation";
import { useFolderStats } from "~/lib/useFolderStats";
import { AddCaseModal } from "./AddCase";
import { AddFolderModal } from "./AddFolder";
import Cases from "./Cases";
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
    <SimpleDndProvider>
      <UnifiedDragPreview />
      {children}
    </SimpleDndProvider>
  );
};

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

  const router = useRouter();
  const pathName = usePathname();
  const { data: session, status: sessionStatus } = useSession();

  // Use the validated numericProjectId here
  const { permissions: projectPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, "TestCaseRepository");

  // Fetch permissions specifically for Test Runs
  const {
    permissions: testRunPermissions,
  } = useProjectPermissions(numericProjectId, "TestRuns");

  const _ALL_VALUES_FILTER = "__ALL__"; // Special value for All Values filter

  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    nodeParam ? parseInt(nodeParam, 10) : null
  );

  const [panelWidth, setPanelWidth] = useState<number>(100);
  const [folderHierarchy, setFolderHierarchy] = useState<FolderNode[]>([]);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const panelRef = useRef<ImperativePanelHandle>(null);
  const refetchFoldersRef = useRef<(() => Promise<unknown>) | null>(null);
  // Ref for scoping DnD events when used in portaled contexts (modals)
  const dndContainerRef = useRef<HTMLDivElement>(null);

  // Elasticsearch-powered search state (for selection mode)
  const [esSearchQuery, setEsSearchQuery] = useState("");
  const debouncedEsSearchQuery = useDebounce(esSearchQuery, 300);
  const [esSearchResultIds, setEsSearchResultIds] = useState<number[] | null>(null);
  const [_esSearchLoading, setEsSearchLoading] = useState(false);
  const [_esSearchTotal, setEsSearchTotal] = useState<number>(0);
  // Tracks whether the panel was already collapsed before search started.
  // null = not currently in a search-initiated collapse.
  const wasCollapsedBeforeSearchRef = useRef<boolean | null>(null);

  const t = useTranslations();

  // Sync URL parameter to state when it changes
  // Only depends on nodeParam to avoid feedback loops
  useEffect(() => {
    const newFolderId = nodeParam ? parseInt(nodeParam, 10) : null;
    setSelectedFolderId(newFolderId);
  }, [nodeParam]);

  const { data: project, isLoading: isProjectLoading } = useFindFirstProjects(
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

  const { data: repository, isLoading: isRepositoryLoading } =
    useFindFirstRepositories(
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

  // Fetch aggregated view options for filters (lightweight query)
  const { data: viewOptionsData } = useQuery({
    queryKey: [
      "viewOptions",
      numericProjectId,
      isRunMode,
      selectedTestCases,
      params.runId,
      selectedRunIds,
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
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch view options");
      }

      return response.json();
    },
    enabled: isValidProjectId && sessionStatus !== "loading",
    staleTime: 30000, // Cache for 30 seconds
  });

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
      refetchFolderStats();
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

  const { data: testRunCasesWithLoading } =
    useFindManyTestRunCases(
      {
        where: {
          testRunId: Number(params.runId),
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

  const { data: caseFoldersWithLoading } =
    useFindManyRepositoryCases(
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
          values: field.values && Array.isArray(field.values) ? new Set(field.values) : new Set(),
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
      dynamicFields,
      tags: tagOptions,
      issues: issueOptions,
      testRunOptions: viewOptionsData.testRunOptions,
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

    if (isRunMode) {
      // Combine runModeItems (excluding Tags) with baseItems and dynamicFields
      const runModeBaseItems = runModeItems.filter(
        (item) => item.id !== "tags"
      );
      return [
        ...runModeBaseItems,
        ...baseItems,
        ...issuesViewItem,
        ...dynamicFields,
      ];
    }

    // For non-run mode, just return baseItems (which now includes Tags), Issues, and dynamicFields
    return [...baseItems, ...issuesViewItem, ...dynamicFields];
  }, [
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
        "status",
        "assignedTo",
        "tags",
        "issues",
      ];

      if (validViewTypes.includes(viewParam)) {
        setSelectedItem(viewParam);
        // Clear filters when switching to non-dynamic views (filters will be set by handleViewChange if needed)
        setSelectedFilter(null);
      } else if (viewParam.startsWith("dynamic_") && viewOptions) {
        const [_, fieldKey] = viewParam.split("_");
        const [fieldId, _fieldType] = fieldKey.split("_");
        const numericFieldId = parseInt(fieldId);
        const field = Object.values(viewOptions.dynamicFields).find(
          (f) => f.fieldId === numericFieldId
        );
        if (field) {
          setSelectedItem(viewParam);

          if (
            field.type === "Link" ||
            field.type === "Steps" ||
            field.type === "Checkbox"
          ) {
            setSelectedFilter([1]);
          } else if (field.options && field.options.length > 0) {
            setSelectedFilter([field.options[0].id]);
          } else {
            // Clear filters for field types that use custom operators
            setSelectedFilter(null);
          }
        }
      }
    }
  }, [viewParam, viewOptions, selectedItem]);

  const [selectedFilter, setSelectedFilter] = useState<Array<
    string | number
  > | null>(null);

  const deferredFolderId = useDeferredValue(selectedFolderId);

  const _updateURL = useCallback(
    (folderId: number | null) => {
      if (folderId !== null) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("node", folderId.toString());
        params.set("view", "folders");
        const newUrl = `${pathName}?${params.toString()}`;
        router.replace(newUrl, {
          scroll: false,
        });
      }
    },
    [router, pathName, searchParams]
  );

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
  // to avoid URL length limits.
  useEffect(() => {
    if (!debouncedEsSearchQuery.trim()) {
      setEsSearchResultIds(null);
      setEsSearchTotal(0);
      return;
    }

    let cancelled = false;
    const PAGE_SIZE = 500;

    const doSearch = async () => {
      setEsSearchLoading(true);
      try {
        // First page
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filters: {
              query: debouncedEsSearchQuery,
              entityTypes: ["repository_case"],
              repositoryCase: {
                projectIds: [numericProjectId],
              },
            },
            pagination: { page: 1, size: PAGE_SIZE },
            highlight: false,
          }),
        });

        if (cancelled) return;
        if (!response.ok) return;

        const data = await response.json();
        const total = data.total as number;
        const allIds: number[] = data.hits.map((hit: any) => hit.source.id);

        // Fetch remaining pages if needed
        const totalPages = Math.ceil(total / PAGE_SIZE);
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
                body: JSON.stringify({
                  filters: {
                    query: debouncedEsSearchQuery,
                    entityTypes: ["repository_case"],
                    repositoryCase: {
                      projectIds: [numericProjectId],
                    },
                  },
                  pagination: { page, size: PAGE_SIZE },
                  highlight: false,
                }),
              }).then((r) => (r.ok ? r.json() : { hits: [] }))
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
        setEsSearchTotal(total);
      } catch (err) {
        console.error("ES search error:", err);
      } finally {
        if (!cancelled) setEsSearchLoading(false);
      }
    };

    doSearch();
    return () => { cancelled = true; };
  }, [debouncedEsSearchQuery, numericProjectId]);

  // Auto-collapse left panel when ES search is active
  useEffect(() => {
    if (esSearchQuery.trim()) {
      // Only capture pre-search state on the first transition into search
      if (wasCollapsedBeforeSearchRef.current === null) {
        wasCollapsedBeforeSearchRef.current = isCollapsed;
        if (!isCollapsed && panelRef.current) {
          setIsTransitioning(true);
          panelRef.current.collapse();
          setIsCollapsed(true);
          setTimeout(() => setIsTransitioning(false), 300);
        }
      }
    } else {
      // Search cleared — restore panel if it wasn't collapsed before search
      if (wasCollapsedBeforeSearchRef.current === false && panelRef.current) {
        setIsTransitioning(true);
        panelRef.current.expand();
        setIsCollapsed(false);
        setTimeout(() => setIsTransitioning(false), 300);
      }
      wasCollapsedBeforeSearchRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esSearchQuery]);

  const cancelEsSearch = useCallback(() => {
    setEsSearchQuery("");
    setEsSearchResultIds(null);
    setEsSearchTotal(0);
    // Panel restore is handled by the effect above via setEsSearchQuery("")
  }, []);

  const isEsSearchActive = esSearchQuery.trim().length > 0;

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

  const handleViewChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", value);
      setSelectedItem(value);

      // Always clear filters first when switching views
      setSelectedFilter(null);

      if (value === "templates" && viewOptions.templates.length > 0) {
        setSelectedFilter([viewOptions.templates[0].id]);
      } else if (value === "states" && viewOptions.states.length > 0) {
        setSelectedFilter([viewOptions.states[0].id]);
      } else if (value === "creators" && viewOptions.creators.length > 0) {
        setSelectedFilter([viewOptions.creators[0].id]);
      } else if (value === "automated") {
        setSelectedFilter([1]);
      } else if (value === "assignedTo") {
        const assignedToView = viewItems.find(
          (item) => item.id === "assignedTo"
        );
        let currentUserOption = null;
        if (
          assignedToView &&
          "options" in assignedToView &&
          Array.isArray(assignedToView.options)
        ) {
          currentUserOption = assignedToView.options.find(
            (opt) => opt.id === session?.user.id
          );
        }
        setSelectedFilter(currentUserOption ? [currentUserOption.id] : null);
      } else if (value === "tags") {
        setSelectedFilter(
          viewOptions.tags.find((t) => t.id === "any") ? ["any"] : null
        );
      } else if (value === "issues") {
        setSelectedFilter(
          viewOptions.issues.find((i) => i.id === "any") ? ["any"] : null
        );
      } else if (value.startsWith("dynamic_")) {
        const [_, fieldKey] = value.split("_");
        const [fieldId, _fieldType] = fieldKey.split("_");
        const numericFieldId = parseInt(fieldId);
        const field = Object.values(viewOptions.dynamicFields).find(
          (f) => f.fieldId === numericFieldId
        );

        if (field) {
          if (
            field.type === "Link" ||
            field.type === "Steps" ||
            field.type === "Checkbox"
          ) {
            setSelectedFilter([1]);
          } else if (field.options && field.options.length > 0) {
            setSelectedFilter([field.options[0].id]);
          }
          // For other field types (Integer, Number, Date, Text, etc.), keep filter cleared
        }
      }
      // For all other views (folders, status, etc.), filter remains cleared

      if (value === "folders") {
        handleSelectFolder(null);
      }

      const newUrl = `${pathName}?${params.toString()}`;
      router.replace(newUrl, {
        scroll: false,
      });
    },
    [
      searchParams,
      viewOptions.templates,
      viewOptions.states,
      viewOptions.creators,
      viewOptions.dynamicFields,
      pathName,
      router,
      viewItems,
      session?.user.id,
      handleSelectFolder,
      viewOptions.tags,
      viewOptions.issues,
    ]
  );

  const handleFilterChange = useCallback(
    (value: Array<string | number> | null) => {
      setSelectedFilter(value);
    },
    []
  );

  useEffect(() => {
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

  // Fetch minimal case position data for auto-paging in run mode
  const { data: casePositions } = useFindManyTestRunCases(
    {
      where: { testRunId: Number(params.runId) },
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

  const { isDragActive } = usePageFileDrop({
    acceptedExtensions: [".csv"],
    enabled: canAddEdit && !isSelectionMode && !isRunMode && !importDialogOpen,
    onDrop: (files) => {
      setDroppedFile(files[0]);
      setImportDialogOpen(true);
    },
    unsupportedMessage: tFileDropZone("unsupportedFileType", {
      expected: ".csv",
    }),
  });

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
                <CardTitle>
                  <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                    <CardTitle>{t("repository.title")}</CardTitle>
                  </div>
                </CardTitle>
                <CardDescription className="uppercase">
                  <span className="flex items-center gap-2 uppercase shrink-0">
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
                      isTransitioning ? "transition-all duration-300 ease-in-out" : ""
                    }`}
                    data-testid="repository-left-panel"
                  >
                    <div className="flex flex-col h-full">
                      <div
                        className="flex items-start justify-between mr-2 shrink-0"
                        data-testid="repository-left-panel-header"
                      >
                        <ViewSelector
                          selectedItem={selectedItem}
                          onValueChange={handleViewChange}
                          viewItems={viewItems}
                          selectedFilter={selectedFilter}
                          onFilterChange={handleFilterChange}
                          isRunMode={isRunMode}
                          viewOptions={viewOptions}
                          totalCount={viewOptionsData?.totalCount || 0}
                        />
                        <div className="ml-4">
                          {selectedItem === "folders" &&
                            !hideHeader &&
                            canAddEdit && (
                              <AddFolderModal
                                projectId={numericProjectId}
                                parentId={selectedFolderId}
                                repositoryId={repository.id}
                                panelWidth={panelWidth}
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
                        </div>
                      </div>
                      <div className="flex-1 mt-4 min-h-10">
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
                                ? dndContainerRef.current
                                : undefined
                            }
                          />
                        ) : null}
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle className="w-1" disabled={isEsSearchActive} />
                  <div className="shrink-0 pt-0.5">
                    <Button
                      type="button"
                      onClick={toggleCollapse}
                      variant="secondary"
                      className="p-0 -ml-1 rounded-l-none"
                      disabled={isEsSearchActive}
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
                    <>
                      <div data-testid="repository-right-panel-header">
                        <div className="flex items-center justify-between mx-2 pt-0.5 gap-2">
                          <div className="text-primary text-lg md:text-xl font-extrabold shrink-0">
                            <div className="flex items-center space-x-1">
                              <ListChecks className="w-5 h-5 min-w-5 min-h-5" />
                              <div>{t("common.fields.testCases")}</div>
                            </div>
                          </div>
                          {/* Elasticsearch search bar for selection mode */}
                          {isSelectionMode && (
                            <div className="relative flex-1 max-w-md">
                              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                              <Input
                                type="text"
                                placeholder={t("search.placeholder.thisProject")}
                                value={esSearchQuery}
                                onChange={(e) => setEsSearchQuery(e.target.value)}
                                className="pl-10 pr-10 h-8"
                              />
                              {esSearchQuery && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
                                  onClick={cancelEsSearch}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          )}
                          {!isSelectionMode && !isRunMode && canAddEdit && (
                            <div className="flex gap-2 items-center">
                              <ImportCasesWizard
                                onImportComplete={refetchFolderStats}
                                externalOpen={importDialogOpen}
                                onExternalOpenChange={(v) => {
                                  setImportDialogOpen(v);
                                  if (!v) setDroppedFile(null);
                                }}
                                initialFile={droppedFile}
                              />
                              <GenerateTestCasesWizard
                                folderId={selectedFolderId ?? 0}
                                folderName={selectedFolderName}
                                onImportComplete={refetchFolderStats}
                              />
                              <AddCaseModal folderId={selectedFolderId ?? 0} />
                            </div>
                          )}
                        </div>

                        {selectedItem === "folders" && !isRunMode && !isEsSearchActive && (
                          <>
                            <BreadcrumbComponent
                              breadcrumbItems={getBreadcrumbItems}
                              projectId={projectIdParam}
                              onClick={handleBreadcrumbClick}
                              isLastClickable={false}
                            />
                            <div className="flex items-center justify-between mx-2">
                              {""}
                            </div>
                            {/* Display Folder Documentation */}
                            {selectedItem === "folders" &&
                              !isRunMode &&
                              selectedFolderId !== null &&
                              (() => {
                                const selectedFolderNode = folderHierarchy.find(
                                  (folder) => folder.id === selectedFolderId
                                );
                                if (selectedFolderNode?.data?.docs) {
                                  const docsContent = parseTipTapContent(
                                    selectedFolderNode.data.docs
                                  );
                                  // Check if docsContent is effectively empty by comparing with emptyEditorContent
                                  const isEmpty =
                                    JSON.stringify(docsContent) ===
                                    JSON.stringify(emptyEditorContent);

                                  if (!isEmpty) {
                                    return (
                                      <div className="ml-4 bg-muted rounded-lg">
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
                      <Cases
                        folderId={isEsSearchActive ? null : selectedFolderId}
                        viewType={isEsSearchActive ? "folders" : selectedItem}
                        filterId={isEsSearchActive ? null : selectedFilter}
                        isSelectionMode={isSelectionMode}
                        selectedTestCases={selectedTestCases}
                        selectedRunIds={selectedRunIds}
                        onSelectionChange={onSelectionChange}
                        onConfirm={onConfirm}
                        hideHeader={hideHeader}
                        isRunMode={isRunMode}
                        onTestCaseClick={onTestCaseClick}
                        isCompleted={isCompleted}
                        canAddEdit={canAddEdit}
                        canAddEditRun={canAddEditRun}
                        canDelete={canDelete}
                        selectedFolderCaseCount={selectedFolderCaseCount}
                        overridePagination={overridePagination}
                        searchResultIds={esSearchResultIds}
                      />
                    </>
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
