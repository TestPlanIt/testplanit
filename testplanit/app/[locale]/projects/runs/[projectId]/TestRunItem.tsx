import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { RecordKeyMenuItem } from "@/components/RecordKeyMenuItem";
import { ForecastDisplay } from "@/components/ForecastDisplay";
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
import { ApplicationArea } from "~/zenstack/models";
import type { Configurations } from "~/zenstack/models";
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
import { Link, useRouter } from "~/lib/navigation";
import type { IconName } from "~/types/globals";
import { cn } from "~/utils";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import CompleteTestRunDialog from "./[runId]/CompleteTestRunDialog";

export interface TestRunItemProps {
  testRun: {
    id: number;
    name: string;
    isCompleted: boolean;
    compositionLockedAt?: Date | string | null;
    testRunType: string;
    configuration: Configurations | null;
    configurationGroupId: string | null;
    createdAt?: Date | string;
    state: {
      id: number;
      name: string;
      icon?: {
        name: string;
      };
      color?: {
        value: string;
      };
    };
    note?: string;
    completedAt?: Date;
    milestone?: {
      id: number;
      name: string;
      startedAt?: Date | null;
      completedAt?: Date | null;
      isCompleted?: boolean;
      milestoneType: {
        id: number;
        name: string;
        icon: { name: string } | null;
      };
    };
    projectId: number;
    testCases?: {
      id: number;
      repositoryCaseId: number;
    }[];
    createdBy: {
      id: string;
      name: string;
    };
    forecastManual: number | null;
    forecastAutomated: number | null;
  };
  milestonePath?: string;
  isNew?: boolean;
  showMilestone?: boolean;
  onDuplicate?: (run: { id: number; name: string }) => void;
  onComplete?: (testRun: any) => void;
  isAdmin?: boolean;
  summaryData?: TestRunSummaryData;
  pendingRequest?: PendingReviewSummary;
}

const TestRunItem: React.FC<TestRunItemProps> = ({
  testRun,
  isNew,
  showMilestone = true,
  onDuplicate,
  summaryData,
  pendingRequest,
}) => {
  const tCommon = useTranslations("common");
  const t = useTranslations();
  const { projectId } = useParams();
  const router = useRouter();
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);

  // Fetch permissions
  const numericProjectId = parseInt(projectId as string, 10);
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

  const showMoreMenu = showEditItem || showCompleteItem || showDuplicateItem;

  const isRecentlyCreated =
    !!testRun.createdAt &&
    Date.now() - new Date(testRun.createdAt).getTime() < 5 * 60 * 1000;

  // Fetch test run cases with their results and assigned users
  const { data: testRunCases } = useClientQueries(
    schema
  ).testRunCases.useFindMany({
    where: {
      testRunId: testRun.id,
      isDeleted: false,
    },
    include: {
      assignedTo: {
        select: {
          id: true,
          name: true,
        },
      },
      results: {
        include: {
          executedBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });

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

  // Using consistent grid layout for all items. Every track is minmax(0,fr)
  // so columns shrink to fit the row instead of overflowing into each other,
  // and resolve to the same width on every row for clean column alignment.
  // Content inside each cell truncates rather than widening its track.
  const gridLayout =
    "grid-cols-[minmax(0,1.5fr)_minmax(0,0.75fr)_minmax(0,0.7fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,0.75fr)]";

  return (
    <>
      <div
        id={`testrun-${testRun.id}`}
        className={cn(
          `overflow-hidden relative grid ${gridLayout} gap-4 items-center w-full my-2 p-2 border-4 rounded-lg shadow-xs`,
          isNew && "border-primary animate-pulse"
        )}
        style={{
          backgroundColor: testRun.state.color?.value
            ? `${testRun.state.color.value}10`
            : undefined,
          borderColor: testRun.state.color?.value
            ? isNew
              ? testRun.state.color.value
              : `${testRun.state.color.value}44`
            : undefined,
        }}
      >
        {/* Left Column - Name & Note */}
        <div className="flex items-center min-w-0">
          <div className="flex-1 min-w-0">
            <div className="min-w-0 w-full">
              <Link
                href={`/projects/runs/${projectId}/${testRun.id}`}
                className="group inline-flex items-center gap-1 max-w-full"
              >
                <h3 className="text-md font-semibold flex items-center gap-1 hover:text-primary min-w-0">
                  {isRecentlyCreated && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Flame className="h-4 w-4 shrink-0 text-orange-500 fill-orange-500 animate-pulse" />
                      </TooltipTrigger>
                      <TooltipContent>{tCommon("labels.new")}</TooltipContent>
                    </Tooltip>
                  )}
                  {isAutomatedRun ? (
                    <Bot className="w-6 h-6 inline me-1 shrink-0 border-2 text-primary border-primary rounded-full p-0.5" />
                  ) : (
                    <DynamicIcon
                      name="play-circle"
                      className="min-w-6 min-h-6 text-primary"
                    />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate inline-block">
                        {testRun.name}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-sm">{testRun.name}</p>
                    </TooltipContent>
                  </Tooltip>
                  {testRun.configurationGroupId && (
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
                  )}
                  {testRun.compositionLockedAt && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="shrink-0">
                          <Lock className="w-4 h-4 text-muted-foreground" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("runs.composition.locked")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </h3>
              </Link>
              <div className="inline-flex items-center ms-1 align-middle">
                <PendingReviewBadge pendingRequest={pendingRequest} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground line-clamp-1">
              {testRun.note && (
                <TextFromJson
                  jsonString={testRun.note}
                  format="text"
                  room={`testrun-note-${testRun.id}`}
                />
              )}
            </div>
          </div>
        </div>

        {/* Configuration Column */}
        <div className="flex items-center min-w-0">
          {testRun.configuration ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-sm text-muted-foreground truncate cursor-default">
                  <Combine className="w-4 h-4 shrink-0" />
                  <span className="truncate">{testRun.configuration.name}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="flex">
                  <Combine className="w-4 h-4 shrink-0 me-1" />
                  {testRun.configuration.name}
                </p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-sm text-muted-foreground">{"—"}</span>
          )}
        </div>

        {/* Middle Column 1 - Status */}
        {/* `[&>span]:!shrink [&>span]:!min-w-0` overrides WorkflowStateDisplay's
            outer `shrink-0` span so it shrinks within the cell and its inner
            `truncate` on the name engages (ellipsis instead of a hard clip). */}
        <div className="flex min-w-0 justify-start overflow-hidden [&>span]:!shrink [&>span]:!min-w-0">
          <WorkflowStateDisplay {...workflowState} />
        </div>

        {/* Middle Column 2 - Forecast */}
        <div className="flex flex-col min-w-0 overflow-hidden">
          <ForecastDisplay seconds={testRun.forecastManual} type="manual" />
          <ForecastDisplay
            seconds={testRun.forecastAutomated}
            type="automated"
          />
        </div>

        {/* Middle Column 3 - Test Run Cases Summary */}
        <div className="flex items-center justify-start min-w-0 overflow-hidden">
          <TestRunCasesSummary
            testRunId={testRun.id}
            projectId={testRun.projectId}
            testRunType={testRun.testRunType}
            className="w-full"
            summaryData={summaryData}
          />
        </div>

        {/* Right Column - MemberList & Actions */}
        <div className="flex items-center justify-end space-x-2 min-w-0">
          <div className="flex flex-col items-start gap-1.5 w-full min-w-0 max-w-xs overflow-hidden">
            {showMilestone && testRun.milestone && (
              <div className="truncate w-full min-w-0">
                <MilestoneIconAndName milestone={testRun.milestone} />
              </div>
            )}
            {testRun.isCompleted && testRun.completedAt && (
              <div className="w-full min-w-0">
                <DateTextDisplay
                  endDate={new Date(testRun.completedAt)}
                  isCompleted={true}
                />
              </div>
            )}

            {/* MemberList */}
            {!testRun.isCompleted && (
              <div className="w-full flex justify-end pe-1">
                <div className="ms-2">
                  <MemberList users={users} />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end space-x-2 pe-1">
            {showMoreMenu && (
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
                            `/projects/runs/${projectId}/${testRun.id}?edit=true`
                          )
                        }
                        data-testid={`testrun-edit-${testRun.id}`}
                      >
                        <Pencil className="me-2 h-4 w-4" />{" "}
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
            )}
          </div>
        </div>
      </div>
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
