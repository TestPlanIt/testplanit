import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Checkbox } from "@/components/ui/checkbox";
import { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getMaxOrderInTestRun } from "~/app/actions/test-run";
import { usePathname, useRouter } from "~/lib/navigation";
import { cn } from "~/utils";

import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import { DateFormatter } from "@/components/DateFormatter";
import { DurationDisplay } from "@/components/DurationDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import StatusDisplay from "@/components/StatusDisplay";
import { AttachmentsListDisplay } from "@/components/tables/AttachmentsListDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { CommentsListDisplay } from "@/components/tables/CommentsListDisplay";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { StepsListDisplay } from "@/components/tables/StepsListDisplay";
import { TagsListDisplay } from "@/components/tables/TagListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import PlainTextFromJson from "@/components/TextFromJson";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RepositoryCaseSource } from "~/zenstack/models";
import type {
  Attachments,
  CaseFields,
  Color,
  FieldIcon,
  Issue,
  Projects,
  RepositoryCases,
  RepositoryFolders,
  Status,
  Steps,
  Tags,
  User,
  Workflows,
} from "~/zenstack/models";
import {
  Activity,
  ArrowRight,
  ArrowRightLeft,
  Bot,
  Check,
  ExternalLink,
  Flame,
  Folder,
  GripVertical,
  LinkIcon,
  ListChecks,
  Lock,
  MoreVertical,
  PlayCircle,
  Plus,
  PlusSquare,
  ScrollText,
  SquarePen,
  SquareStack,
  Trash2,
  UserCog,
} from "lucide-react";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { notifyTestCaseAssignment } from "~/app/actions/test-run-notifications";
import { ForecastDisplay } from "~/components/ForecastDisplay";
import LoadingSpinner from "~/components/LoadingSpinner";
import { Link } from "~/lib/navigation";
import { IconName } from "~/types/globals";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import { RecordId } from "@/components/RecordId";
import { RecordKeyMenuItem } from "@/components/RecordKeyMenuItem";
import { RECORD_TYPES } from "~/lib/recordKey";
import { AssignTestCaseModal } from "./AssignTestCase";
import { DeleteCaseModal } from "./DeleteCase";

export interface ExtendedCases extends RepositoryCases {
  className: string | null;
  source: RepositoryCaseSource;
  state: Pick<Workflows, "id" | "name"> & {
    icon: Pick<FieldIcon, "name">;
    color: Pick<Color, "value">;
  };
  attachments: Attachments[];
  tags?: Tags[];
  // Explicit join-model relations (RepositoryCases.caseTags/caseIssues). The
  // repository case query selects these; consumers derive tags/issues via
  // caseTags.map((ct) => ct.tag) / caseIssues.map((ci) => ci.issue).
  caseTags?: { tag: Tags }[];
  caseIssues?: { issue: Issue }[];
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
  testRunId?: number;
  testRunCaseId?: number;
  testRunStatus?: {
    id: number;
    name: string;
    color: {
      value: string;
    };
  } | null;
  testRunStatusId?: number | null;
  /**
   * Phase 3 — when > 0, the case is parameterized in this run. The status
   * cell becomes read-only (sheet-opener) since case-level status is
   * derived from iteration rollup, not user input.
   */
  totalIterations?: number;
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

/**
 * Renders the case-type icon (Bot / ListChecks / Trash2) and, when the
 * case carries parameterized steps, an adjacent SquareStack glyph
 * tinted in primary. Same shape the Tiptap toolbar's
 * InsertParameterToolbarButton uses, so the association is already
 * familiar. Kept inline here because the cells-table render path
 * doesn't go through CaseDisplay.
 */
function TypeIconWithParamBadge({
  isSoftDeletedInRun,
  automated,
  source,
  hasParameters,
  colorClass,
}: {
  isSoftDeletedInRun?: boolean;
  automated?: boolean;
  source?: RepositoryCaseSource;
  hasParameters?: boolean;
  colorClass: string;
}) {
  const t = useTranslations("parameters");
  if (isSoftDeletedInRun) {
    return <Trash2 className="w-4 h-4 me-1 text-muted-foreground shrink-0" />;
  }
  const Base = automated || isAutomatedCaseSource(source) ? Bot : ListChecks;
  return (
    <span className="inline-flex items-center gap-1 shrink-0 me-1">
      <Base className={cn("w-4 h-4 shrink-0", colorClass)} />
      {hasParameters && (
        <span
          title={t("hasParametersBadgeTooltip")}
          aria-label={t("hasParametersBadgeTooltip")}
          className="inline-flex shrink-0"
        >
          <SquareStack
            data-testid="has-parameters-badge"
            aria-hidden="true"
            className="w-4 h-4 shrink-0 text-primary"
          />
        </span>
      )}
    </span>
  );
}

interface NameCellProps {
  name: string;
  id: number;
  projectId: number;
  isRunMode: boolean;
  isSelectionMode: boolean;
  onTestCaseClick?: (caseId: number) => void;
  folder?: {
    id: number;
    name: string;
    path?: string;
  };
  viewType?: string;
  canAddEditResults?: boolean;
  automated?: boolean;
  hasParameters?: boolean;
  source?: RepositoryCaseSource;
  isSoftDeletedInRun?: boolean;
  showDescendants?: boolean;
  folderPathMap?: Map<number, string> | null;
}

const NameCell = React.memo(function NameCell({
  name,
  id,
  projectId,
  isRunMode,
  isSelectionMode,
  onTestCaseClick: _onTestCaseClick,
  folder,
  viewType,
  automated,
  hasParameters,
  canAddEditResults,
  source,
  isSoftDeletedInRun,
  showDescendants,
  folderPathMap,
}: NameCellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // DISABLED: Fetch all folders to build the path hierarchy
  // TODO: Replace with API endpoint that fetches only the path for a specific folder
  // This was causing performance issues by loading all folders for each case row
  const { data: allFolders } = useClientQueries(
    schema
  ).repositoryFolders.useFindMany(
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

  // Build the full folder path - prefer folderPathMap when available (showDescendants mode)
  const folderPath = React.useMemo(() => {
    if (!folder) return "";
    if (folderPathMap && folderPathMap.has(folder.id)) {
      return folderPathMap.get(folder.id) ?? "";
    }
    if (!allFolders) return "";

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
  }, [folder, allFolders, folderPathMap]);

  const showFolderInfo = Boolean(
    (viewType && viewType !== "folders" && folder) ||
    (showDescendants && folder)
  );

  if (isRunMode && canAddEditResults) {
    const handleClick = () => {
      if (isSoftDeletedInRun) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("selectedCase", id.toString());
      router.replace(`${pathname}?${params.toString()}`);
    };

    return (
      <div className="flex items-center min-w-0">
        <TypeIconWithParamBadge
          isSoftDeletedInRun={isSoftDeletedInRun}
          automated={automated}
          source={source}
          hasParameters={hasParameters}
          colorClass={
            automated || isAutomatedCaseSource(source)
              ? "text-primary"
              : "text-muted-foreground"
          }
        />
        <div
          className={cn(
            "truncate whitespace-nowrap overflow-hidden group min-w-0 flex-auto",
            isSoftDeletedInRun ? "cursor-default" : "cursor-pointer",
            isSoftDeletedInRun && "line-through text-muted-foreground"
          )}
          onClick={handleClick}
        >
          {name}
          <ArrowRight className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>

        {showFolderInfo && folder && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ms-2 text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded flex items-center min-w-0 shrink-[9999] max-w-[150px] hover:bg-muted/80 transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const params = new URLSearchParams(searchParams.toString());
                    params.set("view", "folders");
                    params.set("node", folder.id.toString());
                    router.push(`${pathname}?${params.toString()}`);
                  }}
                >
                  <Folder className="w-3 h-3 me-1 shrink-0" />
                  <span className="truncate min-w-0">{folder.name}</span>
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

  return (
    <div className="flex items-center min-w-0">
      <TypeIconWithParamBadge
        isSoftDeletedInRun={isSoftDeletedInRun}
        automated={automated}
        source={source}
        hasParameters={hasParameters}
        colorClass="text-primary"
      />
      <Link
        href={`/projects/repository/${projectId}/${id}`}
        className={cn(
          "group min-w-0 flex-auto",
          isSoftDeletedInRun && "line-through text-muted-foreground"
        )}
        target={isSelectionMode ? "_blank" : undefined}
        onClick={(e) => {
          // In plain repository browsing, open the case in the docked details
          // panel (via the `case` URL param) instead of navigating away — but let
          // modified/middle clicks fall through so the full page still opens in
          // a new tab. Run and selection modes keep their existing behavior.
          if (isRunMode || isSelectionMode) return;
          if (
            e.metaKey ||
            e.ctrlKey ||
            e.shiftKey ||
            e.altKey ||
            e.button !== 0
          )
            return;
          e.preventDefault();
          const params = new URLSearchParams(searchParams.toString());
          params.set("case", id.toString());
          // push (not replace) so the browser Back button closes the panel.
          router.push(`${pathname}?${params.toString()}`);
        }}
      >
        <div className="truncate whitespace-nowrap overflow-hidden">
          {name}
          {/* The link icon signals "opens a new page" — only true when the
              click navigates (selection mode → new tab, run mode → case page).
              In plain repository browsing the click opens the docked details
              panel, so hide it. */}
          {(isRunMode || isSelectionMode) && (
            <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          )}
        </div>
      </Link>

      {showFolderInfo && folder && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="ms-2 text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded flex items-center min-w-0 shrink-[9999] max-w-[150px] hover:bg-muted/80 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const params = new URLSearchParams(searchParams.toString());
                  params.set("view", "folders");
                  params.set("node", folder.id.toString());
                  router.push(`${pathname}?${params.toString()}`);
                }}
              >
                <Folder className="w-3 h-3 me-1 shrink-0" />
                <span className="truncate min-w-0">{folder.name}</span>
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
  onOpenAssignModal,
  totalIterations,
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
    configuration?: { id: number; name: string } | null;
  }) => void;
  onOpenAssignModal?: (modalData: {
    testRunId: number;
    testRunCaseId?: number;
    caseId: number;
    caseName: string;
    projectId: number;
    currentAssigneeId?: string | null;
    isBulkAssign: boolean;
    selectedCases?: ExtendedCases[];
  }) => void;
  totalIterations?: number;
}) {
  // For parameterized cases, the status is derived from the iteration
  // rollup (no per-case-level result writes). Render a click-to-open-sheet
  // button instead of the status-picker dropdown.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isParameterized = (totalIterations ?? 0) > 0;
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isBulkAssign, setIsBulkAssign] = useState(false);
  const [isInitialRender, setIsInitialRender] = useState(true);
  const t = useTranslations();

  const { mutateAsync: _updateTestRunCase } =
    useClientQueries(schema).testRunCases.useUpdate();

  useEffect(() => {
    setIsInitialRender(false);
  }, []);

  const { data: statuses } = useClientQueries(schema).status.useFindMany({
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

  const handleOpenParameterizedSheet = () => {
    if (isSoftDeletedInRun) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("selectedCase", caseId.toString());
    router.replace(`${pathname}?${params.toString()}`);
  };

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

  // Prefer the parent-owned modal: state kept inside this cell is lost whenever
  // the column defs are rebuilt (TanStack renders `columnDef.cell` as the
  // component type), which silently closes the dialog.
  const openAssignModal = (bulk: boolean) => {
    if (isCompleted) return;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (onOpenAssignModal) {
      onOpenAssignModal({
        testRunId,
        testRunCaseId,
        caseId,
        caseName,
        projectId,
        currentAssigneeId: currentAssignee?.id,
        isBulkAssign: bulk,
        selectedCases: bulk ? getSelectedCases() : undefined,
      });
    } else {
      setIsBulkAssign(bulk);
      setShowAssignModal(true);
    }
    onModalOpen?.(true);
  };

  const handleBulkAssign = () => openAssignModal(true);

  const handleSingleAssign = () => openAssignModal(false);

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
      <div className="flex items-center justify-between w-full">
        {isParameterized ? (
          <Button
            variant="outline"
            className="flex-1 min-w-0 h-8 bg-transparent hover:bg-muted hover:text-foreground justify-between gap-1 overflow-hidden"
            disabled={isSoftDeletedInRun}
            onClick={handleOpenParameterizedSheet}
            data-testid={`testrun-status-cell-parameterized-${caseId}`}
            title={t("repository.cases.parameterizedStatusReadOnly")}
          >
            <StatusDisplay
              name={displayStatus.name}
              color={
                hasColor(displayStatus) ? displayStatus.color.value : undefined
              }
              className="flex items-center space-x-1 min-w-0 overflow-hidden"
              nameClassName="truncate"
            />
            <SquareStack className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="flex-1 min-w-0 h-8 bg-transparent hover:bg-muted hover:text-foreground justify-start overflow-hidden"
                disabled={isDisabled}
              >
                <StatusDisplay
                  name={displayStatus.name}
                  color={
                    hasColor(displayStatus)
                      ? displayStatus.color.value
                      : undefined
                  }
                  className="flex items-center space-x-1 min-w-0 overflow-hidden"
                  nameClassName="truncate"
                />
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
                  <StatusDisplay
                    name={statusOption.name}
                    color={statusOption.color?.value}
                    dotClassName="w-3 h-3 rounded-full me-2"
                    nameClassName="flex-1"
                  />
                  {statusOption.id === displayStatus.id && (
                    <Check className="h-4 w-4 ms-2 text-muted-foreground" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isMenuDisabled || isDisabled}>
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ms-1 ${isMenuDisabled || isDisabled ? "text-muted-foreground opacity-30 cursor-not-allowed" : ""}`}
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
                  <UserCog className="me-2 h-4 w-4" />
                  <span>
                    {t("common.actions.assignSelected", {
                      count: selectedCount,
                    })}
                  </span>
                </DropdownMenuItem>
                {!isParameterized && (
                  <DropdownMenuItem
                    className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                    onClick={handleBulkResult}
                    disabled={isDisabled}
                    style={{ opacity: isDisabled ? 0.5 : 1 }}
                  >
                    <Plus className="me-2 h-4 w-4" />
                    <span>
                      {t("common.actions.addResultSelected", {
                        count: selectedCount,
                      })}
                    </span>
                  </DropdownMenuItem>
                )}
              </>
            ) : (
              <>
                <DropdownMenuItem
                  className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={handleSingleAssign}
                  disabled={isDisabled}
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  <UserCog className="me-2 h-4 w-4" />
                  <span>{t("common.actions.assign")}</span>
                </DropdownMenuItem>
                {!isParameterized && (
                  <DropdownMenuItem
                    className={`flex items-center ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                    onClick={handleSingleResult}
                    disabled={isDisabled}
                    style={{ opacity: isDisabled ? 0.5 : 1 }}
                  >
                    <Plus className="me-2 h-4 w-4" />
                    <span>{t("common.actions.addResult")}</span>
                  </DropdownMenuItem>
                )}
              </>
            )}
            <Link
              href={`/projects/repository/${projectId}/${caseId}`}
              target="_blank"
            >
              <DropdownMenuItem className="flex items-center cursor-pointer">
                <ExternalLink className="me-2 h-4 w-4" />
                <span>{t("common.actions.viewInRepository")}</span>
              </DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!onOpenAssignModal && showAssignModal && (
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
  const { mutateAsync: upsertTestRunCase } =
    useClientQueries(schema).testRunCases.useUpsert();

  const {
    data: testRuns,
    isLoading: isLoadingTestRuns,
    refetch: refetchTestRuns,
  } = useClientQueries(schema).testRuns.useFindMany({
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
                isDeleted: false,
              },
            },
          },
        },
      ],
    },
    orderBy: { name: "asc" },
  });

  const handleAddToTestRun = async (testRunId: number, isLocked: boolean) => {
    // A composition-locked run's case set is frozen — the create would be
    // rejected by the policy/DB guard (422). Stop early with a clear message
    // instead of firing a doomed request.
    if (isLocked) {
      toast.error(t("runs.composition.addBlocked"));
      return;
    }
    try {
      // Get the current maximum order for the selected test run
      const maxOrder = await getMaxOrderInTestRun(testRunId);
      const newOrder = maxOrder.data + 1;

      await upsertTestRunCase({
        where: {
          testRunId_repositoryCaseId: {
            testRunId,
            repositoryCaseId: caseId,
          },
        },
        create: {
          testRunId,
          repositoryCaseId: caseId,
          order: newOrder,
        },
        update: {
          isDeleted: false,
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
      {testRuns?.map((testRun) => (
        <DropdownMenuItem
          key={testRun.id}
          onClick={() =>
            handleAddToTestRun(testRun.id, !!testRun.compositionLockedAt)
          }
        >
          <PlayCircle className="me-1 h-4 w-4" />
          <span>{testRun.name}</span>
          {testRun.compositionLockedAt && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ms-1 shrink-0">
                  <Lock className="w-3 h-3 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("common.labels.compositionLocked")}
              </TooltipContent>
            </Tooltip>
          )}
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
  quickScriptEnabled,
  canAddEdit,
  onQuickScript,
  onCopyMove,
  onDeleteCase,
  excludeNotStartedFromRuns,
}: {
  row: any;
  isRunMode: boolean;
  isSelectionMode: boolean;
  canDelete?: boolean;
  canAddEditRun?: boolean;
  isSoftDeletedInRun?: boolean;
  quickScriptEnabled?: boolean;
  canAddEdit?: boolean;
  onQuickScript?: (caseId: number) => void;
  onCopyMove?: (caseId: number) => void;
  onDeleteCase?: (testcase: ExtendedCases) => void;
  excludeNotStartedFromRuns?: boolean;
}) {
  const isDraftCase =
    !!excludeNotStartedFromRuns &&
    row.original?.state?.workflowType === "NOT_STARTED";
  const t = useTranslations();
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  return (
    <div className="flex justify-center w-full">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            data-testid={`actions-menu-${row.original.id}`}
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">{t("common.actions.actionsLabel")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isRunMode && !isSelectionMode && canAddEdit && (
            <Link
              href={`/projects/repository/${row.original.projectId}/${row.original.id}?edit=true`}
            >
              <DropdownMenuItem data-testid={`edit-case-${row.original.id}`}>
                <SquarePen className="me-2 h-4 w-4" />
                <span>{t("common.actions.edit")}</span>
              </DropdownMenuItem>
            </Link>
          )}
          {!isRunMode &&
            !isSelectionMode &&
            quickScriptEnabled &&
            canAddEdit &&
            onQuickScript && (
              <DropdownMenuItem
                onClick={() => onQuickScript(row.original.id)}
                data-testid={`quickscript-case-${row.original.id}`}
              >
                <ScrollText className="me-2 h-4 w-4" />
                <span>{t("repository.cases.quickScript")}</span>
              </DropdownMenuItem>
            )}
          {!isRunMode &&
            !isSelectionMode &&
            canAddEditRun &&
            !isSoftDeletedInRun &&
            (isDraftCase ? (
              <DropdownMenuItem
                disabled
                data-testid={`add-to-test-run-draft-${row.original.id}`}
                title={t("repository.cases.addToRunDraftBlocked")}
              >
                <PlusSquare className="me-2 h-4 w-4" />
                <span>{t("common.actions.addToTestRun")}</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <PlusSquare className="me-2 h-4 w-4" />
                  <span>{t("common.actions.addToTestRun")}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <AddToTestRunDropdown
                    caseId={row.original.id}
                    projectId={row.original.projectId}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          {!isRunMode && !isSelectionMode && onCopyMove && (
            <DropdownMenuItem
              onClick={() => onCopyMove(row.original.id)}
              data-testid={`copy-move-case-${row.original.id}`}
            >
              <ArrowRightLeft className="me-2 h-4 w-4" />
              <span>{t("repository.cases.copyMoveToProject")}</span>
            </DropdownMenuItem>
          )}
          {!isRunMode && (
            <RecordKeyMenuItem
              type="TEST_CASE"
              id={row.original.id}
              projectId={row.original.projectId}
            />
          )}
          {canDelete && (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                // Prefer the parent-owned dialog: state kept inside this cell is
                // lost whenever the column defs are rebuilt (TanStack renders
                // `columnDef.cell` as the component type), which silently closes
                // the confirmation dialog.
                if (onDeleteCase) {
                  onDeleteCase(row.original);
                } else {
                  setShowDeleteModal(true);
                }
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="me-2 h-4 w-4" />
              <span>{t("common.actions.delete")}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canDelete && !onDeleteCase && showDeleteModal && (
        <DeleteCaseModal
          key={`delete-${row.original.id}`}
          testcase={row.original}
          open={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
        />
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

  // AsyncCombobox refetches whenever `fetchOptions` changes identity, so an
  // inline arrow would refetch on every render of this component.
  const fetchMemberOptions = useCallback(
    (query: string, page: number, pageSize: number) =>
      searchProjectMembers(row.original.projectId, query, page, pageSize),
    [row.original.projectId]
  );

  const { mutateAsync: updateTestRunCase } =
    useClientQueries(schema).testRunCases.useUpdate();

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
      fetchOptions={fetchMemberOptions}
      renderOption={(user) => <UserNameCell userId={user.id} hideLink />}
      getOptionValue={(user) => user.id}
      placeholder={t("sessions.placeholders.selectUser")}
      disabled={isDisabled}
      className="h-8 w-full overflow-hidden"
      pageSize={20}
      showTotal={true}
      showUnassigned={true}
    />
  );
});

// Component for displaying last test result in repository mode
// Component for select all checkbox with shift-key detection and tooltip
const SelectAllCheckbox = React.memo(function SelectAllCheckbox({
  table,
  handleSelectAllClick,
  selectCaseLabel,
  totalItems,
  isAllSelected,
}: {
  table: any;
  handleSelectAllClick?: (event: React.MouseEvent) => void;
  selectCaseLabel: string;
  totalItems: number;
  isAllSelected: boolean;
}) {
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  const t = useTranslations();

  // Track shift key state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        setIsShiftPressed(false);
      }
    };

    // Also handle blur to reset state when window loses focus
    const handleBlur = () => {
      setIsShiftPressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const tooltipContent = isShiftPressed
    ? isAllSelected
      ? t("repository.deselectAllShiftTooltip")
      : t("repository.selectAllShiftTooltip", { count: totalItems })
    : t("repository.selectAllTooltip");

  return (
    <TooltipProvider delayDuration={1000}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-pointer">
            <Checkbox
              data-testid="select-all-cases-checkbox"
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
              aria-label={selectCaseLabel}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          sideOffset={12}
          className="max-w-xs"
          style={{ zIndex: 9999 }}
        >
          <p className="text-xs">{tooltipContent}</p>
          {!isShiftPressed && (
            <p className="text-xs text-primary-foreground/65 mt-1">
              {t("repository.shiftClickHint")}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

export const getColumns = (
  userPreferences: {
    user: {
      preferences: {
        dateFormat?: string;
        timezone?: string;
        timeFormat?: string;
      };
    };
  },
  uniqueCaseFieldList: (CaseFields & {
    type?: { type?: string } | null;
  })[],
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
    latestResults: string;
    newBadge: string;
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
    configuration?: { id: number; name: string } | null;
  }) => void,
  isMultiConfigRun?: boolean,
  totalItems?: number,
  selectedCount?: number,
  enableReorder?: boolean,
  quickScriptEnabled?: boolean,
  canAddEdit?: boolean,
  onQuickScript?: (caseId: number) => void,
  onCopyMove?: (caseId: number) => void,
  showDescendants?: boolean,
  folderPathMap?: Map<number, string> | null,
  renderPendingBadge?: (caseId: number) => React.ReactNode,
  renderLatestResults?: (caseId: number, projectId: number) => React.ReactNode,
  excludeNotStartedFromRuns?: boolean,
  onDeleteCase?: (testcase: ExtendedCases) => void,
  onOpenAssignModal?: (modalData: {
    testRunId: number;
    testRunCaseId?: number;
    caseId: number;
    caseName: string;
    projectId: number;
    currentAssigneeId?: string | null;
    isBulkAssign: boolean;
    selectedCases?: ExtendedCases[];
  }) => void
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
    enableSorting: !isCompleted,
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
      // Show handle when reordering is enabled
      const showHandle = enableReorder;

      // Determine if all items are selected (for tooltip message)
      const isAllSelected =
        (selectedCount ?? 0) >= (totalItems ?? 0) && (totalItems ?? 0) > 0;

      return (
        <div
          // Use the calculated showHandle to set padding
          className={`flex items-center justify-center w-full ${showHandle ? "ps-6" : "ps-3"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <SelectAllCheckbox
            table={table}
            handleSelectAllClick={handleSelectAllClick}
            selectCaseLabel={columnTranslations.selectCase}
            totalItems={totalItems ?? 0}
            isAllSelected={isAllSelected}
          />
        </div>
      );
    },
    cell: ({ row }) => {
      const isDeletedInRun = isRunMode && row.original.isDeleted;
      // Show handle when reordering is enabled
      const showHandle = enableReorder;

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
            data-testid={`case-checkbox-${row.original.id}`}
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
      // Dropdown fields sort by their admin-defined option order, resolved
      // server-side (Cases.tsx sortedPageIds); repository view only — the run
      // view has no ordering source for custom fields.
      enableSorting:
        !isRunMode &&
        !isSelectionMode &&
        !isCompleted &&
        field.type?.type === "Dropdown",
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
        const fieldType = caseFieldValue?.field?.type?.type;
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
                    <span className="pe-1">{fieldOption.fieldOption.name}</span>
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
                formatString={userPreferences?.user.preferences?.dateFormat}
                timezone={userPreferences?.user.preferences?.timezone}
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
              <DialogContent className="max-w-4xl h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader>
                  <DialogTitle>{field.displayName}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {field.displayName}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-auto">
                  {value === null || value === undefined ? (
                    ""
                  ) : typeof value === "string" ? (
                    <PlainTextFromJson
                      jsonString={value}
                      room={row.original.id.toString()}
                      format="html"
                    />
                  ) : (
                    <PlainTextFromJson
                      jsonString={JSON.stringify(value).toString()}
                      room={row.original.id.toString()}
                      format="html"
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
              <TooltipTrigger type="button">
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
      cell: ({ row }) => {
        const isNew =
          row.original.createdAt &&
          Date.now() - new Date(row.original.createdAt).getTime() <
            5 * 60 * 1000;
        return (
          <div className="flex items-center min-w-0">
            {isNew && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Flame className="h-4 w-4 me-1 shrink-0 text-orange-500 fill-orange-500 animate-pulse" />
                  </TooltipTrigger>
                  <TooltipContent>{columnTranslations.newBadge}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <div className="min-w-0 flex-1">
              <NameCell
                name={row.original.name}
                id={row.original.id}
                projectId={row.original.projectId}
                isRunMode={isRunMode}
                isSelectionMode={isSelectionMode}
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
                automated={row.original.automated}
                hasParameters={row.original.hasParameters}
                canAddEditResults={canAddEditResults}
                source={row.original.source}
                isSoftDeletedInRun={isRunMode && row.original.isDeleted}
                showDescendants={showDescendants}
                folderPathMap={folderPathMap}
              />
            </div>
            {renderPendingBadge ? (
              <div className="ms-2 shrink-0">
                {renderPendingBadge(row.original.id)}
              </div>
            ) : null}
          </div>
        );
      },
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
            id: "latestResults",
            header: columnTranslations.latestResults,
            enableSorting: !isCompleted,
            enableResizing: true,
            enableHiding: true,
            meta: { isVisible: true },
            size: 130,
            minSize: 110,
            cell: ({ row }: { row: { original: ExtendedCases } }) =>
              renderLatestResults?.(row.original.id, row.original.projectId) ??
              null,
          },
          {
            id: "testRuns",
            header: columnTranslations.testRuns,
            enableSorting: !isCompleted,
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
                      isDeleted: trLink.testRun.isDeleted,
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
                    isDeleted: boolean;
                  } => run !== null
                );

              // Count only non-deleted test runs for the badge
              const activeRunsCount =
                mappedTestRuns?.filter((run) => !run.isDeleted).length || 0;

              return (
                <div className="flex justify-center">
                  <TestRunsListDisplay
                    testRuns={mappedTestRuns}
                    count={activeRunsCount}
                    filter={{
                      projectId: row.original.projectId,
                      testCases: {
                        some: {
                          repositoryCaseId: row.original.id,
                          isDeleted: false,
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
            enableSorting: !isCompleted,
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
      size: 140,
      minSize: 60,
      cell: ({ row }) => (
        <RecordId
          type={RECORD_TYPES.TEST_CASE}
          id={row.original.id}
          projectId={row.original.projectId}
        />
      ),
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
            name={row.original.state?.icon?.name as IconName}
            color={row.original.state?.color?.value}
          />
          <div>{row.original.state?.name}</div>
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
      enableSorting: !isCompleted,
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
              userPreferences?.user.preferences?.dateFormat +
              " " +
              userPreferences?.user.preferences?.timeFormat
            }
            timezone={userPreferences?.user.preferences?.timezone}
          />
        </div>
      ),
    },
    {
      id: "creator",
      accessorKey: "creator",
      header: columnTranslations.createdBy,
      enableSorting: !isCompleted,
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
      enableSorting: !isCompleted,
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
      enableSorting: !isCompleted,
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
    enableSorting: !isCompleted,
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
    enableSorting: !isCompleted,
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
    // Mode 3 (Test Run Execute): Selection (with conditional handle inside).
    // A completed run is read-only — there is nothing to do with selected
    // cases — so omit the selection checkboxes entirely.
    if (!isCompleted) {
      orderedColumns.unshift(selectionColumn);
    }
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
            testRunId={row.original.testRunId || runId || 0}
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
            onOpenAddResultModal={
              onOpenAddResultModal
                ? (modalData) =>
                    onOpenAddResultModal({
                      ...modalData,
                      configuration: row.original.testRunConfiguration,
                    })
                : undefined
            }
            onOpenAssignModal={onOpenAssignModal}
            totalIterations={row.original.totalIterations}
          />
        );
      },
    });
  } else {
    if (
      (canDelete ||
        canAddEditRun ||
        (quickScriptEnabled && canAddEdit) ||
        !!onCopyMove) &&
      !isSelectionMode
    ) {
      orderedColumns.push({
        id: "actions",
        header: () => (
          <div className="-ms-1 flex justify-center" style={{ width: 55 }}>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
        ),
        enableResizing: false,
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 55,
        cell: ({ row }) => (
          <ActionsCell
            row={row}
            isRunMode={isRunMode}
            isSelectionMode={isSelectionMode}
            canDelete={canDelete}
            canAddEditRun={canAddEditRun}
            isSoftDeletedInRun={isRunMode && row.original.isDeleted}
            quickScriptEnabled={quickScriptEnabled}
            canAddEdit={canAddEdit}
            onQuickScript={onQuickScript}
            onCopyMove={onCopyMove}
            onDeleteCase={onDeleteCase}
            excludeNotStartedFromRuns={excludeNotStartedFromRuns}
          />
        ),
      });
    }
  }

  return orderedColumns;
};
