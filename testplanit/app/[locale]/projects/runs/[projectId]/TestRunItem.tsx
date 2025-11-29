import React from "react";
import { useRouter } from "~/lib/navigation";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import {
  CheckCircle,
  LinkIcon,
  MoreVertical,
  Bot,
  Copy,
  Pencil,
  Combine,
  Space,
} from "lucide-react";
import { cn } from "~/utils";
import DynamicIcon from "@/components/DynamicIcon";
import TextFromJson from "@/components/TextFromJson";
import { MemberList } from "@/components/MemberList";
import { Link } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { TestRunCasesSummary } from "@/components/TestRunCasesSummary";
import type { IconName } from "~/types/globals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFindManyTestRunCases } from "~/lib/hooks";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { ApplicationArea, Configurations } from "@prisma/client";
import CompleteTestRunDialog from "./[runId]/CompleteTestRunDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface TestRunItemProps {
  testRun: {
    id: number;
    name: string;
    isCompleted: boolean;
    testRunType: string;
    configuration: Configurations | null;
    configurationGroupId: string | null;
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
}

const TestRunItem: React.FC<TestRunItemProps> = ({
  testRun,
  isNew,
  showMilestone = true,
  onDuplicate,
}) => {
  const tCommon = useTranslations("common");
  const { projectId } = useParams();
  const router = useRouter();

  // Fetch permissions
  const numericProjectId = parseInt(projectId as string, 10);
  const { permissions: testRunPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, ApplicationArea.TestRuns);
  const canCloseRun = testRunPermissions?.canClose ?? false;
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;

  // Determine if menu items should be shown
  const showEditItem =
    canAddEditRun && !testRun.isCompleted && testRun.testRunType !== "JUNIT";
  const showCompleteItem =
    !testRun.isCompleted && canCloseRun && !isLoadingPermissions;
  const showDuplicateItem =
    testRun.testRunType !== "JUNIT" &&
    !testRun.isCompleted &&
    canAddEditRun &&
    !isLoadingPermissions &&
    onDuplicate;

  const showMoreMenu = showEditItem || showCompleteItem || showDuplicateItem;

  // Fetch test run cases with their results and assigned users
  const { data: testRunCases } = useFindManyTestRunCases({
    where: {
      testRunId: testRun.id,
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

  // Using consistent grid layout for all items
  const gridLayout =
    "grid-cols-[minmax(0,1.5fr)_minmax(auto,0.75fr)_minmax(auto,0.5fr)_minmax(auto,1fr)_minmax(auto,1.5fr)_minmax(0,0.75fr)]";

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
                  {testRun.testRunType === "JUNIT" ? (
                    <Bot className="w-6 h-6 inline mr-1 shrink-0 border-2 text-primary border-primary rounded-full p-0.5" />
                  ) : (
                    <DynamicIcon
                      name="play-circle"
                      className="min-w-6 min-h-6 text-primary"
                    />
                  )}
                  <span className="truncate inline-block">{testRun.name}</span>
                  {testRun.configurationGroupId && (
                    <TooltipProvider>
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
                              <Combine className="w-4 h-4 shrink-0 mr-1" />
                              {testRun.configuration.name}
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </h3>
              </Link>
            </div>
            <div className="text-sm text-muted-foreground line-clamp-1">
              {testRun.note && (
                <TextFromJson
                  jsonString={testRun.note}
                  format="text"
                  room={`testrun-note-${testRun.id}`}
                  expand={false}
                />
              )}
            </div>
          </div>
        </div>

        {/* Configuration Column */}
        <div className="flex items-center min-w-0">
          {testRun.configuration ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground truncate cursor-default">
                    <Combine className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {testRun.configuration.name}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="flex">
                    <Combine className="w-4 h-4 shrink-0 mr-1" />
                    {testRun.configuration.name}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <span className="text-sm text-muted-foreground">{"—"}</span>
          )}
        </div>

        {/* Middle Column 1 - Status */}
        <div className="flex min-w-12 whitespace-nowrap justify-start">
          <WorkflowStateDisplay {...workflowState} />
        </div>

        {/* Middle Column 2 - Forecast */}
        <div className="min-w-48 truncate">
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
          />
        </div>

        {/* Right Column - MemberList & Actions */}
        <div className="flex items-center justify-end space-x-2 min-w-0">
          <div className="flex flex-col items-start gap-1.5 w-full min-w-0 max-w-xs truncate">
            {testRun.isCompleted && showMilestone && testRun.milestone && (
              <MilestoneIconAndName milestone={testRun.milestone} />
            )}
            {testRun.isCompleted && testRun.completedAt && (
              <DateTextDisplay
                endDate={new Date(testRun.completedAt)}
                isCompleted={true}
              />
            )}

            {/* MemberList */}
            {!testRun.isCompleted && (
              <div className="w-full flex justify-end">
                <MemberList users={users} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-end space-x-2 pr-1">
            {showMoreMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7">
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
                        <Pencil className="mr-2 h-4 w-4" />{" "}
                        {tCommon("actions.edit")}
                      </DropdownMenuItem>
                    )}

                    {showCompleteItem && (
                      <CompleteTestRunDialog
                        trigger={
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault(); // Prevents menu from closing
                            }}
                            data-testid={`testrun-complete-trigger-${testRun.id}`}
                          >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            {tCommon("actions.complete")}
                          </DropdownMenuItem>
                        }
                        testRunId={testRun.id}
                        projectId={numericProjectId}
                        stateId={testRun.state.id}
                        stateName={testRun.state.name}
                      />
                    )}

                    {showDuplicateItem && (
                      <DropdownMenuItem
                        onClick={() =>
                          onDuplicate &&
                          onDuplicate({ id: testRun.id, name: testRun.name })
                        }
                        data-testid={`testrun-duplicate-${testRun.id}`}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {tCommon("actions.duplicate")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default TestRunItem;
