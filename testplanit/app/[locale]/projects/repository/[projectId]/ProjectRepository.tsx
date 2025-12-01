"use client";

import * as React from "react";
import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useDeferredValue,
  useRef,
} from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "~/lib/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  useFindFirstProjects,
  useFindFirstRepositories,
  useFindManyRepositoryCases,
  useFindManyTestRunCases,
} from "~/lib/hooks";
import { useFindManyRepositoryCasesFiltered } from "~/hooks/useRepositoryCasesWithFilteredFields";
import { useFolderStats } from "~/lib/useFolderStats";
import TreeView from "./TreeView";
import {
  FolderTree,
  ChevronRight,
  ChevronLeft,
  User,
  LayoutTemplate,
  Workflow,
  Bot,
  ListChecks,
  Link,
  ListOrdered,
  ChevronsUpDown,
  SquareCheckBig,
  CircleCheckBig,
  UserCog,
  Tags,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AddFolderModal } from "./AddFolder";
import { AddCaseModal } from "./AddCase";
import { ImportCasesWizard } from "./ImportCasesWizard";
import { GenerateTestCasesWizard } from "./GenerateTestCasesWizard";
import Cases from "./Cases";
import BreadcrumbComponent from "@/components/BreadcrumbComponent";
import type { FolderNode } from "./TreeView";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { ViewSelector } from "@/components/ViewSelector";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { emptyEditorContent } from "~/app/constants";
import { ProjectIcon } from "~/components/ProjectIcon";
import { SimpleDndProvider } from "@/components/ui/SimpleDndProvider";
import { UnifiedDragPreview } from "@/components/dnd/UnifiedDragPreview";

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
    } catch (e) {
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
  testRunOptions?: {
    statuses: Array<{ id: number; name: string; color?: { value: string }; count: number }>;
    assignedTo: Array<{ id: string; name: string; count: number }>;
    untestedCount: number;
    unassignedCount: number;
    totalCount: number;
  };
}

interface ExtendedCases {
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
  ApplicationArea,
  selectedTestCaseId,
  overridePagination,
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
    isLoading: isLoadingTestRunPermissions,
  } = useProjectPermissions(numericProjectId, "TestRuns");

  const ALL_VALUES_FILTER = "__ALL__"; // Special value for All Values filter

  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(
    nodeParam ? parseInt(nodeParam, 10) : null
  );

  const [panelWidth, setPanelWidth] = useState<number>(100);
  const [folderHierarchy, setFolderHierarchy] = useState<FolderNode[]>([]);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const panelRef = useRef<ImperativePanelHandle>(null);
  const refetchFoldersRef = useRef<(() => void) | null>(null);

  const t = useTranslations();
  const tCommon = useTranslations("common");

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
  const { data: viewOptionsData, isLoading: isLoadingViewOptions } = useQuery({
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
  const { data: folderStatsData, refetch: refetchFolderStats } = useFolderStats({
    projectId: numericProjectId,
    enabled: isValidProjectId,
  });

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

  const { data: testRunCasesWithLoading, isLoading: isLoadingTestRunCases } =
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
  const testRunCases = testRunCasesWithLoading as TestRunCase[] | undefined;

  const { data: caseFoldersWithLoading, isLoading: isLoadingCaseFolders } =
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
    Object.entries(viewOptionsData.dynamicFields).forEach(([key, field]: [string, any]) => {
      dynamicFields[key] = {
        type: field.type,
        fieldId: field.fieldId,
        options: field.options,
        values: field.values ? new Set(field.values) : new Set(),
        counts: field.counts,
      };
    });

    return {
      templates: viewOptionsData.templates,
      states: viewOptionsData.states,
      creators: viewOptionsData.creators,
      automated: viewOptionsData.automated || [],
      dynamicFields,
      tags: tagOptions,
      testRunOptions: viewOptionsData.testRunOptions,
    };
  }, [viewOptionsData, t]);

  const viewItems = useMemo(() => {
    const baseItems = [
      {
        id: "folders",
        name: t("repository.views.byFolder"),
        icon: FolderTree,
      },
      {
        id: "templates",
        name: t("repository.views.byTemplate"),
        icon: LayoutTemplate,
      },
      {
        id: "states",
        name: t("repository.views.byState"),
        icon: Workflow,
      },
      {
        id: "creators",
        name: t("repository.views.byCreator"),
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

    const runModeItems = [
      {
        id: "assignedTo",
        name: t("repository.views.byAssignedTo"),
        icon: UserCog,
        options: [
          {
            id: "unassigned",
            name: t("repository.views.unassigned"),
            count: viewOptionsData?.testRunOptions?.unassignedCount || 0,
          },
          ...(viewOptionsData?.testRunOptions?.assignedTo || []).sort((a: any, b: any) =>
            a.name.localeCompare(b.name)
          ),
        ],
      },
      {
        id: "status",
        name: t("repository.views.byStatus"),
        icon: CircleCheckBig,
        options: [
          {
            id: "untested",
            name: t("repository.views.untested"),
            count: viewOptionsData?.testRunOptions?.untestedCount || 0,
          },
          ...(viewOptionsData?.testRunOptions?.statuses || []),
        ],
      },
      // Tags view moved to baseItems now
      // {
      //   id: "tags",
      //   name: t("repository.views.byTag"),
      //   icon: Tags,
      //   options: viewOptions.tags.map((tag) => ({ ...tag })),
      // },
    ];

    const dynamicFields = Object.entries(viewOptions.dynamicFields)
      .filter(
        ([_, field]: [string, DynamicField]) =>
          field.type === "Dropdown" ||
          field.type === "Multi-Select" ||
          field.type === "Link" ||
          field.type === "Steps" ||
          field.type === "Checkbox"
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
                  : SquareCheckBig,
        field,
      }));

    if (isRunMode) {
      // Combine runModeItems (excluding Tags) with baseItems and dynamicFields
      const runModeBaseItems = runModeItems.filter(
        (item) => item.id !== "tags"
      );
      return [...runModeBaseItems, ...baseItems, ...dynamicFields];
    }

    // For non-run mode, just return baseItems (which now includes Tags) and dynamicFields
    return [...baseItems, ...dynamicFields];
  }, [viewOptions.dynamicFields, t, isRunMode, viewOptionsData, viewOptions.tags]);

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
    ];

    if (viewParam) {
      if (validViewTypes.includes(viewParam)) {
        return viewParam;
      }

      if (viewParam.startsWith("dynamic_")) {
        const [_, fieldKey] = viewParam.split("_");
        const [fieldId, fieldType] = fieldKey.split("_");
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
      ];

      if (validViewTypes.includes(viewParam)) {
        setSelectedItem(viewParam);
      } else if (viewParam.startsWith("dynamic_") && viewOptions) {
        const [_, fieldKey] = viewParam.split("_");
        const [fieldId, fieldType] = fieldKey.split("_");
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
          }
        }
      }
    }
  }, [viewParam, viewOptions, selectedItem]);

  const [selectedFilter, setSelectedFilter] = useState<Array<
    string | number
  > | null>(null);

  const deferredFolderId = useDeferredValue(selectedFolderId);

  const updateURL = useCallback(
    (folderId: number | null) => {
      if (folderId !== null) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("node", folderId.toString());
        params.set("view", "folders");
        router.replace(`${pathName}?${params.toString()}`, {
          scroll: false,
        });
      }
    },
    [router, pathName, searchParams]
  );

  const handleHierarchyChange = useCallback((hierarchy: FolderNode[]) => {
    setFolderHierarchy(hierarchy);
  }, []);

  const handleRefetchFolders = useCallback((refetch: () => void) => {
    refetchFoldersRef.current = refetch;
  }, []);

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

  const toggleCollapse = () => {
    if (panelRef.current) {
      if (isCollapsed) {
        panelRef.current.expand();
      } else {
        panelRef.current.collapse();
      }
      setIsCollapsed(!isCollapsed);
    }
  };

  const handleViewChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", value);
      setSelectedItem(value);

      if (value === "templates" && viewOptions.templates.length > 0) {
        setSelectedFilter([viewOptions.templates[0].id]);
      } else if (value === "states" && viewOptions.states.length > 0) {
        setSelectedFilter([viewOptions.states[0].id]);
      } else if (value === "creators" && viewOptions.creators.length > 0) {
        setSelectedFilter([viewOptions.creators[0].id]);
      } else if (value === "automated") {
        setSelectedFilter([1]);
      } else if (value === "status") {
        setSelectedFilter(null);
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
      } else if (value.startsWith("dynamic_")) {
        const [_, fieldKey] = value.split("_");
        const [fieldId, fieldType] = fieldKey.split("_");
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
        }
      }

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

  // TODO: Re-implement auto-paging without full case data
  // The auto-paging feature needs to be reimplemented to work with the optimized queries
  // React.useEffect(() => {
  //   if (
  //     isRunMode &&
  //     selectedTestCaseId &&
  //     typeof pageSize === "number"
  //   ) {
  //     // Need to fetch case order/index without loading all cases
  //   }
  // }, [isRunMode, selectedTestCaseId, pageSize, setCurrentPage]);

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

  const canAddEdit = projectPermissions?.canAddEdit ?? false;
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;
  const canDelete = projectPermissions?.canDelete ?? false;

  if (session && session.user.access !== "NONE") {
    return (
      <div>
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
                  <span className="flex items-center gap-2 uppercase">
                    <ProjectIcon iconUrl={project?.iconUrl} />
                    {project?.name}
                  </span>
                </CardDescription>
              </CardHeader>
            ) : (
              <div className="my-4" />
            )}
            <CardContent>
              <SimpleDndProvider>
                <UnifiedDragPreview />
                <ResizablePanelGroup
                  direction="horizontal"
                  autoSaveId="project-repository-panels"
                  data-testid="repository-layout"
                >
                  <ResizablePanel
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
                    className="p-0 m-0"
                    data-testid="repository-left-panel"
                  >
                    <div className="flex flex-col h-full">
                      <div
                        className="flex items-center justify-between mr-2 shrink-0"
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
                        <div className="-mt-4 ml-4">
                          {selectedItem === "folders" &&
                            !hideHeader &&
                            canAddEdit && (
                              <AddFolderModal
                                projectId={numericProjectId}
                                parentId={selectedFolderId}
                                repositoryId={repository.id}
                                panelWidth={panelWidth}
                                onFolderCreated={() => {
                                  if (refetchFoldersRef.current) {
                                    refetchFoldersRef.current();
                                  }
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
                          />
                        ) : null}
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle className="w-1" />
                  <div>
                    <Button
                      type="button"
                      onClick={toggleCollapse}
                      variant="secondary"
                      className="p-0 -ml-1 rounded-l-none"
                    >
                      {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
                    </Button>
                  </div>
                  <ResizablePanel
                    order={2}
                    defaultSize={80}
                    className="p-0 m-0 min-w-[400px]"
                  >
                    {/* Empty state is now handled by TreeView component */}
                    <>
                      <div data-testid="repository-right-panel-header">
                        <div className="flex items-center justify-between mx-2">
                          <div className="text-primary text-lg md:text-xl font-extrabold">
                            <div className="flex items-center space-x-1">
                              <ListChecks className="w-5 h-5 min-w-5 min-h-5" />
                              <div>{t("repository.testCases")}</div>
                            </div>
                          </div>
                          {!isSelectionMode && !isRunMode && canAddEdit && (
                            <div className="flex gap-2 items-center">
                              <ImportCasesWizard
                                onImportComplete={refetchFolderStats}
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
                        {selectedItem === "folders" && !isRunMode && (
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
                        folderId={selectedFolderId ?? 0}
                        viewType={selectedItem}
                        filterId={selectedFilter}
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
                      />
                    </>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </SimpleDndProvider>
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
