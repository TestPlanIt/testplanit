import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { RecordKeyMenuItem } from "@/components/RecordKeyMenuItem";
import { MemberList } from "@/components/MemberList";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import {
  PendingReviewBadge,
  type PendingReviewSummary,
} from "@/components/reviews/PendingReviewBadge";
import { TestRunCasesSummary } from "@/components/TestRunCasesSummary";
import TextFromJson from "@/components/TextFromJson";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { ItemRow, ItemRowChip } from "@/components/ItemRow";
import { ApplicationArea } from "~/zenstack/models";
import {
  Bot,
  CheckCircle,
  Combine,
  CopyPlus,
  Flame,
  LinkIcon,
  Lock,
  MoreVertical,
  Pencil,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import React, { useState } from "react";
import type { TestRunSummaryData } from "~/app/api/test-runs/[testRunId]/summary/route";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRouter } from "~/lib/navigation";
import type { IconName } from "~/types/globals";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import CompleteTestRunDialog from "./[runId]/CompleteTestRunDialog";

/**
 * The narrowest run shape this row renders. Declared structurally, and loose
 * enough to take a query payload as-is (nullable dates, a JSON `note`), so any
 * page that can select these fields — the runs list, the project overview
 * panel — gets the same row instead of hand-rolling its own markup.
 */
export interface TestRunItemData {
  id: number;
  name: string;
  isCompleted: boolean;
  compositionLockedAt?: Date | string | null;
  testRunType: string;
  configuration?: { name: string } | null;
  configurationGroupId?: string | null;
  createdAt?: Date | string | null;
  state: {
    id: number;
    name: string;
    icon?: { name: string } | null;
    color?: { value: string } | null;
  };
  note?: unknown;
  completedAt?: Date | string | null;
  milestone?:
    React.ComponentProps<typeof MilestoneIconAndName>["milestone"] | null;
  projectId: number;
  createdBy: {
    id: string;
    name: string;
  };
}

export interface TestRunItemProps {
  testRun: TestRunItemData;
  isNew?: boolean;
  showMilestone?: boolean;
  onDuplicate?: (run: { id: number; name: string }) => void;
  /** Falls back to the route param; pass it where the route isn't the runs
   *  page (e.g. the project overview panel). */
  projectId?: number;
  /** Set false for read-only surfaces that shouldn't offer row actions. */
  showActions?: boolean;
  summaryData?: TestRunSummaryData;
  /** True while the page's batch summary fetch is in flight — keeps each row
   * from firing its own per-run summary fallback in the meantime. */
  summaryLoading?: boolean;
  pendingRequest?: PendingReviewSummary;
  /** Multi-select support: shows a leading checkbox when provided. */
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}

const TestRunItem: React.FC<TestRunItemProps> = ({
  testRun,
  isNew,
  showMilestone = true,
  onDuplicate,
  projectId: projectIdProp,
  showActions = true,
  summaryData,
  summaryLoading = false,
  pendingRequest,
  selectable = false,
  selected = false,
  onSelectedChange,
}) => {
  const tCommon = useTranslations("common");
  const t = useTranslations();
  const params = useParams();
  const router = useRouter();
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);

  // Fetch permissions
  const numericProjectId =
    projectIdProp ?? parseInt(params.projectId as string, 10);
  const { permissions: testRunPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.TestRuns);
  const canCloseRun = testRunPermissions?.canClose ?? false;
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;

  // Determine if menu items should be shown
  const isAutomatedRun = isAutomatedTestRunType(testRun.testRunType);
  const showEditItem = canAddEditRun && !testRun.isCompleted && !isAutomatedRun;
  const showCompleteItem =
    testRun.isCompleted === false && canCloseRun && !isLoadingPermissions;
  const showDuplicateItem =
    !isAutomatedRun &&
    testRun.isCompleted === false &&
    canAddEditRun &&
    !isLoadingPermissions &&
    onDuplicate;

  const showMoreMenu =
    showActions && (showEditItem || showCompleteItem || showDuplicateItem);

  // `note` arrives as a JSON column; render the string form.
  const noteText =
    typeof testRun.note === "string"
      ? testRun.note
      : testRun.note
        ? JSON.stringify(testRun.note)
        : undefined;

  const isRecentlyCreated =
    !!testRun.createdAt &&
    Date.now() - new Date(testRun.createdAt).getTime() < 5 * 60 * 1000;

  // Contributor lookup for the MemberList: only assignee/executor ids+names.
  // A narrow select, NOT include — full case + result rows per run made this
  // per-row query megabytes on large runs and flooded the page with data it
  // never renders.
  const { data: testRunCases } = useClientQueries(
    schema
  ).testRunCases.useFindMany(
    {
      where: {
        testRunId: testRun.id,
        isDeleted: false,
      },
      select: {
        id: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
        results: {
          select: {
            executedBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    },
    // Virtualized lists remount rows on scroll — without a stale window each
    // remount refires this query (same 30s the batch summaries use).
    { staleTime: 30000 }
  );

  // Transform state data to match WorkflowStateDisplay expectations
  const workflowState = {
    state: {
      name: testRun.state.name,
      icon: {
        name: testRun.state.icon?.name as IconName,
      },
      color: {
        value: testRun.state.color?.value || "",
      },
    },
  };

  // Create users array for MemberList with prepend text
  const users = React.useMemo(() => {
    const userMap = new Map<string, { name: string; roles: Set<string> }>();

    // Add creator
    if (testRun.createdBy?.id) {
      userMap.set(testRun.createdBy.id, {
        name: testRun.createdBy.name,
        roles: new Set([tCommon("fields.createdBy")]),
      });
    }

    // Add assigned users
    testRunCases?.forEach((testCase) => {
      if (testCase.assignedTo?.id) {
        const existingUser = userMap.get(testCase.assignedTo.id);
        const roles = existingUser?.roles || new Set();
        roles.add(tCommon("fields.assignedTo"));
        userMap.set(testCase.assignedTo.id, {
          name: testCase.assignedTo.name,
          roles,
        });
      }
    });

    // Add users who have contributed results
    testRunCases?.forEach((testCase) => {
      testCase.results?.forEach((result) => {
        if (result.executedBy?.id) {
          const existingUser = userMap.get(result.executedBy.id);
          const roles = existingUser?.roles || new Set();
          roles.add(tCommon("fields.executedBy"));
          userMap.set(result.executedBy.id, {
            name: result.executedBy.name,
            roles,
          });
        }
      });
    });

    // Convert Map to array of users for MemberList
    return Array.from(userMap.entries()).map(([userId, data]) => ({
      userId,
      name: data.name,
      prependText: Array.from(data.roles).join(", "),
    }));
  }, [testRun.createdBy, testRunCases, tCommon]);

  return (
    <>
      <ItemRow
        id={`testrun-${testRun.id}`}
        href={`/projects/runs/${numericProjectId}/${testRun.id}`}
        name={testRun.name}
        accentColor={testRun.state.color?.value}
        isNew={isNew}
        selectable={selectable}
        selected={selected}
        onSelectedChange={onSelectedChange}
        selectTestId={`testrun-select-${testRun.id}`}
        icon={
          isAutomatedRun ? (
            <Bot className="w-5 h-5 shrink-0 border-2 text-primary border-primary rounded-full p-0.5" />
          ) : (
            <DynamicIcon
              name="play-circle"
              className="h-5 w-5 shrink-0 text-primary"
            />
          )
        }
        adornments={[
          {
            key: "review",
            content: <PendingReviewBadge pendingRequest={pendingRequest} />,
          },
          isRecentlyCreated && {
            key: "new",
            tier: "md",
            content: (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Flame className="h-4 w-4 shrink-0 text-orange-500 fill-orange-500 animate-pulse" />
                </TooltipTrigger>
                <TooltipContent>{tCommon("labels.new")}</TooltipContent>
              </Tooltip>
            ),
          },
          testRun.configurationGroupId && {
            key: "multi-config",
            tier: "sm",
            content: (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0">
                    <Combine className="w-4 h-4 text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-background/50">
                    {tCommon("labels.multiConfiguration")}
                  </p>
                  {testRun.configuration && (
                    <p className="flex text-xs text-background">
                      <Combine className="w-4 h-4 shrink-0 me-1" />
                      {testRun.configuration.name}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            ),
          },
          testRun.compositionLockedAt && {
            key: "locked",
            tier: "sm",
            content: (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0">
                    <Lock className="w-4 h-4 text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("runs.composition.locked")}</TooltipContent>
              </Tooltip>
            ),
          },
          {
            key: "open",
            tier: "lg",
            content: (
              <LinkIcon className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            ),
          },
        ]}
        identityChips={[
          testRun.configuration && {
            key: "configuration",
            tier: "md",
            content: (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="min-w-0 cursor-default">
                    <ItemRowChip icon={<Combine className="w-4 h-4" />}>
                      {testRun.configuration.name}
                    </ItemRowChip>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="flex">
                    <Combine className="w-4 h-4 shrink-0 me-1" />
                    {testRun.configuration.name}
                  </p>
                </TooltipContent>
              </Tooltip>
            ),
          },
        ]}
        state={<WorkflowStateDisplay {...workflowState} size="sm" />}
        actions={
          showMoreMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={tCommon("actions.actionsLabel")}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  {showEditItem && (
                    <DropdownMenuItem
                      onClick={() =>
                        router.push(
                          `/projects/runs/${numericProjectId}/${testRun.id}?edit=true`
                        )
                      }
                      data-testid={`testrun-edit-${testRun.id}`}
                    >
                      <Pencil className="me-2 h-4 w-4" />
                      {tCommon("actions.edit")}
                    </DropdownMenuItem>
                  )}

                  {showDuplicateItem && (
                    <DropdownMenuItem
                      onClick={() =>
                        onDuplicate &&
                        onDuplicate({ id: testRun.id, name: testRun.name })
                      }
                      data-testid={`testrun-duplicate-${testRun.id}`}
                    >
                      <CopyPlus className="me-2 h-4 w-4" />
                      {tCommon("actions.duplicate")}
                    </DropdownMenuItem>
                  )}

                  {showCompleteItem && (
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault(); // Prevents menu from closing
                        setIsCompleteDialogOpen(true);
                      }}
                      data-testid={`testrun-complete-trigger-${testRun.id}`}
                    >
                      <CheckCircle className="me-2 h-4 w-4" />
                      {tCommon("actions.complete")}
                    </DropdownMenuItem>
                  )}
                  <RecordKeyMenuItem
                    type="TEST_RUN"
                    id={testRun.id}
                    projectId={numericProjectId}
                  />
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
        chips={[
          showMilestone &&
            testRun.milestone && {
              key: "milestone",
              tier: "lg",
              content: <MilestoneIconAndName milestone={testRun.milestone} />,
            },
          testRun.isCompleted &&
            testRun.completedAt && {
              key: "completed",
              content: (
                <DateTextDisplay
                  endDate={new Date(testRun.completedAt)}
                  isCompleted={true}
                />
              ),
            },
        ]}
        trailing={[
          !testRun.isCompleted && {
            key: "members",
            tier: "xl",
            content: <MemberList users={users} />,
          },
        ]}
        progress={
          <TestRunCasesSummary
            testRunId={testRun.id}
            projectId={testRun.projectId}
            testRunType={testRun.testRunType}
            className="w-full"
            summaryData={summaryData}
            summaryLoading={summaryLoading}
          />
        }
        note={
          noteText && (
            <TextFromJson
              jsonString={noteText}
              format="text"
              room={`testrun-note-${testRun.id}`}
            />
          )
        }
      />
      {isCompleteDialogOpen && (
        <CompleteTestRunDialog
          open={isCompleteDialogOpen}
          onClose={() => setIsCompleteDialogOpen(false)}
          testRunId={testRun.id}
          projectId={numericProjectId}
          stateId={testRun.state.id}
          stateName={testRun.state.name}
        />
      )}
    </>
  );
};

export default TestRunItem;
