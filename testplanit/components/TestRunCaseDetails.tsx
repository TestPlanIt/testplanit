import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { Separator } from "@/components/ui/separator";
import FieldValueRenderer from "@/projects/repository/[projectId]/[caseId]/FieldValueRenderer";
import { AttachmentsListDisplay } from "@/components/tables/AttachmentsListDisplay";
import { TagsListDisplay } from "@/components/tables/TagListDisplay";
import { useSession } from "next-auth/react";
import { useFindFirstRepositoryCasesFiltered } from "~/hooks/useRepositoryCasesWithFilteredFields";
import { useFindManyTemplates } from "~/lib/hooks/templates";
import { useFindManyStatus } from "~/lib/hooks";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { Attachments, Status, Prisma } from "@prisma/client";
import { Card } from "@/components/ui/card";
import {
  X,
  LayoutTemplate,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  CloudSunRain,
  Combine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyEditorContent } from "~/app/constants";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddResultModal } from "@/projects/repository/[projectId]/AddResultModal";
import {
  useCreateTestRunResults,
  useUpdateTestRunCases,
  useFindManyTestRunResults,
  useFindFirstWorkflows,
  useUpdateTestRuns,
} from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { toast } from "sonner";
import LoadingSpinner from "@/components/LoadingSpinner";
import TestResultHistory from "@/components/TestResultHistory";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { DurationDisplay } from "@/components/DurationDisplay";
import LinkedCasesPanel from "./LinkedCasesPanel";
import { ForecastDisplay } from "./ForecastDisplay";
import { notifyTestCaseAssignment } from "~/app/actions/test-run-notifications";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "./ui/badge";

interface TestRunCaseDetailsProps {
  caseId: number;
  projectId: number;
  onClose: () => void;
  testRunId?: number;
  testRunCaseId?: number;
  currentStatus?: {
    id: number;
    name: string;
    color: {
      value: string;
    };
  } | null;
  onNextCase: (nextCaseId: number) => void;
  testRunCasesData?: Array<{
    id: number;
    order: number;
    repositoryCaseId: number;
  }>;
  isTransitioning?: boolean;
  isCompleted?: boolean;
}

export function TestRunCaseDetails({
  caseId,
  projectId,
  onClose,
  testRunId,
  testRunCaseId,
  currentStatus,
  onNextCase,
  testRunCasesData,
  isTransitioning = false,
  isCompleted = false,
}: TestRunCaseDetailsProps) {
  const t = useTranslations("runs.details");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );
  const [showAddResultModal, setShowAddResultModal] = useState(false);
  const [selectedStatusId, setSelectedStatusId] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  // Fetch permissions
  const {
    permissions: testRunResultPermissions,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(projectId, "TestRunResults");
  const canAddEditResults = testRunResultPermissions?.canAddEdit ?? false;

  // Sort the incoming test cases by order memoized
  const sortedTestRunCasesData = React.useMemo(() => {
    return testRunCasesData
      ? [...testRunCasesData].sort((a, b) => a.order - b.order)
      : [];
  }, [testRunCasesData]);

  const handleSelect = (attachments: Attachments[], index: number) => {
    setSelectedAttachments(attachments);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => {
    setSelectedAttachmentIndex(null);
    setSelectedAttachments([]);
  };

  const { mutateAsync: createTestRunResult } = useCreateTestRunResults();
  const { mutateAsync: updateTestRunCase } = useUpdateTestRunCases();
  const { mutateAsync: updateTestRun } = useUpdateTestRuns();

  // Check if this is the first result for this test run
  const { data: existingResults } = useFindManyTestRunResults({
    where: {
      testRunId,
    },
    take: 1,
  });

  // Find the first IN_PROGRESS workflow state for this project
  const { data: inProgressWorkflow } = useFindFirstWorkflows({
    where: {
      projects: {
        some: {
          projectId: projectId,
        },
      },
      workflowType: "IN_PROGRESS",
      isEnabled: true,
      isDeleted: false,
    },
    orderBy: {
      order: "asc",
    },
  });

  // Define the select object for repositoryCaseWithDetails
  const repositoryCaseWithDetailsSelect = {
    id: true,
    name: true,
    estimate: true,
    forecastManual: true,
    forecastAutomated: true,
    currentVersion: true,
    state: {
      select: {
        id: true,
        name: true,
        icon: { select: { name: true } },
        color: { select: { value: true } },
      },
    },
    project: true,
    folder: true,
    creator: true,
    template: {
      select: {
        id: true,
        templateName: true,
        caseFields: {
          select: {
            caseFieldId: true,
            order: true,
            caseField: {
              select: {
                id: true,
                defaultValue: true,
                displayName: true,
                type: { select: { type: true } },
                fieldOptions: {
                  select: {
                    fieldOption: {
                      select: {
                        id: true,
                        icon: true,
                        iconColor: true,
                        name: true,
                        order: true,
                      },
                    },
                  },
                  orderBy: { fieldOption: { order: "asc" } },
                },
              },
            },
          },
          orderBy: { order: "asc" },
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
            type: { select: { type: true } },
          },
        },
      },
      where: { field: { isEnabled: true, isDeleted: false } },
    },
    attachments: {
      orderBy: { createdAt: "desc" },
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        url: true,
        createdAt: true,
        mimeType: true,
        size: true,
        note: true,
        createdBy: { select: { name: true, id: true } },
        testCaseId: true,
        isDeleted: true,
        createdById: true,
        sessionId: true,
        sessionResultsId: true,
        testRunsId: true,
        testRunResultsId: true,
        testRunStepResultId: true,
        junitTestResultId: true,
      },
    },
    steps: {
      where: { isDeleted: false },
      orderBy: { order: "asc" },
      select: {
        id: true,
        step: true,
        testCaseId: true,
        order: true,
        expectedResult: true,
        isDeleted: true,
        sharedStepGroupId: true,
        sharedStepGroup: {
          select: {
            id: true,
            name: true,
            projectId: true,
            isDeleted: true,
            deletedAt: true,
            createdAt: true,
            updatedAt: true,
            createdById: true,
          },
        },
      },
    },
    tags: {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    },
    issues: {
      select: {
        id: true,
        name: true,
        externalId: true,
      },
    },
    testRuns: {
      where: {
        testRunId: testRunId || undefined,
      },
      select: {
        id: true,
        testRun: {
          select: {
            id: true,
            name: true,
            milestone: {
              select: {
                name: true,
                completedAt: true,
              },
            },
            configuration: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        results: {
          select: {
            id: true,
            status: {
              select: {
                name: true,
                color: {
                  select: {
                    value: true,
                  },
                },
              },
            },
            executedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            editedBy: {
              select: {
                id: true,
                name: true,
              },
            },
            editedAt: true,
            executedAt: true,
            elapsed: true,
            attempt: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
    source: true,
  } satisfies Prisma.RepositoryCasesSelect;

  // Define the explicit type for the testcase based on the select
  type RepositoryCaseWithDetails = Prisma.RepositoryCasesGetPayload<{
    select: typeof repositoryCaseWithDetailsSelect;
  }>;

  const { data: testcase, isLoading } = useFindFirstRepositoryCasesFiltered({
    where: { id: caseId, isDeleted: false },
    select: repositoryCaseWithDetailsSelect,
  }) as {
    data: RepositoryCaseWithDetails | null | undefined;
    isLoading: boolean;
  };

  const { data: templates } = useFindManyTemplates({
    where: {
      isDeleted: false,
      isEnabled: true,
    },
    include: {
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
      },
    },
  });

  // Fetch available statuses
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

  const displayStatus = currentStatus || defaultStatus;
  if (!displayStatus) return null;

  const handleStatusChange = (statusId: string) => {
    setSelectedStatusId(statusId);
    setShowAddResultModal(true);
  };

  const handleAddResultModalClose = () => {
    setShowAddResultModal(false);
    setSelectedStatusId(undefined);
  };

  const hasColor = (
    s: typeof displayStatus
  ): s is { id: number; name: string; color: { value: string } } => {
    return "color" in s && s.color !== undefined;
  };

  if (isLoading || !testcase) return null;

  const hasAttachments = testcase.attachments.length > 0;
  const hasTags = testcase.tags.length > 0;

  // Determine if the user can manage links (reuse canAddEditResults or add a new permission if needed)
  const canManageLinks = canAddEditResults; // Adjust if you want a different permission check

  const nonEmptyFields = testcase.template.caseFields.filter((field) => {
    // For Steps type, check testcase.steps
    if (field.caseField.type.type === "Steps") {
      return testcase.steps && testcase.steps.length > 0;
    }

    const fieldValue = testcase.caseFieldValues.find(
      (value) => value.fieldId === field.caseFieldId
    )?.value;

    const fieldType = field.caseField.type.type;

    // Handle Text Long fields with emptyEditorContent
    if (fieldType === "Text Long" && typeof fieldValue === "string") {
      try {
        const parsedContent = JSON.parse(fieldValue);
        const isEmptyEditor =
          JSON.stringify(parsedContent) === JSON.stringify(emptyEditorContent);
        if (isEmptyEditor) {
          return false;
        }
      } catch (e) {
        // Silently handle parsing errors
      }
    }

    if (fieldValue === null || fieldValue === undefined || fieldValue === "") {
      return false;
    }
    if (Array.isArray(fieldValue) && fieldValue.length === 0) {
      return false;
    }
    if (
      typeof fieldValue === "object" &&
      fieldValue !== null &&
      Object.keys(fieldValue).length === 0
    ) {
      return false;
    }

    return true;
  });

  const handleQuickPass = async () => {
    if (
      !session?.user?.id ||
      !testRunId ||
      !testRunCaseId ||
      !testcase?.currentVersion
    )
      return;

    setIsSubmitting(true);

    try {
      // Find the success status
      const successStatus = statuses?.find(
        (status) => status.isSuccess === true
      );
      if (!successStatus) {
        toast.error(tCommon("errors.noSuccessStatus"));
        return;
      }

      // Create the test run result
      await createTestRunResult({
        data: {
          testRunId,
          testRunCaseId,
          statusId: successStatus.id,
          notes: emptyEditorContent,
          evidence: {},
          executedById: session.user.id,
          attempt: 1,
          testRunCaseVersion: testcase.currentVersion,
        },
      });

      // If this is the first result and we have an IN_PROGRESS workflow state
      if (existingResults?.length === 0 && inProgressWorkflow) {
        // Update the test run's workflow state
        await updateTestRun({
          where: {
            id: testRunId,
          },
          data: {
            stateId: inProgressWorkflow.id,
          },
        });
      }

      // Update the test run case status
      await updateTestRunCase({
        where: {
          id: testRunCaseId,
        },
        data: {
          statusId: successStatus.id,
        },
      });

      // --- Trigger forecast update for this case ---
      fetch(`/api/forecast/update?caseId=${caseId}`);

      toast.success(tCommon("actions.resultAdded"), {
        description: tCommon("actions.resultAddedDescription"),
      });

      // Move to next case if available
      if (onNextCase) {
        const currentCase = testRunCasesData?.find(
          (trc) => trc.repositoryCaseId === caseId
        );

        if (currentCase) {
          const nextCases = testRunCasesData
            ?.filter((trc) => trc.order > currentCase.order)
            .sort((a, b) => a.order - b.order);

          const nextCase = nextCases?.[0];

          if (nextCase) {
            onNextCase(nextCase.repositoryCaseId);
          }
        }
      }
    } catch (error) {
      console.error("Error submitting result:", error);
      toast.error(tCommon("errors.error"), {
        description: tCommon("errors.somethingWentWrong"),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDisabled =
    isSubmitting ||
    isLoading ||
    isLoadingPermissions ||
    isTransitioning ||
    isCompleted ||
    !canAddEditResults;
  const isNavigationDisabled =
    isSubmitting || isLoading || isLoadingPermissions || isTransitioning;

  // --- Previous/Next Case Logic ---
  const currentCaseIndex =
    sortedTestRunCasesData?.findIndex(
      (trc) => trc.repositoryCaseId === caseId
    ) ?? -1; // Ensure we get -1 if data is missing or not found

  const previousCase =
    currentCaseIndex > 0
      ? sortedTestRunCasesData?.[currentCaseIndex - 1]
      : null;

  const nextCase =
    currentCaseIndex !== -1 &&
    currentCaseIndex < sortedTestRunCasesData.length - 1
      ? sortedTestRunCasesData?.[currentCaseIndex + 1]
      : null;

  // --------------------------------

  // Add this function to handle assignment changes
  const handleAssignmentChange = async (
    user: {
      id: string;
      name: string;
      email: string | null;
      image: string | null;
    } | null
  ) => {
    if (!testRunCaseId || isAssigning) return;
    setIsAssigning(true);

    try {
      const previousAssigneeId =
        testcase?.testRuns?.[0]?.assignedTo?.id || null;
      const userId = user?.id || null;

      await updateTestRunCase({
        where: {
          id: testRunCaseId,
        },
        data: {
          assignedToId: userId,
        },
      });

      // Send notification for the assignment
      if (userId && userId !== previousAssigneeId) {
        await notifyTestCaseAssignment(
          testRunCaseId,
          userId,
          previousAssigneeId
        );
      }

      toast.success(
        userId ? tCommon("success.assigned") : tCommon("success.unassigned")
      );
    } catch (error) {
      console.error("Error assigning user:", error);
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-2 relative -ml-1">
      {isTransitioning && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <LoadingSpinner />
            <span className="text-sm text-muted-foreground">
              {tCommon("loading")}
            </span>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center gap-2 bg-primary p-4">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          {testRunId && canAddEditResults && (
            <>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddResultModal(true)}
                  disabled={isDisabled}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" />
                  {tCommon("actions.addResult")}
                </Button>
                <div className="flex">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleQuickPass}
                    disabled={isDisabled}
                    className="flex items-center gap-1 rounded-r-none border-r-0"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {tCommon("actions.passAndNext")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isDisabled}
                        className="flex items-center gap-1 rounded-l-none border-l-0"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px]">
                      {statuses?.map((status) => (
                        <DropdownMenuItem
                          key={status.id}
                          disabled={isDisabled}
                          onClick={async () => {
                            if (
                              !session?.user?.id ||
                              !testRunId ||
                              !testRunCaseId ||
                              !testcase?.currentVersion
                            )
                              return;

                            setIsSubmitting(true);

                            try {
                              // Create the test run result
                              await createTestRunResult({
                                data: {
                                  testRunId,
                                  testRunCaseId,
                                  statusId: status.id,
                                  notes: emptyEditorContent,
                                  evidence: {},
                                  executedById: session.user.id,
                                  attempt: 1,
                                  testRunCaseVersion: testcase.currentVersion,
                                },
                              });

                              // Update the test run case status
                              await updateTestRunCase({
                                where: {
                                  id: testRunCaseId,
                                },
                                data: {
                                  statusId: status.id,
                                },
                              });

                              toast.success(tCommon("actions.resultAdded"), {
                                description: tCommon(
                                  "actions.resultAddedDescription"
                                ),
                              });

                              // Move to next case if available
                              if (onNextCase) {
                                const currentCase = testRunCasesData?.find(
                                  (trc) => trc.repositoryCaseId === caseId
                                );

                                if (currentCase) {
                                  const nextCases = testRunCasesData
                                    ?.filter(
                                      (trc) => trc.order > currentCase.order
                                    )
                                    .sort((a, b) => a.order - b.order);

                                  const nextCase = nextCases?.[0];

                                  if (nextCase) {
                                    onNextCase(nextCase.repositoryCaseId);
                                  }
                                }
                              }
                            } catch (error) {
                              console.error("Error submitting result:", error);
                              toast.error(tCommon("errors.error"), {
                                description: tCommon(
                                  "errors.somethingWentWrong"
                                ),
                              });
                            } finally {
                              setIsSubmitting(false);
                            }
                          }}
                          className="flex items-center cursor-pointer"
                        >
                          <div
                            className="w-3 h-3 rounded-full mr-2"
                            style={{
                              backgroundColor: status.color?.value || "#B1B2B3",
                            }}
                          />
                          <span className="flex-1">{status.name}</span>
                          {status.isSuccess && (
                            <CheckCircle className="h-4 w-4 ml-2 text-muted-foreground" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="min-w-[200px] max-w-[300px]">
                <AsyncCombobox
                  value={
                    testcase?.testRuns?.[0]?.assignedTo
                      ? {
                          id: testcase.testRuns[0].assignedTo.id,
                          name: testcase.testRuns[0].assignedTo.name,
                          email: null,
                          image: null,
                        }
                      : null
                  }
                  onValueChange={handleAssignmentChange}
                  fetchOptions={(query, page, pageSize) =>
                    searchProjectMembers(projectId, query, page, pageSize)
                  }
                  renderOption={(user) => (
                    <UserNameCell userId={user.id} hideLink />
                  )}
                  getOptionValue={(user) => user.id}
                  placeholder={t("selectUser")}
                  disabled={isDisabled}
                  className="h-8 w-[200px] bg-background"
                  pageSize={20}
                  showTotal={true}
                  showUnassigned={true}
                />
              </div>
            </>
          )}
        </div>
        {/* --- Previous/Next Buttons --- */}
        <div className="flex items-center gap-2 shrink-0 mr-8">
          {/* Prev Button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!previousCase || isNavigationDisabled}
            onClick={() =>
              previousCase && onNextCase(previousCase.repositoryCaseId)
            }
            aria-label={tCommon("actions.previousCase")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {/* Index Indicator */}
          {testRunCasesData &&
            currentCaseIndex !== undefined &&
            currentCaseIndex !== -1 && (
              <span
                className="text-sm text-primary-foreground"
                title={`Index: ${currentCaseIndex}`}
              >
                {currentCaseIndex + 1} {tCommon("of")} {testRunCasesData.length}
              </span>
            )}
          {/* Next Button */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!nextCase || isNavigationDisabled}
            onClick={() => nextCase && onNextCase(nextCase.repositoryCaseId)}
            aria-label={tCommon("actions.nextCase")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex justify-between items-center px-4">
        <div className="flex-1">
          <CaseDisplay
            id={testcase.id}
            name={testcase.name}
            large={true}
            source={testcase.source}
          />
          {testcase.testRuns?.[0]?.testRun?.configuration && (
            <Badge className="flex items-center gap-1 text-sm mt-1 w-fit">
              <Combine className="w-4 h-4 shrink-0" />
              <span>{testcase.testRuns[0].testRun.configuration.name}</span>
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {testRunId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={isDisabled}
                  className="h-8 bg-transparent hover:bg-muted justify-start"
                >
                  <div className="flex items-center space-x-1 whitespace-nowrap">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{
                        backgroundColor: hasColor(displayStatus)
                          ? displayStatus.color.value
                          : "#B1B2B3",
                      }}
                    />
                    <div>{displayStatus.name}</div>
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[140px]">
                {statuses?.map((statusOption) => (
                  <DropdownMenuItem
                    key={statusOption.id}
                    disabled={isDisabled}
                    onClick={() =>
                      handleStatusChange(statusOption.id.toString())
                    }
                    className={`flex items-center cursor-pointer ${
                      statusOption.id === displayStatus.id ? "bg-muted" : ""
                    }`}
                  >
                    <div
                      className="w-3 h-3 rounded-full mr-2"
                      style={{
                        backgroundColor: statusOption.color?.value || "#B1B2B3",
                      }}
                    />
                    <span className="flex-1">{statusOption.name}</span>
                    {statusOption.id === displayStatus.id && (
                      <Check className="h-4 w-4 ml-2 text-muted-foreground" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Card
        className="p-4 space-y-4 border-none rounded-none ml-1"
        shadow="none"
      >
        <div className="flex justify-between">
          <div className="space-y-4">
            {testcase.state && (
              <div className="flex items-center gap-2">
                <DynamicIcon
                  name={testcase.state.icon?.name as IconName}
                  className="w-6 h-6 shrink-0"
                  color={testcase.state.color?.value}
                />
                <span>{testcase.state.name}</span>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {testcase.template && (
              <div className="flex items-center gap-2">
                <LayoutTemplate className="w-6 h-6 shrink-0" />
                <span>{testcase.template.templateName}</span>
              </div>
            )}
          </div>
        </div>
        <div className="space-x-2">
          <div className="flex items-center justify-between">
            <div className="">
              {testcase.estimate && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {tCommon("fields.estimate")}:
                  </span>
                  <span className="text-muted-foreground text-sm flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <DurationDisplay seconds={testcase.estimate} />
                  </span>
                </div>
              )}
              {testcase.forecastManual && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {tCommon("fields.forecast")}:
                  </span>
                  <span className="text-muted-foreground text-sm flex items-center gap-1  ">
                    <ForecastDisplay
                      seconds={testcase.forecastManual}
                      type="manual"
                    />
                    <ForecastDisplay
                      seconds={testcase.forecastAutomated}
                      type="automated"
                    />
                  </span>
                </div>
              )}
              {testcase.forecastAutomated && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {tCommon("fields.forecast")}:
                  </span>
                  <span className="text-muted-foreground text-sm flex items-center gap-1  ">
                    <CloudSunRain className="w-4 h-4" />
                    <DurationDisplay
                      seconds={testcase.forecastAutomated}
                      round={false}
                    />
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2 items-center">
              {hasAttachments && (
                <AttachmentsListDisplay
                  attachments={testcase.attachments}
                  onSelect={handleSelect}
                />
              )}
              {hasTags && (
                <TagsListDisplay tags={testcase.tags} projectId={projectId} />
              )}
              {testcase.issues && testcase.issues.length > 0 && (
                <IssuesListDisplay
                  issues={testcase.issues.map((issue) => ({
                    ...issue,
                    projectIds: [projectId],
                  }))}
                />
              )}
            </div>
          </div>
        </div>

        {nonEmptyFields.length > 0 && <Separator />}

        {nonEmptyFields.length > 0 && (
          <div>
            <div className="grid grid-cols-1 gap-4">
              {nonEmptyFields.map((field) => {
                const fieldValue =
                  field.caseField.type.type === "Steps"
                    ? testcase.steps
                    : testcase.caseFieldValues.find(
                        (value) => value.fieldId === field.caseField.id
                      )?.value;

                const isEmptyValue = (value: any): boolean => {
                  if (field.caseField.type.type === "Steps") {
                    return !value || value.length === 0;
                  }

                  // Handle Text Long fields with emptyEditorContent
                  if (
                    field.caseField.type.type === "Text Long" &&
                    typeof value === "string"
                  ) {
                    try {
                      const parsedContent = JSON.parse(value);
                      // Check if it's an empty Text Long field (has only one paragraph with no content)
                      if (
                        parsedContent.type === "doc" &&
                        parsedContent.content?.length === 1 &&
                        parsedContent.content[0].type === "paragraph" &&
                        (!parsedContent.content[0].content ||
                          parsedContent.content[0].content.length === 0)
                      ) {
                        return true;
                      }
                    } catch (e) {
                      // Silently handle parsing errors
                    }
                  }

                  if (value === null || value === undefined || value === "") {
                    return true;
                  }
                  if (Array.isArray(value) && value.length === 0) {
                    return true;
                  }
                  if (
                    typeof value === "object" &&
                    value !== null &&
                    Object.keys(value).length === 0
                  ) {
                    return true;
                  }
                  return false;
                };

                if (isEmptyValue(fieldValue)) {
                  return null;
                }

                return (
                  <div key={field.caseField.id} className="">
                    <div className="font-medium text-sm text-primary border-b mb-1 border-muted-foreground/50">
                      {field.caseField.displayName}
                    </div>
                    <FieldValueRenderer
                      fieldValue={fieldValue}
                      fieldType={field.caseField.type.type}
                      caseId={caseId.toString()}
                      template={{
                        caseFields: testcase.template.caseFields,
                      }}
                      fieldId={field.caseField.id}
                      session={session}
                      isEditMode={false}
                      isSubmitting={false}
                      control={undefined}
                      errors={undefined}
                      isRunMode={true}
                      stepsForDisplay={testcase.steps}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Linked Cases Panel */}
        <LinkedCasesPanel
          caseId={caseId}
          projectId={projectId}
          session={session}
          canManageLinks={canManageLinks}
        />

        <TestResultHistory
          caseId={caseId}
          projectId={projectId}
          session={session}
        />
      </Card>

      {selectedAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={selectedAttachments}
          initialIndex={selectedAttachmentIndex}
          onClose={handleClose}
          canEdit={false} // TODO: Add canEdit
        />
      )}
      {showAddResultModal && testRunId && testRunCaseId && (
        <AddResultModal
          isOpen={showAddResultModal}
          onClose={handleAddResultModalClose}
          testRunId={testRunId}
          testRunCaseId={testRunCaseId}
          caseName={testcase.name}
          projectId={projectId}
          defaultStatusId={selectedStatusId || successStatus?.id?.toString()}
          steps={testcase.steps}
          configuration={testcase.testRuns?.[0]?.testRun?.configuration}
        />
      )}
    </div>
  );
}
