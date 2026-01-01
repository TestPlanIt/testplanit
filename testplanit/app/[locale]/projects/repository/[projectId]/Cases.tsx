import {
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useTransition,
  useCallback,
  useDeferredValue,
  useRef,
} from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "~/lib/navigation";
import { useSearchParams, useParams } from "next/navigation";
import {
  useUpdateRepositoryCases,
  useFindManyTestRunCases,
  useUpdateTestRunCases,
  useCountRepositoryCases,
  useCountTestRunCases,
  useFindManyTemplates,
  useFindManyRepositoryFolders,
  useFindFirstTestRuns,
} from "~/lib/hooks";
import { useFindManyRepositoryCasesFiltered } from "~/hooks/useRepositoryCasesWithFilteredFields";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  ColumnSelection,
  ColumnMetadata,
} from "@/components/tables/ColumnSelection";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Prisma } from "@prisma/client";
import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { AddCaseRow } from "./AddCaseRow";
import { useTranslations } from "next-intl";
import { SelectedTestCasesDrawer } from "@/components/SelectedTestCasesDrawer";
import { usePagination } from "~/lib/contexts/PaginationContext";
import { Button } from "@/components/ui/button";
import { BulkEditModal } from "./BulkEditModal";
import { AddResultModal } from "./AddResultModal";
import { PenSquare, PlayCircle, Upload } from "lucide-react";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ExportModal, ExportOptions } from "./ExportModal";
import { useExportData, TFunction } from "~/hooks/useExportData";
import { fetchAllCasesForExport as fetchAllCasesAction } from "~/app/actions/exportActions";
import {
  RowSelectionState,
  Updater as TableUpdater,
} from "@tanstack/react-table";
import { toast } from "sonner";

type PageSizeOption = number | "All";

interface CasesProps {
  folderId: number | null;
  viewType: string;
  filterId: Array<string | number> | null;
  isSelectionMode?: boolean;
  selectedTestCases?: number[];
  selectedRunIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  onConfirm?: (selectedIds: number[]) => void;
  hideHeader?: boolean;
  isRunMode?: boolean;
  onTestCaseClick?: (caseId: number) => void;
  isCompleted?: boolean;
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
}

export default function Cases({
  folderId,
  viewType,
  filterId,
  isSelectionMode = false,
  selectedTestCases = [],
  selectedRunIds,
  onSelectionChange,
  onConfirm,
  hideHeader = false,
  isRunMode = false,
  onTestCaseClick,
  isCompleted = false,
  canAddEdit,
  canAddEditRun,
  canDelete,
  selectedFolderCaseCount,
  overridePagination,
}: CasesProps) {
  const t = useTranslations();

  // Performance logging - use refs to avoid re-renders
  const performanceLog = useRef({
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

  const [sortConfig, setSortConfig] = useState<
    { column: string; direction: "asc" | "desc" } | undefined
  >({
    column: "order",
    direction: "asc",
  });
  const [isDefaultSort, setIsDefaultSort] = useState(true);
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const deferredSearchString = useDeferredValue(debouncedSearchString);

  const { mutateAsync: updateRepositoryCases } = useUpdateRepositoryCases({
    optimisticUpdate: false,
  });
  const { mutateAsync: updateTestRunCases } = useUpdateTestRunCases({
    optimisticUpdate: false,
  });
  const [isPending, startTransition] = useTransition();
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<any[]>([]);

  // Add state for modal open
  const [isModalOpen, setIsModalOpen] = useState(false);

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
  const {
    permissions: testRunResultPermissions,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(projectId, "TestRunResults");
  const canAddEditResults = testRunResultPermissions?.canAddEdit ?? false;

  // *** NEW: Fetch total project case count ***
  const { data: totalProjectCasesCountData, isLoading: isLoadingTotalCount } =
    useCountRepositoryCases(
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

  // Lightweight project-wide template field discovery
  const { data: projectTemplates, isLoading: isTemplatesLoading } =
    useFindManyTemplates(
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
          // Skip query if we know the selected folder has 0 cases
          viewType === "folders" && selectedFolderCaseCount === 0
            ? false
            : !!projectId
        ),
      }
    );

  // Fetch folders to auto-select first folder when needed
  const { data: projectFolders, isLoading: isFoldersLoading } =
    useFindManyRepositoryFolders(
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
  const { data: testRunData } = useFindFirstTestRuns(
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

  // Auto-select first folder when view is folders and no folder is selected
  useEffect(() => {
    if (
      viewType === "folders" &&
      !folderId &&
      projectFolders &&
      projectFolders.length > 0 &&
      !isFoldersLoading
    ) {
      const firstFolder = projectFolders[0];

      // Navigate to the first folder by updating the URL
      const currentSearchParams = new URLSearchParams(searchParams.toString());
      currentSearchParams.set("node", firstFolder.id.toString());
      currentSearchParams.set("view", "folders");

      router.replace(`${pathname}?${currentSearchParams.toString()}`);

      // Dispatch a custom event to notify the tree component
      // Use a small timeout to ensure the URL change propagates
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("folderSelectionChanged", {
            detail: { folderId: firstFolder.id },
          })
        );

        // Also dispatch a popstate event to simulate URL change
        window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
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
  const repositoryCaseWhereClause: Prisma.RepositoryCasesWhereInput =
    useMemo(() => {
      const baseConditions: Prisma.RepositoryCasesWhereInput[] = [
        {
          name: {
            contains: deferredSearchString,
            mode: "insensitive" as Prisma.QueryMode,
          },
        },
        {
          isDeleted: false,
          isArchived: false,
          projectId,
        },
      ];

      // --- Apply folder/view/filter logic ---
      // Skip assignedTo and status filters here - they're handled separately for test run cases
      const isTestRunSpecificView =
        viewType === "assignedTo" || viewType === "status";

      if (viewType === "folders" && folderId) {
        // 1. Folder view with specific folder
        baseConditions.push({ folderId: { equals: folderId } });
      } else if (
        !isTestRunSpecificView &&
        (filterId === null ||
          (Array.isArray(filterId) && filterId.length === 0))
      ) {
        // 2. Filter is null - means "All Values/All Items", so add no condition
      } else if (!isTestRunSpecificView) {
        // 4. Filter has specific value(s)
        const filterArray = Array.isArray(filterId) ? filterId : [filterId];
        const filterConditions: any[] = [];

        // Build a condition for each filter value
        for (const singleFilterId of filterArray) {
          if (viewType.startsWith("dynamic_")) {
            // Apply specific filter for dynamic views
            const [_, ...fieldParts] = viewType.split("_");
            const fieldKey = fieldParts.join("_");
            const [fieldId, fieldType] = fieldKey.split("_");
            const numericFieldId = parseInt(fieldId);

            // Add the dynamic filtering logic here (Link, Dropdown, etc.)
            if (fieldType === "Link") {
              // singleFilterId 1 = Has Link, singleFilterId 2 = No Link
              if ((singleFilterId as number) === 1) {
                // Has link
                filterConditions.push({
                  caseFieldValues: {
                    some: {
                      fieldId: numericFieldId,
                      AND: [
                        { value: { not: Prisma.JsonNull } },
                        { value: { not: { equals: "" } } },
                      ],
                    },
                  },
                });
              } else if ((singleFilterId as number) === 2) {
                // No link
                filterConditions.push({
                  OR: [
                    { caseFieldValues: { none: { fieldId: numericFieldId } } },
                    {
                      caseFieldValues: {
                        some: {
                          fieldId: numericFieldId,
                          OR: [
                            { value: { equals: Prisma.JsonNull } },
                            { value: { equals: "" } },
                          ],
                        },
                      },
                    },
                  ],
                });
              }
            } else if (fieldType === "Dropdown") {
              // Handle special "none" value to filter for cases without this field
              if (singleFilterId === "none") {
                filterConditions.push({
                  OR: [
                    // Case 1: No record exists for this fieldId
                    { caseFieldValues: { none: { fieldId: numericFieldId } } },
                    // Case 2: Record exists, but value is explicitly null
                    {
                      caseFieldValues: {
                        some: {
                          fieldId: numericFieldId,
                          value: { equals: Prisma.JsonNull },
                        },
                      },
                    },
                  ],
                });
              } else {
                filterConditions.push({
                  caseFieldValues: {
                    some: {
                      fieldId: numericFieldId,
                      OR: [
                        {
                          value: {
                            equals: (
                              singleFilterId as string | number
                            ).toString(),
                          },
                        },
                        {
                          value: { equals: singleFilterId as string | number },
                        },
                      ],
                    },
                  },
                });
              }
            } else if (fieldType === "Multi-Select") {
              // Handle special "none" value to filter for cases without this field
              if (singleFilterId === "none") {
                filterConditions.push({
                  OR: [
                    // Case 1: No record exists for this fieldId
                    { caseFieldValues: { none: { fieldId: numericFieldId } } },
                    // Case 2: Record exists, but value is explicitly null
                    {
                      caseFieldValues: {
                        some: {
                          fieldId: numericFieldId,
                          value: { equals: Prisma.JsonNull },
                        },
                      },
                    },
                  ],
                });
              } else {
                filterConditions.push({
                  caseFieldValues: {
                    some: {
                      fieldId: numericFieldId,
                      value: {
                        array_contains: [singleFilterId as string | number],
                      },
                    },
                  },
                });
              }
            } else if (fieldType === "Steps") {
              // singleFilterId 1 = Has Steps, singleFilterId 2 = No Steps
              if ((singleFilterId as number) === 1) {
                // Has steps
                filterConditions.push({
                  steps: { some: { isDeleted: false } },
                });
              } else if ((singleFilterId as number) === 2) {
                // No steps
                filterConditions.push({
                  steps: { none: { isDeleted: false } },
                });
              }
            } else if (fieldType === "Checkbox") {
              // singleFilterId 1 = Checked, singleFilterId 2 = Unchecked
              filterConditions.push({
                caseFieldValues: {
                  some: {
                    fieldId: numericFieldId,
                    value: {
                      equals: (singleFilterId as number) === 1 ? true : false,
                    },
                  },
                },
              });
            }
          } else {
            // Apply specific filter for standard views (using switch)
            switch (viewType) {
              case "templates":
                filterConditions.push({
                  templateId: { equals: Number(singleFilterId) },
                });
                break;
              case "states":
                filterConditions.push({
                  stateId: { equals: Number(singleFilterId) },
                });
                break;
              case "creators":
                filterConditions.push({
                  creatorId: { equals: singleFilterId?.toString() },
                });
                break;
              case "automated":
                filterConditions.push({
                  automated: (singleFilterId as number) === 1 ? true : false,
                });
                break;
              case "tags":
                if (singleFilterId === "any") {
                  filterConditions.push({
                    tags: { some: { isDeleted: false } },
                  });
                } else if (singleFilterId === "none") {
                  filterConditions.push({
                    tags: { none: { isDeleted: false } },
                  });
                } else {
                  filterConditions.push({
                    tags: {
                      some: { id: Number(singleFilterId), isDeleted: false },
                    },
                  });
                }
                break;
            }
          }
        }

        // Combine all filter conditions with OR (union of results)
        if (filterConditions.length > 0) {
          baseConditions.push({ OR: filterConditions });
        }
      }

      const finalWhereClause: Prisma.RepositoryCasesWhereInput = {
        AND: baseConditions,
      };
      return finalWhereClause;
    }, [deferredSearchString, projectId, viewType, folderId, filterId]);

  // Build test run case where clause (used for filtering by assignedTo and status)
  const testRunCaseWhereClause: Prisma.TestRunCasesWhereInput = useMemo(() => {
    if (
      !isRunMode ||
      !filterId ||
      (viewType !== "assignedTo" && viewType !== "status")
    ) {
      return {};
    }

    const filterArray = Array.isArray(filterId) ? filterId : [filterId];
    const filterConditions: any[] = [];

    for (const singleFilterId of filterArray) {
      if (viewType === "assignedTo") {
        if (singleFilterId === "unassigned") {
          filterConditions.push({ assignedToId: { equals: null } });
        } else {
          filterConditions.push({
            assignedToId: { equals: singleFilterId as string },
          });
        }
      } else if (viewType === "status") {
        if (singleFilterId === "untested") {
          filterConditions.push({ statusId: { equals: null } });
        } else {
          filterConditions.push({
            statusId: { equals: singleFilterId as number },
          });
        }
      }
    }

    if (filterConditions.length > 0) {
      return { OR: filterConditions };
    }
    return {};
  }, [isRunMode, viewType, filterId]);

  // Create orderBy for TestRunCases based on sortConfig
  const testRunCasesOrderBy: Prisma.TestRunCasesOrderByWithRelationInput =
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
      } else {
        // For any other column, try to order by the repositoryCase field
        return { repositoryCase: { [column]: direction } };
      }
    }, [sortConfig, isDefaultSort]);

  // Determine which run IDs to query - use selectedRunIds if provided (multi-config), otherwise use single runId
  const effectiveRunIds =
    selectedRunIds && selectedRunIds.length > 0
      ? selectedRunIds
      : runId
        ? [runId]
        : [];

  // Fetch test run cases and their related repository cases for run mode
  const { data: testRunCasesData, refetch: refetchTestRunCases } =
    useFindManyTestRunCases(
      {
        where: {
          testRunId:
            effectiveRunIds.length === 1
              ? effectiveRunIds[0]
              : { in: effectiveRunIds },
          ...testRunCaseWhereClause,
          repositoryCase: repositoryCaseWhereClause,
        },
        orderBy: testRunCasesOrderBy,
        skip: (currentPage - 1) * (pageSize === "All" ? 0 : pageSize),
        take: pageSize === "All" ? undefined : pageSize,
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
              isArchived: true,
              isDeleted: true,
              currentVersion: true,
              source: true,
              state: {
                select: {
                  id: true,
                  name: true,
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
              },
              template: {
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
              },
              caseFieldValues: true,
              attachments: true,
              steps: true,
              tags: true,
              issues: true,
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
        },
      },
      {
        enabled:
          isRunMode &&
          !!session?.user &&
          isValidProjectId &&
          effectiveRunIds.length > 0,
        refetchOnWindowFocus: true,
      }
    ) as {
      data:
        | Prisma.TestRunCasesGetPayload<{
            select: {
              id: true;
              repositoryCaseId: true;
              order: true;
              statusId: true;
              status: {
                select: {
                  id: true;
                  name: true;
                  color: {
                    select: {
                      value: true;
                    };
                  };
                };
              };
              assignedToId: true;
              assignedTo: {
                select: {
                  id: true;
                  name: true;
                };
              };
              isCompleted: true;
              notes: true;
              startedAt: true;
              completedAt: true;
              elapsed: true;
              testRun: {
                select: {
                  id: true;
                  configuration: {
                    select: {
                      id: true;
                      name: true;
                    };
                  };
                };
              };
              repositoryCase: {
                select: {
                  id: true;
                  projectId: true;
                  folderId: true;
                  templateId: true;
                  name: true;
                  stateId: true;
                  order: true;
                  createdAt: true;
                  creatorId: true;
                  automated: true;
                  isArchived: true;
                  isDeleted: true;
                  source: true;
                };
              };
            };
          }>[]
        | undefined;
      refetch: any;
    };

  // orderBy for repository cases (used in non-run mode)
  const orderBy: Prisma.RepositoryCasesOrderByWithRelationInput =
    useMemo(() => {
      if (isDefaultSort) {
        return { order: "asc" };
      }
      if (!sortConfig) {
        return { order: "asc" };
      }
      return { [sortConfig.column]: sortConfig.direction };
    }, [sortConfig, isDefaultSort]);

  // Add filtered count query for accurate pagination
  // For repository mode: count repository cases
  const { data: filteredCountData, refetch: refetchFilteredCount } = useCountRepositoryCases(
    {
      where: repositoryCaseWhereClause,
    },
    {
      enabled: Boolean(
        // Skip query if we know the selected folder has 0 cases
        viewType === "folders" && selectedFolderCaseCount === 0
          ? false
          : !isRunMode && // Don't run this in run mode
              ((!!session?.user && deferredSearchString.length === 0) ||
                deferredSearchString.length > 0)
      ),
      refetchOnWindowFocus: false,
      // Keep previous data to prevent count from dropping to 0 during refetch
      // This prevents pagination from resetting when switching pages
      placeholderData: (previousData) => previousData,
    }
  );

  // For run mode: count test run cases matching the filters
  const { data: testRunCasesCountData } = useCountTestRunCases(
    {
      where: {
        testRunId:
          effectiveRunIds.length === 1
            ? effectiveRunIds[0]
            : { in: effectiveRunIds },
        ...testRunCaseWhereClause,
        repositoryCase: repositoryCaseWhereClause,
      },
    },
    {
      enabled: Boolean(
        isRunMode &&
        !!session?.user &&
        isValidProjectId &&
        effectiveRunIds.length > 0
      ),
      refetchOnWindowFocus: false,
      // Keep previous data to prevent count from dropping to 0 during refetch
      placeholderData: (previousData) => previousData,
    }
  );

  // Query to fetch all case IDs when Shift+click Select All is used
  const { data: allCaseIdsData } = useFindManyRepositoryCasesFiltered(
    {
      where: repositoryCaseWhereClause,
      select: {
        id: true,
        isDeleted: true,
      },
    },
    {
      enabled: fetchAllIdsForSelection && !isRunMode, // Don't run in run mode
      refetchOnWindowFocus: false,
    }
  );

  const isTotalLoading = false;

  // Calculate total count based on mode
  const totalRepositoryCases = useMemo(() => {
    // If we know the selected folder has 0 cases, return 0 immediately
    if (viewType === "folders" && selectedFolderCaseCount === 0) {
      return 0;
    }
    if (isRunMode) {
      // In run mode, use the test run cases count
      return testRunCasesCountData || 0;
    }
    // In repository mode, use the repository cases count
    return filteredCountData || 0;
  }, [
    isRunMode,
    testRunCasesCountData,
    filteredCountData,
    viewType,
    selectedFolderCaseCount,
  ]);

  // Update total items in pagination context
  useEffect(() => {
    setTotalItems(totalRepositoryCases);
  }, [totalRepositoryCases, setTotalItems]);

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

  const {
    data,
    isLoading,
    refetch: refetchData,
  } = useFindManyRepositoryCasesFiltered(
    {
      orderBy: orderBy,
      where: repositoryCaseWhereClause,
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
        isArchived: true,
        isDeleted: true,
        currentVersion: true,
        source: true,
        state: {
          select: {
            id: true,
            name: true,
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
        },
        template: {
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
        },
        caseFieldValues: {
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
        },
        attachments: {
          orderBy: { createdAt: "desc" },
          where: { isDeleted: false },
        },
        steps: {
          where: {
            isDeleted: false,
            OR: [
              { sharedStepGroupId: null },
              { sharedStepGroup: { isDeleted: false } },
            ],
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
        },
        tags: {
          where: {
            isDeleted: false,
          },
        },
        issues: {
          where: {
            isDeleted: false,
          },
          include: {
            integration: true,
          },
        },
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
            results: {
              select: {
                id: true,
                executedAt: true,
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
              },
              where: {
                isDeleted: false,
              },
              orderBy: {
                executedAt: "desc",
              },
              take: 1,
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
      // Apply server-side pagination for repository mode
      skip: (currentPage - 1) * (pageSize === "All" ? 0 : pageSize),
      take: pageSize === "All" ? undefined : pageSize,
    },
    {
      enabled: Boolean(
        // Skip query if we know the selected folder has 0 cases
        viewType === "folders" && selectedFolderCaseCount === 0
          ? false
          : !isRunMode && // Don't run this query in run mode - we use testRunCasesData instead
              ((!!session?.user && deferredSearchString.length === 0) ||
                deferredSearchString.length > 0)
      ),
      refetchOnWindowFocus: false,
    }
  ) as {
    data:
      | Prisma.RepositoryCasesGetPayload<{
          select: {
            id: true;
            projectId: true;
            project: true;
            creator: true;
            folder: true;
            repositoryId: true;
            folderId: true;
            templateId: true;
            name: true;
            stateId: true;
            estimate: true;
            forecastManual: true;
            forecastAutomated: true;
            order: true;
            createdAt: true;
            creatorId: true;
            automated: true;
            isArchived: true;
            isDeleted: true;
            currentVersion: true;
            source: true;
            state: {
              select: {
                id: true;
                name: true;
                icon: {
                  select: {
                    name: true;
                  };
                };
                color: {
                  select: {
                    value: true;
                  };
                };
              };
            };
            template: {
              select: {
                id: true;
                templateName: true;
                caseFields: {
                  select: {
                    caseField: {
                      select: {
                        id: true;
                        defaultValue: true;
                        displayName: true;
                        type: {
                          select: {
                            type: true;
                          };
                        };
                        fieldOptions: {
                          select: {
                            fieldOption: {
                              select: {
                                id: true;
                                icon: true;
                                iconColor: true;
                                name: true;
                              };
                            };
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
            caseFieldValues: {
              select: {
                id: true;
                value: true;
                fieldId: true;
                field: {
                  select: {
                    id: true;
                    displayName: true;
                    type: {
                      select: {
                        type: true;
                      };
                    };
                  };
                };
              };
              where: { field: { isEnabled: true; isDeleted: false } };
            };
            attachments: {
              orderBy: { createdAt: "desc" };
              where: { isDeleted: false };
            };
            steps: {
              where: {
                isDeleted: false;
                OR: [
                  { sharedStepGroupId: null },
                  { sharedStepGroup: { isDeleted: false } },
                ];
              };
              orderBy: { order: "asc" };
              select: {
                id: true;
                order: true;
                step: true;
                expectedResult: true;
                sharedStepGroupId: true;
                sharedStepGroup: {
                  select: {
                    name: true;
                  };
                };
              };
            };
            tags: {
              where: {
                isDeleted: false;
              };
            };
            issues: {
              where: {
                isDeleted: false;
              };
            };
            testRuns: {
              select: {
                id: true;
                testRun: {
                  select: {
                    id: true;
                    name: true;
                    projectId: true;
                    isDeleted: true;
                    isCompleted: true;
                  };
                };
                results: {
                  select: {
                    id: true;
                    executedAt: true;
                    status: {
                      select: {
                        id: true;
                        name: true;
                        color: {
                          select: {
                            value: true;
                          };
                        };
                      };
                    };
                  };
                  where: {
                    isDeleted: false;
                  };
                  orderBy: {
                    executedAt: "desc";
                  };
                  take: 1;
                };
              };
            };
            linksFrom: {
              select: {
                caseBId: true;
                type: true;
                isDeleted: true;
              };
            };
            linksTo: {
              select: {
                caseAId: true;
                type: true;
                isDeleted: true;
              };
            };
          };
        }>[]
      | undefined;
    isLoading: boolean;
    refetch: any;
  };

  // Refetch all repository cases data (both list and count)
  const refetchRepositoryCases = useCallback(() => {
    refetchData();
    refetchFilteredCount();
  }, [refetchData, refetchFilteredCount]);

  // Listen for repository cases changes (e.g., after import or bulk delete)
  useEffect(() => {
    const handleRepositoryCasesChanged = () => {
      refetchRepositoryCases();
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
  }, [refetchRepositoryCases]);

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
        testRunConfiguration: trc.testRun?.configuration,
      }));
    }
    // Not in isRunMode. Use 'data' directly (already server-side paginated and filtered).
    // Compute lastTestResult for each case by finding the most recent result across all test runs
    if (data) {
      return data.map((caseItem) => {
        // Find the most recent result across all test runs for this case
        let lastTestResult: {
          status: { id: number; name: string; color?: { value: string } };
          executedAt: Date;
          testRun?: { id: number; name: string };
        } | null = null;

        if (caseItem.testRuns && caseItem.testRuns.length > 0) {
          // Collect all results from all test runs
          const allResults: {
            result: {
              id: number;
              executedAt: Date;
              status: { id: number; name: string; color?: { value: string } };
            };
            testRun: { id: number; name: string };
          }[] = [];

          for (const trLink of caseItem.testRuns) {
            if (trLink.results && trLink.results.length > 0 && trLink.testRun && !trLink.testRun.isDeleted) {
              for (const result of trLink.results) {
                allResults.push({
                  result: result as any,
                  testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
                });
              }
            }
          }

          // Sort by executedAt descending and pick the first one
          if (allResults.length > 0) {
            allResults.sort(
              (a, b) =>
                new Date(b.result.executedAt).getTime() -
                new Date(a.result.executedAt).getTime()
            );
            const mostRecent = allResults[0];
            lastTestResult = {
              status: mostRecent.result.status,
              executedAt: mostRecent.result.executedAt,
              testRun: mostRecent.testRun,
            };
          }
        }

        return {
          ...caseItem,
          lastTestResult,
        };
      });
    }
    return [];
  }, [isRunMode, testRunCasesData, data, optimisticReorder]);

  const uniqueCaseFieldList = useMemo(() => {
    const caseFieldMap = new Map();
    projectTemplates?.forEach((template) => {
      template.caseFields.forEach((field) => {
        caseFieldMap.set(field.caseField.id, field.caseField);
      });
    });
    return Array.from(caseFieldMap.values());
  }, [projectTemplates]);

  // Clear optimistic reorder when underlying data changes
  useEffect(() => {
    setOptimisticReorder({ inProgress: false, cases: null });
  }, [currentPage, sortConfig, folderId, viewType, filterId]);

  // Check if we're in multi-config mode (multiple test runs selected)
  const isMultiConfigMode =
    isRunMode && selectedRunIds && selectedRunIds.length > 1;

  // Handle selection changes
  const handleSelectAll = useCallback(() => {
    if (!isSelectionMode || !onSelectionChange || !cases) return;
    // In multi-config mode, use testRunCaseId for unique identification
    const currentPageIds = cases.map((tc) =>
      isMultiConfigMode && (tc as any).testRunCaseId
        ? (tc as any).testRunCaseId
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
  const handleBulkEditSelectionChange = useCallback((ids: number[]) => {
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
        isMultiConfigMode && (caseItem as any).testRunCaseId
          ? (caseItem as any).testRunCaseId
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
          return isMultiConfigMode && (caseItem as any).testRunCaseId
            ? (caseItem as any).testRunCaseId
            : caseItem.id;
        })
        .filter((id): id is number => id !== undefined);

      if (isSelectionMode && onSelectionChange) {
        // Get IDs of all cases currently visible in the DataTable
        const allCaseIdsOnCurrentPage = MappedCases.map((tc) =>
          isMultiConfigMode && (tc as any).testRunCaseId
            ? (tc as any).testRunCaseId
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
          isMultiConfigMode && (tc as any).testRunCaseId
            ? (tc as any).testRunCaseId
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
        const selectedIds = Object.entries(rangeSelection)
          .filter(([_, isSelected]) => isSelected)
          .map(([index]) => MappedCases[parseInt(index)]?.id)
          .filter((id): id is number => id !== undefined);

        if (isSelectionMode && onSelectionChange) {
          // Get IDs from other pages
          const allCaseIdsOnCurrentPage = MappedCases.map((tc) => tc.id);
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
        const selectableRows = MappedCases.filter((tc) => !tc.isDeleted);
        const selectableIndices = MappedCases.map((tc, index) =>
          !tc.isDeleted ? index : null
        ).filter((index) => index !== null) as number[];

        const allSelectableSelected = selectableIndices.every(
          (index) => rowSelection[index.toString()]
        );

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

          if (isSelectionMode && onSelectionChange) {
            // Remove current page IDs from selection
            const currentPageIds = selectableRows.map((tc) => tc.id);
            const newSelection = selectedTestCases.filter(
              (id) => !currentPageIds.includes(id)
            );
            onSelectionChange(newSelection);
          } else {
            // For bulk edit mode, we typically clear all when deselecting current page
            const currentPageIds = selectableRows.map((tc) => tc.id);
            const newSelection = selectedCaseIdsForBulkEdit.filter(
              (id) => !currentPageIds.includes(id)
            );
            setSelectedCaseIdsForBulkEdit(newSelection);
          }
        } else {
          // Select all selectable rows on current page
          const newSelection: RowSelectionState = { ...rowSelection };
          selectableIndices.forEach((index) => {
            newSelection[index.toString()] = true;
          });
          setRowSelection(newSelection);

          const selectedIds = selectableRows.map((tc) => tc.id);

          if (isSelectionMode && onSelectionChange) {
            // Add current page IDs to existing selection
            const currentPageIds = MappedCases.map((tc) => tc.id);
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
      rowSelection,
      isSelectionMode,
      onSelectionChange,
      selectedTestCases,
      selectedCaseIdsForBulkEdit,
      setSelectedCaseIdsForBulkEdit,
    ]
  );

  const columns: CustomColumnDef<any>[] = useMemo(() => {
    return getColumns(
      session,
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
        lastTestResult: t("repository.columns.lastTestResult"),
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
          configuration: testRunData?.configuration || null,
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
      isDefaultSort &&
        !isSelectionMode &&
        !isCompleted &&
        ((isRunMode && canAddEditRun) || (!isRunMode && canAddEdit))
    );
  }, [
    session,
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

  // Add effect to force refetch when folder changes
  useEffect(() => {
    if (viewType === "folders" && folderId) {
      refetchRepositoryCases();
      refetchData();
    }
  }, [folderId, viewType, refetchRepositoryCases, refetchData]);

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
            const testRunCaseIdToUpdate = (item as any).testRunCaseId;
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
    } catch (error) {
      console.error("Failed to reorder cases", error);
      toast.error(t("common.errors.somethingWentWrong"));

      // Clear optimistic state immediately on error
      setOptimisticReorder({ inProgress: false, cases: null });

      // If needed, we can still manually refetch to ensure consistency
      if (isRunMode) {
        await refetchTestRunCases();
        await refetchData();
      } else {
        await refetchRepositoryCases();
        await refetchData();
      }
    }
  };

  const handleCloseBulkEditModal = (refetchNeeded?: boolean) => {
    setIsBulkEditModalOpen(false);
    if (refetchNeeded) {
      refetchRepositoryCases(); // This refetches both data and count
      refetchTestRunCases();
      // Clear selection after successful bulk edit operation
      setRowSelection({});
      setSelectedCaseIdsForBulkEdit([]);
    }
  };

  // Add the handler for the new button
  const handleCreateTestRun = useCallback(() => {
    if (selectedCaseIdsForBulkEdit.length > 0 && isValidProjectId) {
      // Store selected case IDs in sessionStorage to avoid URL length limits
      sessionStorage.setItem(
        "createTestRun_selectedCases",
        JSON.stringify(selectedCaseIdsForBulkEdit)
      );

      const queryParams = new URLSearchParams({
        openAddRun: "true",
      });
      router.push(`/projects/runs/${projectId}?${queryParams.toString()}`);
    }
  }, [selectedCaseIdsForBulkEdit, router, projectId, isValidProjectId]);

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
    [orderBy, repositoryCaseWhereClause, projectId]
  );

  // Instantiate the hook
  const { handleExport, isExporting } = useExportData<any>({
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
        <div className="flex flex-row items-start">
          <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
            {/* filterComponent should always be rendered if we've reached this point */}
            {filterComponent}
            <div className="mt-4">
              <ColumnSelection
                key="repository-cases-column-selection"
                columns={columns}
                columnMetadata={columnMetadata}
                onVisibilityChange={(newVisibility) => {
                  setColumnVisibility(newVisibility);
                }}
              />
            </div>
          </div>

          <div className="flex flex-col w-full sm:w-2/3 items-end">
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
              />
            </div>
            <div className="justify-end -mx-4">
              <PaginationComponent
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
            <div className="flex gap-2 pt-2 items-center -mb-2">
              {canAddEdit &&
                !isSelectionMode &&
                !isRunMode &&
                selectedCaseIdsForBulkEdit.length > 0 && (
                  <Button
                    onClick={() => setIsBulkEditModalOpen(true)}
                    disabled={selectedCaseIdsForBulkEdit.length === 0}
                    variant="outline"
                    data-testid="bulk-edit-button"
                  >
                    <div className="flex flex-row items-center gap-1">
                      <PenSquare className="w-4 h-4" />
                      {t("repository.cases.bulkEdit")}
                      <span>{`(${selectedCaseIdsForBulkEdit.length})`}</span>
                    </div>
                  </Button>
                )}
              {!isRunMode &&
                !isSelectionMode &&
                canAddEditRun &&
                selectedCaseIdsForBulkEdit.length > 0 && (
                  <Button
                    onClick={handleCreateTestRun}
                    disabled={selectedCaseIdsForBulkEdit.length === 0}
                    variant="outline"
                    data-testid="create-test-run-button"
                  >
                    <div className="flex flex-row items-center gap-1">
                      <PlayCircle className="w-4 h-4" />
                      {t("repository.cases.createTestRun")}
                      <span>{`(${selectedCaseIdsForBulkEdit.length})`}</span>
                    </div>
                  </Button>
                )}
              {canAddEdit && !isSelectionMode && !isRunMode && (
                <Button
                  onClick={() => setIsExportModalOpen(true)}
                  disabled={totalItems === 0}
                  variant="outline"
                  data-testid="export-cases-button"
                >
                  <div className="flex flex-row items-center gap-1">
                    <Upload className="w-4 h-4" />
                    {t("repository.cases.export")}
                  </div>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {(() => {
          // Handle preliminary states first (where DataTable might not be relevant)
          if (!folderId && viewType === "folders") {
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
                key={`${folderId}-${viewType}-${filterId}-loading`}
                columns={columns}
                data={[]} // Pass empty data while loading
                onSortChange={isCompleted ? undefined : handleSortChange}
                sortConfig={isCompleted ? undefined : sortConfig}
                enableReorder={false} // No reorder while loading
                onReorder={handleReorder}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={true}
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
              />
            );
          }

          // Handle empty states after loading and not in preliminary states
          if (cases.length === 0) {
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
              <div className="m-1 mb-4 text-muted-foreground">
                {t("repository.cases.noTestCases")}
              </div>
            );
          }

          // Default content: DataTable with data
          return (
            <>
              <DataTable
                key={`${folderId}-${viewType}-${filterId}-datatable`}
                columns={columns}
                data={cases}
                onSortChange={isCompleted ? undefined : handleSortChange}
                sortConfig={isCompleted ? undefined : sortConfig}
                enableReorder={
                  isDefaultSort &&
                  !isSelectionMode &&
                  !isCompleted &&
                  ((isRunMode && canAddEditRun) || (!isRunMode && canAddEdit))
                }
                onReorder={handleReorder}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={false} // Explicitly false as loading is handled above
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                canEdit={
                  (!isRunMode && canAddEdit) || (isRunMode && canAddEditRun)
                }
                rowSelection={rowSelection}
                onRowSelectionChange={handleTableRowSelectionChange}
                selectedItemsForDrag={selectedItemsForDrag}
              />
              {!isSelectionMode && !isRunMode && folderId && canAddEdit && (
                <AddCaseRow folderId={folderId} />
              )}
            </>
          );
        })()}
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
    </Card>
  );
}
