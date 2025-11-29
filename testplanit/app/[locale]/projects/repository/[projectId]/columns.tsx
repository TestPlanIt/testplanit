import { ColumnDef } from "@tanstack/react-table";
import { useRouter, usePathname } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useCreateTestRunCases, useFindManyTestRuns } from "~/lib/hooks";
import { getMaxOrderInTestRun } from "~/app/actions/test-run";
import { cn } from "~/utils";

import {
  RepositoryCases,
  Color,
  FieldIcon,
  Workflows,
  CaseFields,
  Attachments,
  Steps,
  Projects,
  RepositoryFolders,
  User,
  Status,
  Issue,
  Tags,
  RepositoryCaseSource,
} from "@prisma/client";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { DurationDisplay } from "@/components/DurationDisplay";
import { Switch } from "@/components/ui/switch";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { DateFormatter } from "@/components/DateFormatter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AttachmentsListDisplay } from "@/components/tables/AttachmentsListDisplay";
import { StepsListDisplay } from "@/components/tables/StepsListDisplay";
import { DeleteCaseModal } from "./DeleteCase";
import { TagsListDisplay } from "@/components/tables/TagListDisplay";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import PlainTextFromJson from "@/components/TextFromJson";
import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { Link } from "~/lib/navigation";
import {
  LinkIcon,
  ArrowRight,
  Folder,
  MoreVertical,
  UserCog,
  ExternalLink,
  PlayCircle,
  PlusSquare,
  Check,
  Plus,
  GripVertical,
  ListChecks,
  Bot,
  Trash2,
} from "lucide-react";
import { useFindManyRepositoryFolders, useFindManyStatus } from "~/lib/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AssignTestCaseModal } from "./AssignTestCase";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { CommentsListDisplay } from "@/components/tables/CommentsListDisplay";
import { AddResultModal } from "./AddResultModal";
import { notifyTestCaseAssignment } from "~/app/actions/test-run-notifications";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { useUpdateTestRunCases } from "~/lib/hooks";
import LoadingSpinner from "~/components/LoadingSpinner";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { ForecastDisplay } from "~/components/ForecastDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { ScrollArea } from "~/components/ui/scroll-area";

export interface ExtendedCases extends RepositoryCases {
  className: string | null;
  source: RepositoryCaseSource;
  state: Pick<Workflows, "id" | "name"> & {
    icon: Pick<FieldIcon, "name">;
    color: Pick<Color, "value">;
  };
  attachments: Attachments[];
  tags?: Tags[];
  steps?: Steps[] | undefined;
  project: Projects;
  creator: User;
  folder: RepositoryFolders;
  template: {
    id: number;
    templateName: string;
    caseFields: {
      caseField: {
        id: number;
        defaultValue: string | null;
        displayName: string;
        isRequired: boolean;
        isRestricted: boolean;
        type: {
          type: string;
        };
        fieldOptions: {
          fieldOption: {
            id: number;
            name: string;
            icon: { id: number; name: string } | null;
            iconColor: {
              id: number;
              colorFamilyId: number;
              value: string;
              order: number;
            } | null;
          };
        }[];
      };
    }[];
  };
  caseFieldValues: {
    id: number;
    value: object | null | string | number | boolean;
    fieldId: number;
    field: {
      id: number;
      displayName: string;
      type: {
        type: string;
      };
    };
  }[];
  // Test run specific fields
  testRunCaseId?: number;
  testRunStatus?: {
    id: number;
    name: string;
    color: {
      value: string;
    };
  } | null;
  testRunStatusId?: number | null;
  assignedToId?: string | null;
  assignedTo?: {
    id: string;
    name: string;
  } | null;
  isCompleted?: boolean;
  notes?: any;
  startedAt?: Date | null;
  completedAt?: Date | null;
  elapsed?: number | null;
  testRuns?: {
    id: number;
    testRun: {
      id: number;
      name: string;
      isDeleted: boolean;
      projectId?: number;
      isCompleted: boolean;
      milestone?: {
        name: string;
      } | null;
    };
    results?: {
      id: number;
      status: {
        name: string;
        color?: {
          value: string;
        };
      };
      executedBy: {
        id: string;
        name: string;
      };
      executedAt: Date;
      editedBy?: {
        id: string;
        name: string;
      } | null;
      editedAt?: Date | null;
      elapsed?: number;
      attempt: number;
    }[];
  }[];
  issues?: Issue[];
  linksFrom?: { caseBId: number; isDeleted: boolean }[];
  linksTo?: { caseAId: number; isDeleted: boolean }[];
  testRunConfiguration?: { id: number; name: string } | null;
}

interface NameCellProps {
  name: string;
  id: number;
  projectId: number;
  isRunMode: boolean;
  isSelectionMode: boolean;
  columnSize: number;
  onTestCaseClick?: (caseId: number) => void;
  folder?: {
    id: number;
    name: string;
    path?: string;
  };
  viewType?: string;
  canAddEditResults?: boolean;
  source?: RepositoryCaseSource;
  isSoftDeletedInRun?: boolean;
}

const NameCell = React.memo(function NameCell({
  name,
  id,
  projectId,
  isRunMode,
  isSelectionMode,
  columnSize,
  onTestCaseClick,
  folder,
  viewType,
  canAddEditResults,
  source,
  isSoftDeletedInRun,
}: NameCellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // DISABLED: Fetch all folders to build the path hierarchy
  // TODO: Replace with API endpoint that fetches only the path for a specific folder
  // This was causing performance issues by loading all folders for each case row
  const { data: allFolders } = useFindManyRepositoryFolders(
    {
      where: {
        projectId: projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        parentId: true,
      },
    },
    {
      enabled: false, // Temporarily disabled to prevent loading all folders
    }
  );

  // Build the full folder path
  const folderPath = React.useMemo(() => {
    if (!folder || !allFolders) return "";

    const getFolderPath = (folderId: number, path: string = ""): string => {
      const currentFolder = allFolders.find((f) => f.id === folderId);
      if (!currentFolder) return path;

      const newPath = currentFolder.name + (path ? " › " + path : "");

      if (currentFolder.parentId) {
        return getFolderPath(currentFolder.parentId, newPath);
      }

      return newPath;
    };

    return getFolderPath(folder.id);
  }, [folder, allFolders]);

  if (isRunMode && canAddEditResults) {
    const handleClick = () => {
      if (isSoftDeletedInRun) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("selectedCase", id.toString());
      router.replace(`${pathname}?${params.toString()}`);
    };

    const showFolderInfo = viewType && viewType !== "folders" && folder;

    return (
      <div className="flex items-center">
        {isSoftDeletedInRun ? (
          <Trash2 className="w-4 h-4 mr-1 text-muted-foreground shrink-0" />
        ) : source === "JUNIT" ? (
          <Bot className="w-4 h-4 mr-1 text-primary shrink-0" />
        ) : (
          <ListChecks className="w-4 h-4 mr-1 text-muted-foreground shrink-0" />
        )}
        <div
          className={cn(
            "truncate whitespace-nowrap overflow-hidden group",
            isSoftDeletedInRun ? "cursor-default" : "cursor-pointer",
            isSoftDeletedInRun && "line-through text-muted-foreground"
          )}
          style={{
            maxWidth: showFolderInfo
              ? Math.max(columnSize - 150, 150)
              : columnSize,
          }}
          onClick={handleClick}
        >
          {name}
          <ArrowRight className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>

        {showFolderInfo && folder && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ml-2 text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded truncate max-w-[150px] flex items-center hover:bg-muted/80 transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("view", "folders");
                    params.set("node", folder.id.toString());
                    router.push(`${pathname}?${params.toString()}`);
                  }}
                >
                  <Folder className="w-3 h-3 mr-1 shrink-0" />
                  {folder.name}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-md">
                <div className="text-xs">{folderPath || folder.name}</div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    );
  }

  const showFolderInfo = viewType && viewType !== "folders" && folder;

  return (
    <div className="flex items-center">
      {isSoftDeletedInRun ? (
        <Trash2 className="w-4 h-4 mr-1 text-muted-foreground shrink-0" />
      ) : source === "JUNIT" ? (
        <Bot className="w-4 h-4 mr-1 text-primary shrink-0" />
      ) : (
        <ListChecks className="w-4 h-4 mr-1 text-primary shrink-0" />
      )}
      <Link
        href={`/projects/repository/${projectId}/${id}`}
        className={cn(
          "group",
          isSoftDeletedInRun && "line-through text-muted-foreground"
        )}
        target={isSelectionMode ? "_blank" : undefined}
      >
        <div
          className="truncate whitespace-nowrap overflow-hidden"
          style={{
            maxWidth: showFolderInfo
              ? Math.max(columnSize - 150, 150)
              : columnSize,
          }}
        >
          {name}
          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
      </Link>

      {showFolderInfo && folder && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="ml-2 text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded truncate max-w-[150px] flex items-center hover:bg-muted/80 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("view", "folders");
                  params.set("node", folder.id.toString());
                  router.push(`${pathname}?${params.toString()}`);
                }}
              >
                <Folder className="w-3 h-3 mr-1 shrink-0" />
                {folder.name}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-md">
              <div className="text-xs">{folderPath || folder.name}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
});

const TestRunStatusCell = React.memo(function TestRunStatusCell({
  status,
  caseId,
  testRunCaseId,
  currentAssignee,
  testRunId,
  caseName,
  projectId,
  table,
  onModalOpen,
  isCompleted,
  steps,
  isSoftDeletedInRun,
  onOpenAddResultModal,
}: {
  status: ExtendedCases["testRunStatus"];
  caseId: number;
  testRunCaseId?: number;
  currentAssignee?: {
    id: string;
    name: string;
  } | null;
  testRunId: number;
  caseName: string;
  projectId: number;
  table?: any;
  onModalOpen?: (isOpen: boolean) => void;
  isCompleted?: boolean;
  steps?: Steps[];
  isSoftDeletedInRun?: boolean;
  onOpenAddResultModal?: (modalData: {
    testRunCaseId?: number;
    testRunId: number;
    caseName: string;
    projectId: number;
    defaultStatusId?: string;
    isBulkResult?: boolean;
    selectedCases?: ExtendedCases[];
    steps?: any[];
  }) => void;
}) {
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isBulkAssign, setIsBulkAssign] = useState(false);
  const [isInitialRender, setIsInitialRender] = useState(true);
  const t = useTranslations();

  const { mutateAsync: updateTestRunCase } = useUpdateTestRunCases();

  useEffect(() => {
    setIsInitialRender(false);
  }, []);

  const { data: statuses } = useFindManyStatus({
    where: {
      AND: [
        { isEnabled: true },
        { isDeleted: false },
        {
          projects: {
            some: {
              projectId: Number(projectId),
            },
          },
        },
        {
          scope: {
            some: {
              scope: {
                name: "Test Run",
              },
            },
          },
        },
      ],
    },
    orderBy: {
      order: "asc",
    },
    include: {
      color: {
        select: {
          value: true,
        },
      },
    },
  });

  const defaultStatus = statuses?.[0];
  const successStatus = statuses?.find(
    (status: Status) => status.isSuccess === true
  );

  const displayStatus = status || defaultStatus;
  if (!displayStatus) return null;

  // Combine isCompleted with isSoftDeletedInRun for disabling logic
  const isDisabled = isCompleted || isSoftDeletedInRun;

  const selectedCount = table?.getState
    ? Object.keys(table.getState().rowSelection || {}).length
    : 0;

  const isRowSelected =
    selectedCount > 0 && table?.getState().rowSelection
      ? Object.entries(table.getState().rowSelection).some(
          ([key, selected]) => {
            if (!selected) return false;
            const row = table.getRow(key);
            return row?.original?.id === caseId;
          }
        )
      : false;

  const isMenuDisabled = selectedCount > 0 && !isRowSelected;

  const getSelectedCases = () => {
    if (!table || selectedCount === 0) return [];
    return Object.keys(table.getState().rowSelection || {}).map(
      (rowId) => table.getRow(rowId).original
    );
  };

  const handleBulkAssign = () => {
    if (isCompleted) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsBulkAssign(true);
    setShowAssignModal(true);
    onModalOpen?.(true);
  };

  const handleSingleAssign = () => {
    if (isCompleted) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsBulkAssign(false);
    setShowAssignModal(true);
    onModalOpen?.(true);
  };

  const handleAssignModalClose = () => {
    setShowAssignModal(false);
    onModalOpen?.(false);
  };

  const handleStatusChange = (statusId: string) => {
    if (isCompleted) return;
    if (isInitialRender) return;
    if (onOpenAddResultModal) {
      onOpenAddResultModal({
        testRunCaseId,
        testRunId,
        caseName,
        projectId,
        defaultStatusId: statusId,
        isBulkResult: false,
        steps,
      });
    }
    onModalOpen?.(true);
  };

  const handleBulkResult = () => {
    if (isCompleted) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (onOpenAddResultModal) {
      onOpenAddResultModal({
        testRunId,
        caseName,
        projectId,
        isBulkResult: true,
        selectedCases: getSelectedCases(),
      });
    }
    onModalOpen?.(true);
  };

  const handleSingleResult = () => {
    if (isCompleted) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (onOpenAddResultModal) {
      onOpenAddResultModal({
        testRunCaseId,
        testRunId,
        caseName,
        projectId,
        defaultStatusId: successStatus?.id?.toString(),
        isBulkResult: false,
        steps,
      });
    }
    onModalOpen?.(true);
  };

  const hasColor = (
    s: typeof displayStatus
  ): s is { id: number; name: string; color: { value: string } } => {
    return "color" in s && s.color !== undefined;
  };

  return (
    <>
      <div className="flex items-center justify-between w-fit">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-[120px] h-8 bg-transparent hover:bg-muted justify-start"
              disabled={isDisabled}
            >
              <div className="flex items-center space-x-1 whitespace-nowrap">
                <StatusDotDisplay
                  name={displayStatus.name}
                  color={
                    hasColor(displayStatus)
                      ? displayStatus.color.value
                      : undefined
                  }
                />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[140px]">
            {statuses?.map((statusOption) => (
              <DropdownMenuItem
                key={statusOption.id}
                onClick={() => handleStatusChange(statusOption.id.toString())}
                className={`flex items-center cursor-pointer ${
                  statusOption.id === displayStatus.id ? "bg-muted" : ""
                }`}
              >
                <StatusDotDisplay
                  name={statusOption.name}
                  color={statusOption.color?.value}
                  dotClassName="w-3 h-3 rounded-full mr-2"
                  nameClassName="flex-1"
                />
                {statusOption.id === displayStatus.id && (
                  <Check className="h-4 w-4 ml-2 text-muted-foreground" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isMenuDisabled || isDisabled}>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ml-1 ${isMenuDisabled || isDisabled ? "text-muted-foreground opacity-30 cursor-not-allowed" : ""}`}
              disabled={isMenuDisabled || isDisabled}
            >
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">
                {t("common.actions.actionsLabel")}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {selectedCount > 1 ? (
              <>
                <DropdownMenuItem
                  className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={handleBulkAssign}
                  disabled={isDisabled}
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  <UserCog className="mr-2 h-4 w-4" />
                  <span>
                    {t("common.actions.assignSelected", {
                      count: selectedCount,
                    })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={handleBulkResult}
                  disabled={isDisabled}
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span>
                    {t("common.actions.addResultSelected", {
                      count: selectedCount,
                    })}
                  </span>
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={handleSingleAssign}
                  disabled={isDisabled}
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  <UserCog className="mr-2 h-4 w-4" />
                  <span>{t("common.actions.assign")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={handleSingleResult}
                  disabled={isDisabled}
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span>{t("common.actions.addResult")}</span>
                </DropdownMenuItem>
              </>
            )}
            <Link
              href={`/projects/repository/${projectId}/${caseId}`}
              target="_blank"
            >
              <DropdownMenuItem className="flex items-center cursor-pointer">
                <ExternalLink className="mr-2 h-4 w-4" />
                <span>{t("common.actions.viewInRepository")}</span>
              </DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showAssignModal && (
        <AssignTestCaseModal
          isOpen={showAssignModal}
          onClose={handleAssignModalClose}
          testRunId={testRunId}
          testRunCaseId={isBulkAssign ? undefined : testRunCaseId}
          caseId={caseId}
          caseName={caseName}
          currentAssigneeId={currentAssignee?.id}
          projectId={projectId}
          isBulkAssign={isBulkAssign}
          selectedCases={isBulkAssign ? getSelectedCases() : undefined}
        />
      )}
    </>
  );
});

const AddToTestRunDropdown = React.memo(function AddToTestRunDropdown({
  caseId,
  projectId,
}: {
  caseId: number;
  projectId: number;
}) {
  const t = useTranslations();
  const { mutateAsync: createTestRunCases } = useCreateTestRunCases();

  const {
    data: testRuns,
    isLoading: isLoadingTestRuns,
    refetch: refetchTestRuns,
  } = useFindManyTestRuns({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isCompleted: false },
        { isDeleted: false },
        {
          NOT: {
            testCases: {
              some: {
                repositoryCaseId: caseId,
              },
            },
          },
        },
      ],
    },
    orderBy: { name: "asc" },
  });

  const handleAddToTestRun = async (testRunId: number) => {
    try {
      // Get the current maximum order for the selected test run
      const maxOrder = await getMaxOrderInTestRun(testRunId);
      const newOrder = maxOrder.data + 1;

      await createTestRunCases({
        data: {
          testRunId: testRunId,
          repositoryCaseId: caseId,
          order: newOrder,
        },
      });

      await refetchTestRuns();

      toast.success(t("common.actions.addedToTestRun"), {
        description: t("common.actions.addedToTestRunDescription"),
      });
    } catch (error) {
      console.error("Error adding test case to test run:", error);
      toast.error(t("common.errors.error"), {
        description: t("common.errors.somethingWentWrong"),
      });
    }
  };

  if (isLoadingTestRuns) {
    return <LoadingSpinner />;
  }

  if (!testRuns?.length) {
    return (
      <DropdownMenuLabel>
        {t("common.actions.noAvailableTestRuns")}
      </DropdownMenuLabel>
    );
  }

  return (
    <div className="max-h-[400px] overflow-y-auto">
      <DropdownMenuLabel className="flex items-center">
        <PlusSquare className="mr-1 h-4 w-4" />
        {t("common.actions.addToTestRun")}
      </DropdownMenuLabel>
      <Separator />
      {testRuns?.map((testRun) => (
        <DropdownMenuItem
          key={testRun.id}
          onClick={() => handleAddToTestRun(testRun.id)}
        >
          <PlayCircle className="mr-1 h-4 w-4" />
          <span>{testRun.name}</span>
        </DropdownMenuItem>
      ))}
    </div>
  );
});

const ActionsCell = React.memo(function ActionsCell({
  row,
  isRunMode,
  isSelectionMode,
  canDelete,
  canAddEditRun,
  isSoftDeletedInRun,
}: {
  row: any;
  isRunMode: boolean;
  isSelectionMode: boolean;
  canDelete?: boolean;
  canAddEditRun?: boolean;
  isSoftDeletedInRun?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="whitespace-nowrap flex justify-center gap-1 w-full">
      {canDelete && (
        <DeleteCaseModal
          key={`delete-${row.original.id}`}
          testcase={row.original}
          showLabel={false}
        />
      )}
      {!isRunMode && !isSelectionMode && canAddEditRun && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" disabled={isSoftDeletedInRun}>
                    <PlusSquare className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                {!isSoftDeletedInRun && (
                  <DropdownMenuContent align="end">
                    <AddToTestRunDropdown
                      caseId={row.original.id}
                      projectId={row.original.projectId}
                    />
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("common.actions.addToTestRun")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
});

const AssigneeCell = React.memo(function AssigneeCell({
  row,
  isCompleted,
  canAddEditResults,
  isSoftDeletedInRun,
}: {
  row: { original: ExtendedCases };
  isCompleted?: boolean;
  canAddEditResults?: boolean;
  isSoftDeletedInRun?: boolean;
}) {
  const [isAssigning, setIsAssigning] = useState(false);
  const t = useTranslations();
  const { mutateAsync: updateTestRunCase } = useUpdateTestRunCases();

  const handleAssignmentChange = async (
    user: {
      id: string;
      name: string;
      email: string | null;
      image: string | null;
    } | null
  ) => {
    if (!row.original.testRunCaseId || isAssigning || isCompleted) return;
    setIsAssigning(true);

    try {
      const previousAssigneeId = row.original.assignedTo?.id || null;
      const userId = user?.id || null;

      await updateTestRunCase({
        where: {
          id: row.original.testRunCaseId,
        },
        data: {
          assignedToId: userId,
        },
      });

      // Send notification for the assignment
      if (userId && userId !== previousAssigneeId) {
        await notifyTestCaseAssignment(
          row.original.testRunCaseId,
          userId,
          previousAssigneeId
        );
      }

      toast.success(
        userId ? t("common.success.assigned") : t("common.success.unassigned")
      );
    } catch (error) {
      console.error("Error assigning user:", error);
      toast.error(t("common.errors.somethingWentWrong"));
    } finally {
      setIsAssigning(false);
    }
  };

  const isDisabled = isCompleted || !canAddEditResults || isSoftDeletedInRun;

  // Convert current assignee to AsyncCombobox format
  const currentUser = row.original.assignedTo
    ? {
        id: row.original.assignedTo.id,
        name: row.original.assignedTo.name,
        email: null,
        image: null,
      }
    : null;

  return (
    <AsyncCombobox
      value={currentUser}
      onValueChange={handleAssignmentChange}
      fetchOptions={(query, page, pageSize) =>
        searchProjectMembers(row.original.projectId, query, page, pageSize)
      }
      renderOption={(user) => <UserNameCell userId={user.id} hideLink />}
      getOptionValue={(user) => user.id}
      placeholder={t("sessions.placeholders.selectUser")}
      disabled={isDisabled}
      className="h-8 w-[200px]"
      pageSize={20}
      showTotal={true}
      showUnassigned={true}
    />
  );
});

export const getColumns = (
  session: any,
  uniqueCaseFieldList: CaseFields[],
  handleSelect: (attachments: Attachments[], index: number) => void,
  columnTranslations: {
    name: string;
    estimate: string;
    forecast: string;
    state: string;
    automated: string;
    template: string;
    createdAt: string;
    createdBy: string;
    attachments: string;
    steps: string;
    tags: string;
    actions: string;
    status: string;
    assignedTo: string;
    unassigned: string;
    selectCase: string;
    testRuns: string;
    runOrder: string;
    issues: string;
    id: string;
    linkedCases: string;
    versions: string;
    clickToViewFullContent: string;
    comments: string;
    configuration: string;
  },
  isRunMode: boolean = false,
  isSelectionMode: boolean = false,
  onTestCaseClick?: (caseId: number) => void,
  viewType?: string,
  runId?: number,
  isCompleted?: boolean,
  canAddEditResults?: boolean,
  canDelete?: boolean,
  canAddEditRun?: boolean,
  sortConfig?: { column: string; direction: "asc" | "desc" },
  handleCheckboxClick?: (rowIndex: number, event: React.MouseEvent) => void,
  handleSelectAllClick?: (event: React.MouseEvent) => void,
  onOpenAddResultModal?: (modalData: {
    testRunCaseId?: number;
    testRunId: number;
    caseName: string;
    projectId: number;
    defaultStatusId?: string;
    isBulkResult?: boolean;
    selectedCases?: ExtendedCases[];
    steps?: any[];
  }) => void,
  isMultiConfigRun?: boolean
): ColumnDef<ExtendedCases>[] => {
  const isStepsFieldPresent = uniqueCaseFieldList.some(
    (field) => field.displayName === "Steps"
  );

  const filteredCaseFieldList = uniqueCaseFieldList.filter(
    (field) => field.displayName !== "Steps"
  );

  const linkedCasesColumn: ColumnDef<ExtendedCases> = {
    id: "linkedCases",
    header: columnTranslations.linkedCases,
    enableSorting: false,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: false },
    size: 120,
    cell: ({ row }) => {
      // Collect linked case IDs from both linksFrom and linksTo, filtering out soft-deleted links
      const linksFrom =
        row.original.linksFrom?.filter((l: any) => !l.isDeleted) || [];
      const linksTo =
        row.original.linksTo?.filter((l: any) => !l.isDeleted) || [];
      const linkedIds = [
        ...linksFrom.map((l: any) => l.caseBId),
        ...linksTo.map((l: any) => l.caseAId),
      ];
      // Remove duplicates
      const uniqueLinkedIds = Array.from(new Set(linkedIds));
      if (uniqueLinkedIds.length === 0) return null;
      return (
        <CasesListDisplay
          caseIds={uniqueLinkedIds}
          count={uniqueLinkedIds.length}
        />
      );
    },
  };

  const selectionColumn: ColumnDef<ExtendedCases> = {
    id: "select",
    header: ({ table }) => {
      // Determine if the handle *would* be shown in rows to adjust header padding
      const isMode1 = !isRunMode && !isSelectionMode;
      const isSortedByOrder = sortConfig?.column === "order";
      const showHandle =
        !isSelectionMode && (isRunMode || (isMode1 && isSortedByOrder));

      return (
        <div
          // Use the calculated showHandle to set padding
          className={`flex items-center justify-center w-full ${showHandle ? "pl-6" : "pl-3"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={
              table.getIsSomeRowsSelected()
                ? "indeterminate"
                : table.getIsAllRowsSelected()
            }
            onCheckedChange={(value) => {
              if (!handleSelectAllClick) {
                table.toggleAllRowsSelected(!!value);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (handleSelectAllClick) {
                e.preventDefault();
                handleSelectAllClick(e);
              }
            }}
            aria-label={columnTranslations.selectCase}
          />
        </div>
      );
    },
    cell: ({ row }) => {
      const isDeletedInRun = isRunMode && row.original.isDeleted;
      // Determine if the handle should be shown
      // Mode 3 (Run Mode): Always show if not selection mode
      // Mode 1 (Repo Mode): Show only if sorted by order AND not selection mode
      const isMode1 = !isRunMode && !isSelectionMode;
      const isSortedByOrder = sortConfig?.column === "order";
      const showHandle =
        !isSelectionMode && (isRunMode || (isMode1 && isSortedByOrder));

      return (
        <div
          className="flex items-center justify-center gap-1 w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {showHandle && (
            <GripVertical
              className="h-5 w-5 min-w-5 min-h-5 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
          )}
          <Checkbox
            className="bg-primary-foreground"
            checked={row.getIsSelected?.() || false}
            onCheckedChange={(value) => {
              // Only handle if handleCheckboxClick is not provided (fallback)
              if (!isDeletedInRun && !handleCheckboxClick) {
                // Only toggle if not deleted
                row.toggleSelected?.(!!value);
              }
            }}
            onClick={(e) => {
              // Stop propagation to prevent row click
              e.stopPropagation();

              if (!isDeletedInRun && handleCheckboxClick) {
                // Prevent default to avoid double handling
                e.preventDefault();
                // Use the provided handler for shift-click support
                handleCheckboxClick(row.index, e);
              }
            }}
            aria-label={columnTranslations.selectCase}
            disabled={isDeletedInRun} // Disable checkbox if deleted in run
          />
        </div>
      );
    },
    enableSorting: false,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 50,
    minSize: 50,
    maxSize: 50,
  };

  const dynamicColumns: ColumnDef<ExtendedCases>[] = filteredCaseFieldList.map(
    (field) => ({
      id: field.id.toString(),
      accessorFn: (row) =>
        row.caseFieldValues.find((cf: any) => cf.fieldId === field.id)?.value,
      header: field.displayName,
      enableSorting: false,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 200,
      cell: ({ row, column }) => {
        const caseFieldValue = row.original.caseFieldValues.find(
          (cf: any) => cf.fieldId === field.id
        );

        const value = caseFieldValue?.value;
        const fieldType = caseFieldValue?.field.type.type;
        if (fieldType === "Dropdown" || fieldType === "Multi-Select") {
          const valuesArray = Array.isArray(value)
            ? value.map((val) => Number(val))
            : [Number(value)];
          const fieldOptions = valuesArray.map((val) =>
            row.original.template.caseFields
              .find((cf: any) => cf.caseField.id === field.id)
              ?.caseField.fieldOptions.find(
                (fo: any) => fo.fieldOption.id === val
              )
          );

          return (
            <div className="flex gap-2 whitespace-nowrap">
              {fieldOptions.map((fieldOption, index) =>
                fieldOption ? (
                  <div key={index} className="flex items-center space-x-1">
                    <DynamicIcon
                      className="w-5 h-5 min-w-5 min-h-5"
                      name={fieldOption.fieldOption.icon?.name as IconName}
                      color={fieldOption.fieldOption.iconColor?.value}
                    />
                    <span className="pr-1">{fieldOption.fieldOption.name}</span>
                    {index < fieldOptions.length - 1 && (
                      <Separator orientation="vertical" />
                    )}
                  </div>
                ) : null
              )}
            </div>
          );
        }

        if (fieldType === "Checkbox") {
          return (
            <div className="flex justify-center whitespace-nowrap">
              <Switch disabled checked={Boolean(value)} />
            </div>
          );
        }

        if (fieldType === "Date") {
          return (
            <div
              className="truncate whitespace-nowrap overflow-hidden"
              style={{ maxWidth: column.getSize() }}
            >
              <DateFormatter
                date={value as string | Date | null}
                formatString={session?.user.preferences?.dateFormat}
                timezone={session?.user.preferences?.timezone}
              />
            </div>
          );
        }

        if (fieldType === "Link") {
          return (
            <div
              className="truncate whitespace-nowrap overflow-hidden"
              style={{ maxWidth: column.getSize() }}
            >
              <Link
                target="_blank"
                rel="noreferrer"
                href={
                  value === null || value === undefined
                    ? ""
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : value.toString()
                }
              >
                {value === null || value === undefined
                  ? ""
                  : typeof value === "object"
                    ? JSON.stringify(value)
                    : value.toString()}
              </Link>
            </div>
          );
        }

        if (fieldType === "Number" || fieldType === "Integer") {
          return (
            <div
              className="truncate whitespace-nowrap overflow-hidden"
              style={{ maxWidth: column.getSize() }}
            >
              {value === null || value === undefined
                ? ""
                : typeof value === "object"
                  ? JSON.stringify(value)
                  : value.toString()}
            </div>
          );
        }

        if (fieldType === "Text Long") {
          return (
            <Dialog>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                      <div
                        className="items-center flex w-fit cursor-pointer hover:bg-muted rounded px-2 py-1"
                        key={row.original.id.toString()}
                      >
                        <div
                          className="truncate whitespace-nowrap overflow-hidden"
                          style={{ maxWidth: column.getSize() }}
                          key={row.original.id.toString()}
                        >
                          {value === null || value === undefined ? (
                            ""
                          ) : typeof value === "string" ? (
                            <PlainTextFromJson
                              jsonString={value}
                              room={row.original.id.toString()}
                            />
                          ) : (
                            <PlainTextFromJson
                              jsonString={JSON.stringify(value).toString()}
                              room={row.original.id.toString()}
                            />
                          )}
                        </div>
                      </div>
                    </DialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{columnTranslations.clickToViewFullContent}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                  <DialogTitle>{field.displayName}</DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-auto">
                  {value === null || value === undefined ? (
                    ""
                  ) : typeof value === "string" ? (
                    <PlainTextFromJson
                      jsonString={value}
                      room={row.original.id.toString()}
                      format="html"
                      expand={true}
                      expandable={false}
                    />
                  ) : (
                    <PlainTextFromJson
                      jsonString={JSON.stringify(value).toString()}
                      room={row.original.id.toString()}
                      format="html"
                      expand={true}
                      expandable={false}
                    />
                  )}
                </div>
              </DialogContent>
            </Dialog>
          );
        }

        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <div
                  className="truncate whitespace-nowrap overflow-hidden"
                  style={{ maxWidth: column.getSize() }}
                >
                  {value === null || value === undefined
                    ? ""
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : value.toString()}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-pretty">
                  {value === null || value === undefined
                    ? ""
                    : typeof value === "object"
                      ? JSON.stringify(value)
                      : value.toString()}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
    })
  );

  const staticColumns: ColumnDef<ExtendedCases>[] = [
    {
      id: "name",
      accessorKey: "name",
      header: columnTranslations.name,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 400,
      minSize: 100,
      maxSize: 1200,
      cell: ({ row, column }) => (
        <NameCell
          name={row.original.name}
          id={row.original.id}
          projectId={row.original.projectId}
          isRunMode={isRunMode}
          isSelectionMode={isSelectionMode}
          columnSize={column.getSize()}
          onTestCaseClick={onTestCaseClick}
          folder={
            row.original.folder
              ? {
                  id: row.original.folder.id,
                  name: row.original.folder.name,
                  path: row.original.folder.name,
                }
              : undefined
          }
          viewType={viewType}
          canAddEditResults={canAddEditResults}
          source={row.original.source}
          isSoftDeletedInRun={isRunMode && row.original.isDeleted}
        />
      ),
    },
    ...(isRunMode
      ? [
          {
            id: "order",
            accessorKey: "order",
            header: columnTranslations.runOrder,
            enableSorting: true,
            enableResizing: true,
            enableHiding: true,
            size: 120,
            minSize: 80,
            cell: ({ row }: { row: { original: ExtendedCases } }) => (
              <div className="text-center">{row.original.order}</div>
            ),
          },
        ]
      : []),
    ...(isRunMode
      ? [
          {
            id: "configuration",
            accessorKey: "testRunConfiguration",
            header: columnTranslations.configuration,
            enableSorting: false,
            enableResizing: true,
            enableHiding: true,
            meta: { isVisible: true },
            size: 150,
            minSize: 50,
            maxSize: 300,
            cell: ({ row }: { row: { original: ExtendedCases } }) => (
              <ConfigurationNameDisplay
                name={row.original.testRunConfiguration?.name}
                fallback="-"
                truncate
              />
            ),
          },
        ]
      : []),
    ...(isRunMode
      ? [
          {
            id: "assignedTo",
            accessorKey: "assignedTo",
            header: columnTranslations.assignedTo,
            enableSorting: !isCompleted,
            enableResizing: true,
            enableHiding: true,
            size: 200,
            minSize: 150,
            cell: ({ row }: { row: { original: ExtendedCases } }) => {
              const isSoftDeletedInRun = isRunMode && row.original.isDeleted;
              return (
                <AssigneeCell
                  row={row}
                  isCompleted={isCompleted}
                  canAddEditResults={canAddEditResults}
                  isSoftDeletedInRun={isSoftDeletedInRun}
                />
              );
            },
          },
        ]
      : []),
    ...(!isRunMode && !isSelectionMode
      ? [
          {
            id: "testRuns",
            header: columnTranslations.testRuns,
            enableSorting: false,
            enableResizing: true,
            enableHiding: true,
            meta: { isVisible: true },
            size: 100,
            minSize: 100,
            cell: ({ row }: { row: { original: ExtendedCases } }) => {
              const mappedTestRuns = row.original.testRuns
                ?.map((trLink) => {
                  if (
                    trLink.testRun &&
                    typeof trLink.testRun.projectId === "number"
                  ) {
                    return {
                      id: trLink.testRun.id,
                      name: trLink.testRun.name,
                      projectId: trLink.testRun.projectId,
                      isCompleted: trLink.testRun.isCompleted,
                    };
                  }
                  return null;
                })
                .filter(
                  (
                    run
                  ): run is {
                    id: number;
                    name: string;
                    projectId: number;
                    isCompleted: boolean;
                  } => run !== null
                );

              return (
                <div className="flex justify-center">
                  <TestRunsListDisplay
                    testRuns={mappedTestRuns}
                    count={mappedTestRuns?.length || 0}
                    filter={{
                      projectId: row.original.projectId,
                      testCases: {
                        some: {
                          repositoryCaseId: row.original.id,
                        },
                      },
                    }}
                  />
                </div>
              );
            },
          },
          {
            id: "comments",
            header: columnTranslations.comments,
            enableSorting: false,
            enableResizing: true,
            enableHiding: true,
            meta: { isVisible: true },
            size: 100,
            minSize: 100,
            cell: ({ row }: { row: { original: ExtendedCases } }) => {
              const commentsCount = (row.original as any)._count?.comments ?? 0;

              return (
                <div className="flex justify-center">
                  <CommentsListDisplay
                    repositoryCaseId={row.original.id}
                    projectId={row.original.projectId}
                    count={commentsCount}
                  />
                </div>
              );
            },
          },
        ]
      : []),
    {
      id: "id",
      accessorKey: "id",
      header: columnTranslations.id,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 50,
      minSize: 50,
      cell: ({ row }) => <div>{row.original.id}</div>,
    },
    {
      id: "currentVersion",
      accessorKey: "currentVersion",
      header: columnTranslations.versions,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 50,
      minSize: 50,
      cell: ({ row }) => <div>{row.original.currentVersion}</div>,
    },
    {
      id: "estimate",
      accessorKey: "estimate",
      header: columnTranslations.estimate,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 100,
      minSize: 100,
      cell: ({ row, column }) => (
        <div
          className="truncate whitespace-nowrap overflow-hidden"
          style={{ maxWidth: column.getSize() }}
        >
          <DurationDisplay seconds={row.original.estimate as number} />
        </div>
      ),
    },
    {
      id: "forecast",
      accessorKey: "forecast",
      header: columnTranslations.forecast,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 100,
      minSize: 100,
      cell: ({ row, column }) => (
        <div
          className="truncate whitespace-nowrap overflow-hidden"
          style={{ maxWidth: column.getSize() }}
        >
          <ForecastDisplay
            seconds={row.original.forecastManual as number}
            type="manual"
          />
          <ForecastDisplay
            seconds={row.original.forecastAutomated as number}
            type="automated"
          />
        </div>
      ),
    },
    {
      id: "stateId",
      accessorKey: "stateId",
      header: columnTranslations.state,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: { isVisible: true },
      size: 110,
      cell: ({ row }) => (
        <div className="flex items-center space-x-1 whitespace-nowrap">
          <DynamicIcon
            className="w-5 h-5 min-w-5 min-h-5"
            name={row.original.state.icon.name as IconName}
            color={row.original.state.color.value}
          />
          <div>{row.original.state.name}</div>
        </div>
      ),
    },
    {
      id: "automated",
      accessorKey: "automated",
      header: columnTranslations.automated,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 100,
      cell: ({ row }) => (
        <div className="flex items-center space-x-1 whitespace-nowrap">
          <Switch disabled checked={row.original.automated} />
        </div>
      ),
    },
    {
      id: "template",
      accessorKey: "template",
      header: columnTranslations.template,
      enableSorting: false,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 75,
      cell: ({ row }) => (
        <div className="flex items-center space-x-1 whitespace-nowrap">
          <div className="truncate">{row.original.template.templateName}</div>
        </div>
      ),
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: columnTranslations.createdAt,
      enableSorting: !isCompleted,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 100,
      minSize: 100,
      cell: ({ row, column }) => (
        <div
          className="truncate whitespace-nowrap overflow-hidden"
          style={{ maxWidth: column.getSize() }}
        >
          <DateFormatter
            date={row.original.createdAt}
            formatString={
              session?.user.preferences?.dateFormat +
              " " +
              session?.user.preferences?.timeFormat
            }
            timezone={session?.user.preferences?.timezone}
          />
        </div>
      ),
    },
    {
      id: "creator",
      accessorKey: "creator",
      header: columnTranslations.createdBy,
      enableSorting: false,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: false,
      },
      size: 75,
      minSize: 50,
      maxSize: 250,
      cell: ({ row }) => <UserNameCell userId={row.original.creatorId} />,
    },
    {
      id: "attachments",
      accessorKey: "attachments",
      header: columnTranslations.attachments,
      enableSorting: false,
      enableResizing: true,
      enableHiding: true,
      meta: {
        isVisible: true,
      },
      size: 75,
      cell: ({ row }) => (
        <div className="w-full text-center">
          <AttachmentsListDisplay
            attachments={row.original.attachments}
            onSelect={handleSelect}
          />
        </div>
      ),
    },
  ];

  if (isStepsFieldPresent) {
    staticColumns.push({
      id: "steps",
      accessorKey: "steps",
      header: columnTranslations.steps,
      enableSorting: false,
      enableResizing: true,
      enableHiding: true,
      meta: { isVisible: false },
      size: 75,
      cell: ({ row }) => (
        <div className="text-center">
          <StepsListDisplay steps={row.original.steps || []} />
        </div>
      ),
    });
  }

  const tagColumn: ColumnDef<ExtendedCases> = {
    id: "tags",
    header: columnTranslations.tags,
    accessorFn: (row) => row.tags?.map((tag) => tag.name).join(", ") || "",
    enableSorting: false,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: true },
    size: 75,
    cell: ({ row }) => (
      <TagsListDisplay
        tags={row.original.tags || null}
        projectId={row.original.projectId}
      />
    ),
  };

  // Define issues column
  const issuesColumn: ColumnDef<ExtendedCases> = {
    id: "issues",
    header: columnTranslations.issues,
    accessorFn: (row) => row.issues?.length || 0,
    enableSorting: false,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: true },
    size: 75,
    cell: ({ row }) => (
      <IssuesListDisplay
        issues={
          row.original.issues?.map((issue) => ({
            ...issue,
            projectIds: [row.original.projectId],
          })) || null
        }
      />
    ),
  };

  // Insert the linkedCasesColumn after the name column
  const nameIndex = staticColumns.findIndex((col) => col.id === "name");
  if (nameIndex !== -1) {
    staticColumns.splice(nameIndex + 1, 0, linkedCasesColumn);
  }

  // Start with static, tag, issue, and dynamic columns
  // Now staticColumns is defined
  const orderedColumns: ColumnDef<ExtendedCases>[] = staticColumns
    .filter((col) => col.id !== "select" && col.id !== "dragHandle")
    .concat([tagColumn, issuesColumn])
    .concat(dynamicColumns);

  // Add mode-specific LEADING columns using unshift()
  if (isSelectionMode) {
    // Mode 2 (Test Run Edit): Only selection column
    orderedColumns.unshift(selectionColumn);
  } else if (isRunMode) {
    // Mode 3 (Test Run Execute): Selection (with conditional handle inside)
    orderedColumns.unshift(selectionColumn);
  } else {
    // Mode 1 (Repository): Selection (with conditional handle inside)
    orderedColumns.unshift(selectionColumn);
  }

  // Add mode-specific TRAILING columns (like testRunStatus or actions)
  if (isRunMode) {
    orderedColumns.push({
      id: "testRunStatus",
      header: columnTranslations.status,
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 150,
      minSize: 150,
      cell: ({ row, table }) => {
        const isSoftDeletedInRun = isRunMode && row.original.isDeleted;

        return (
          <TestRunStatusCell
            key={`status-${row.id}`}
            status={row.original.testRunStatus}
            caseId={row.original.id}
            testRunCaseId={row.original.testRunCaseId}
            currentAssignee={row.original.assignedTo}
            testRunId={runId || 0}
            caseName={row.original.name}
            projectId={Number(row.original.projectId || 0)}
            table={table}
            onModalOpen={(isOpen) => {
              const event = new CustomEvent("modalStateChange", {
                detail: { isOpen },
              });
              window.dispatchEvent(event);
            }}
            isCompleted={isCompleted || !canAddEditResults}
            steps={row.original.steps || []}
            isSoftDeletedInRun={isSoftDeletedInRun}
            onOpenAddResultModal={onOpenAddResultModal}
          />
        );
      },
    });
  } else {
    if ((canDelete || canAddEditRun) && !isSelectionMode) {
      orderedColumns.push({
        id: "actions",
        header: columnTranslations.actions,
        enableResizing: true,
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 120,
        cell: ({ row }) => (
          <ActionsCell
            row={row}
            isRunMode={isRunMode}
            isSelectionMode={isSelectionMode}
            canDelete={canDelete}
            canAddEditRun={canAddEditRun}
            isSoftDeletedInRun={isRunMode && row.original.isDeleted}
          />
        ),
      });
    }
  }

  return orderedColumns;
};
