import React, { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Prisma } from "@prisma/client";
import { useFindManyColor } from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { Button } from "@/components/ui/button";
import { CirclePlus } from "lucide-react";
import TestRunItem from "./TestRunItem";
import DynamicIcon from "@/components/DynamicIcon";
import { sortMilestones } from "~/utils/milestoneUtils";
import {
  getStatus,
  getStatusStyle,
  createColorMap,
  ColorMap,
} from "~/utils/milestoneUtils";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import AddTestRunModal from "./AddTestRunModal";
import CompleteTestRunDialog from "./[runId]/CompleteTestRunDialog";
import { MilestonesWithTypes } from "~/utils/milestoneUtils";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useFindManyTestRunCases } from "~/lib/hooks/test-run-cases";

const testRunPropSelect = {
  id: true,
  name: true,
  isCompleted: true,
  testRunType: true,
  completedAt: true,
  createdAt: true,
  note: true,
  docs: true,
  projectId: true,
  configId: true,
  configurationGroupId: true,
  milestoneId: true,
  stateId: true,
  forecastManual: true,
  forecastAutomated: true,
  configuration: true,
  state: { include: { icon: true, color: true } },
  createdBy: true,
  project: { select: { name: true } },
  milestone: {
    include: {
      milestoneType: { include: { icon: true } },
      children: {
        include: {
          milestoneType: { include: { icon: true } },
        },
      },
    },
  },
  // The following are in page.tsx's querySelect but TestRunDisplay fetches testRunCases itself.
  // If TestRunDisplay and TestRunItem do not use testCases, tags, issues, results directly from this prop,
  // they could be omitted here for a leaner prop type.
  // For now, including them to strictly match a likely querySelect from page.tsx.
  testCases: {
    select: {
      id: true,
      repositoryCaseId: true,
      assignedTo: { select: { id: true, name: true, image: true } },
      status: { select: { isCompleted: true } },
      repositoryCase: { select: { estimate: true } },
    },
  },
  tags: { select: { id: true, name: true } },
  issues: {
    select: {
      id: true,
      name: true,
      externalId: true,
      externalUrl: true,
      title: true,
      externalStatus: true,
      issueTypeName: true,
      issueTypeIconUrl: true,
      integrationId: true,
      lastSyncedAt: true,
      integration: {
        select: {
          id: true,
          provider: true,
          name: true,
        },
      },
    },
  },
  results: { select: { id: true } },
} as const;

export type TestRunsWithDetails = Prisma.TestRunsGetPayload<{
  select: typeof testRunPropSelect;
}>;

const milestonesPropInclude = {
  milestoneType: { include: { icon: true } },
  children: {
    include: {
      milestoneType: { include: { icon: true } },
    },
  },
} as const;

export type MilestonePropItem = Prisma.MilestonesGetPayload<{
  include: typeof milestonesPropInclude;
}>;

interface TestRunDisplayProps {
  testRuns: TestRunsWithDetails[];
  milestones: MilestonePropItem[];
  onDuplicateTestRun?: (run: { id: number; name: string }) => void;
}

type GroupedTestRuns = {
  unscheduled: TestRunsWithDetails[];
  milestones: {
    [milestoneId: number]: {
      milestone: MilestonesWithTypes;
      testRuns: TestRunsWithDetails[];
    };
  };
};

const buildMilestoneTree = (
  milestones: MilestonePropItem[]
): MilestonesWithTypes[] => {
  const milestoneMap: { [key: number]: MilestonesWithTypes } = {};
  const rootMilestones: MilestonesWithTypes[] = [];

  milestones.forEach((milestone) => {
    milestoneMap[milestone.id] = { ...(milestone as any), children: [] }; // Use 'as any' for spread if direct assignability is an issue, or ensure MilestonePropItem is structurally compatible for the spread part of MilestonesWithTypes
  });

  milestones.forEach((milestone) => {
    if (milestone.parentId && milestoneMap[milestone.parentId]) {
      milestoneMap[milestone.parentId].children.push(
        milestoneMap[milestone.id]
      );
    } else {
      rootMilestones.push(milestoneMap[milestone.id]);
    }
  });

  return rootMilestones;
};

const groupTestRuns = (
  currentTestRuns: TestRunsWithDetails[],
  currentMilestoneTree: MilestonesWithTypes[]
): GroupedTestRuns => {
  const grouped: GroupedTestRuns = {
    unscheduled: [],
    milestones: {},
  };

  const addTestRunsToMilestone = (
    milestone: MilestonesWithTypes,
    testRunsToGroup: TestRunsWithDetails[]
  ) => {
    if (!grouped.milestones[milestone.id]) {
      grouped.milestones[milestone.id] = {
        milestone,
        testRuns: [],
      };
    }

    testRunsToGroup.forEach((testRun) => {
      if (testRun.milestoneId === milestone.id) {
        grouped.milestones[milestone.id].testRuns.push(testRun);
      }
    });

    milestone.children.forEach((child) => {
      addTestRunsToMilestone(child, testRunsToGroup);
    });
  };

  currentTestRuns.forEach((testRun) => {
    if (!testRun.milestoneId) {
      grouped.unscheduled.push(testRun);
    }
  });

  currentMilestoneTree.forEach((milestone) => {
    addTestRunsToMilestone(milestone, currentTestRuns);
  });

  // Remove milestone groups that have no testRuns
  Object.keys(grouped.milestones).forEach((milestoneId) => {
    const milestoneGroup = grouped.milestones[Number(milestoneId)];
    if (milestoneGroup.testRuns.length === 0) {
      delete grouped.milestones[Number(milestoneId)];
    }
  });

  // Sort unscheduled testRuns by createdAt date
  grouped.unscheduled.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return grouped;
};

const findMilestonePath = (
  milestone: MilestonesWithTypes,
  targetMilestoneId: number,
  path: MilestonesWithTypes[] = []
): MilestonesWithTypes[] | null => {
  if (milestone.id === targetMilestoneId) {
    return [...path, milestone];
  }

  for (const child of milestone.children) {
    const result = findMilestonePath(child, targetMilestoneId, [
      ...path,
      milestone,
    ]);
    if (result) {
      return result;
    }
  }

  return null;
};

const TestRunDisplay: React.FC<TestRunDisplayProps> = ({
  testRuns = [],
  milestones: milestonesProp = [],
  onDuplicateTestRun,
}) => {
  const t = useTranslations("runs");
  const tCommon = useTranslations("common");
  const tMilestones = useTranslations("milestones");
  const tSessions = useTranslations("sessions");
  const { projectId } = useParams();
  const { data: session } = useSession();
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const numericProjectId = parseInt(projectId as string, 10);
  const { permissions: testRunPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, "TestRuns");
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;

  const [selectedMilestoneId, setSelectedMilestoneId] = useState<number | null>(
    null
  );
  const [isAddTestRunModalOpen, setIsAddTestRunModalOpen] = useState(false);
  const [colorMap, setColorMap] = useState<ColorMap | null>(null);
  const [selectedTestRun, setSelectedTestRun] =
    useState<TestRunsWithDetails | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTestRunId, setNewTestRunId] = useState<number | null>(null);
  const [modalSelectedTestCases, setModalSelectedTestCases] = useState<
    number[]
  >([]);

  const testRunIds = useMemo(() => testRuns.map((run) => run.id), [testRuns]);
  const { data: testRunCases } = useFindManyTestRunCases(
    {
      where: { testRunId: { in: testRunIds } },
      select: { id: true, testRunId: true, repositoryCaseId: true },
    },
    { enabled: testRunIds.length > 0 }
  );

  const testCasesByTestRunId = useMemo(() => {
    if (!testRunCases) return {};
    return testRunCases.reduce(
      (acc, testCase) => {
        if (!acc[testCase.testRunId]) acc[testCase.testRunId] = [];
        acc[testCase.testRunId].push(testCase);
        return acc;
      },
      {} as Record<number, typeof testRunCases>
    );
  }, [testRunCases]);

  const incompleteTestRuns = useMemo(() => {
    return [...testRuns]
      .sort((a, b) => {
        if (a.isCompleted && b.isCompleted) {
          return (
            new Date(b.completedAt!).getTime() -
            new Date(a.completedAt!).getTime()
          );
        }
        if (!a.isCompleted && !b.isCompleted) {
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        }
        return a.isCompleted ? 1 : -1;
      })
      .filter((run) => !run.isCompleted);
  }, [testRuns]);

  const milestoneTree = useMemo(
    () => buildMilestoneTree(milestonesProp),
    [milestonesProp]
  );
  const sortedMilestoneTree = useMemo(
    () => sortMilestones(milestoneTree),
    [milestoneTree]
  );

  const groupedTestRunData = useMemo(
    () => groupTestRuns(incompleteTestRuns, sortedMilestoneTree),
    [incompleteTestRuns, sortedMilestoneTree]
  );

  const allRunsCompleted = useMemo(
    () => testRuns.every((run) => run.isCompleted),
    [testRuns]
  );

  useEffect(() => {
    if (colors) {
      const map = createColorMap(colors);
      setColorMap(map);
    }
  }, [colors]);

  useEffect(() => {
    const handleTestRunCreated = (event: CustomEvent) => {
      setNewTestRunId(event.detail);
      setTimeout(() => {
        const element = document.getElementById(`testrun-${event.detail}`);
        if (element)
          element.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      setTimeout(() => setNewTestRunId(null), 5000);
    };
    window.addEventListener(
      "testRunCreated",
      handleTestRunCreated as EventListener
    );
    return () => {
      window.removeEventListener(
        "testRunCreated",
        handleTestRunCreated as EventListener
      );
    };
  }, []);

  const isAdmin =
    session?.user?.access === "ADMIN" ||
    session?.user?.access === "PROJECTADMIN";
  const handleOpenDialog = (testRun: TestRunsWithDetails) => {
    setSelectedTestRun(testRun);
    setIsDialogOpen(true);
  };
  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedTestRun(null);
  };
  const handleAddTestRun = (milestoneId: number | null) => {
    setSelectedMilestoneId(milestoneId);
    setIsAddTestRunModalOpen(true);
  };

  if (isColorsLoading || isLoadingPermissions || !colorMap) return <Loading />;
  if (!testRuns || testRuns.length === 0) return null;

  if (allRunsCompleted) {
    const sortedCompletedTestRuns = [...testRuns].sort((a, b) => {
      return (
        new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
      );
    });
    return (
      <div className="flex flex-col items-center w-full">
        <div className="w-full">
          {sortedCompletedTestRuns.map((testRun) => (
            <TestRunItem
              key={testRun.id}
              testRun={{
                id: testRun.id,
                name: testRun.name,
                isCompleted: testRun.isCompleted,
                testRunType: testRun.testRunType,
                configuration: testRun.configuration,
                configurationGroupId: testRun.configurationGroupId,
                state: testRun.state,
                note:
                  typeof testRun.note === "string"
                    ? testRun.note
                    : testRun.note
                      ? JSON.stringify(testRun.note)
                      : undefined,
                completedAt: testRun.completedAt
                  ? new Date(testRun.completedAt)
                  : undefined,
                milestone: testRun.milestone
                  ? {
                      id: testRun.milestone.id,
                      name: testRun.milestone.name,
                      startedAt: testRun.milestone.startedAt
                        ? new Date(testRun.milestone.startedAt)
                        : undefined,
                      completedAt: testRun.milestone.completedAt
                        ? new Date(testRun.milestone.completedAt)
                        : undefined,
                      isCompleted: testRun.milestone.isCompleted,
                      milestoneType: testRun.milestone.milestoneType,
                    }
                  : undefined,
                projectId: testRun.projectId,
                createdBy: testRun.createdBy,
                forecastManual: testRun.forecastManual,
                forecastAutomated: testRun.forecastAutomated,
              }}
              milestonePath={testRun.milestone?.name}
              onDuplicate={onDuplicateTestRun}
            />
          ))}
        </div>
        {selectedTestRun && (
          <CompleteTestRunDialog
            trigger={
              <Button variant="outline" size="sm">
                {tCommon("actions.complete")}
              </Button>
            }
            testRunId={selectedTestRun.id}
            projectId={selectedTestRun.projectId}
            stateId={selectedTestRun.state.id}
            stateName={selectedTestRun.state.name}
          />
        )}
      </div>
    );
  }

  const renderGroupedTestRuns = (
    currentGroupedRuns: GroupedTestRuns,
    currentMilestoneTree: MilestonesWithTypes[],
    handleOpenDialogParam: (testRun: TestRunsWithDetails) => void,
    isAdminParam: boolean,
    onDuplicateTestRunParam?: (run: { id: number; name: string }) => void
  ) => {
    const hasTestRuns = (milestone: MilestonesWithTypes): boolean => {
      if (currentGroupedRuns.milestones[milestone.id]?.testRuns.length > 0) {
        return true;
      }

      return milestone.children?.some(hasTestRuns) ?? false;
    };

    const renderMilestoneWithTestRuns = (
      milestone: MilestonesWithTypes,
      depth: number = 0
    ) => {
      if (!hasTestRuns(milestone)) return null;

      const status = getStatus(milestone);
      const { badge } = getStatusStyle(status, "light", colorMap);

      // Check if there are test runs under this milestone
      const hasTestRunsUnderMilestone =
        currentGroupedRuns.milestones[milestone.id]?.testRuns.length > 0;

      return (
        <div
          key={milestone.id}
          className={
            depth > 0
              ? "w-full pl-4 bg-muted rounded-lg mb-4"
              : "w-full rounded-lg bg-muted mb-4"
          }
        >
          <div
            className={`milestone-grid bg-primary/10 p-2 pr-4 ${
              depth === 0 ? "rounded-t-lg" : ""
            }`}
          >
            {/* Milestone Name */}
            <div className="flex items-center gap-1 justify-start min-w-0">
              <div className="flex items-center gap-1 justify-start min-w-0">
                {depth > 0 && (
                  <DynamicIcon
                    name="corner-down-right"
                    className="w-6 h-6 text-primary/50 shrink-0 bg-transparent"
                  />
                )}
                <div className="truncate">
                  <MilestoneIconAndName milestone={milestone} />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="milestone-status flex gap-2 justify-center">
              <Badge
                style={{ backgroundColor: badge }}
                className="text-secondary-background border-2 border-secondary-foreground text-sm"
              >
                {tMilestones(`statusLabels.${status}` as any)}
              </Badge>
            </div>

            {/* Dates */}
            <div className="milestone-dates flex justify-end">
              <div className="grow text-sm text-muted-foreground">
                {canAddEditRun && (
                  <AddTestRunModal
                    defaultMilestoneId={milestone.id}
                    open={
                      isAddTestRunModalOpen &&
                      selectedMilestoneId === milestone.id
                    }
                    onOpenChange={(open) => {
                      setIsAddTestRunModalOpen(open);
                      if (!open) {
                        setModalSelectedTestCases([]);
                        setSelectedMilestoneId(null);
                      }
                    }}
                    initialSelectedCaseIds={modalSelectedTestCases}
                    onSelectedCasesChange={setModalSelectedTestCases}
                    trigger={
                      <Button
                        variant="link"
                        className="p-0"
                        onClick={() => handleAddTestRun(milestone.id)}
                      >
                        <CirclePlus className="h-4 w-4" />
                        <span className="hidden md:inline">
                          {t("add.title")}
                        </span>
                      </Button>
                    }
                  />
                )}
                <DateTextDisplay
                  startDate={
                    milestone.startedAt ? new Date(milestone.startedAt) : null
                  }
                  endDate={
                    milestone.completedAt
                      ? new Date(milestone.completedAt)
                      : null
                  }
                  isCompleted={milestone.isCompleted}
                />
              </div>
            </div>
          </div>

          {/* Render test runs under this milestone FIRST */}
          {hasTestRunsUnderMilestone && (
            <div className="test-runs-container bg-muted pr-4 pb-2 mb-2">
              {currentGroupedRuns.milestones[milestone.id]?.testRuns.map(
                (testRun) => (
                  <div key={testRun.id} style={{ paddingLeft: "1.5rem" }}>
                    <TestRunItem
                      key={testRun.id}
                      testRun={{
                        id: testRun.id,
                        name: testRun.name,
                        isCompleted: testRun.isCompleted,
                        testRunType: testRun.testRunType,
                        configuration: testRun.configuration,
                        configurationGroupId: testRun.configurationGroupId,
                        state: testRun.state,
                        note:
                          typeof testRun.note === "string"
                            ? testRun.note
                            : testRun.note
                              ? JSON.stringify(testRun.note)
                              : undefined,
                        completedAt: testRun.completedAt
                          ? new Date(testRun.completedAt)
                          : undefined,
                        milestone: testRun.milestone
                          ? {
                              id: testRun.milestone.id,
                              name: testRun.milestone.name,
                              startedAt: testRun.milestone.startedAt
                                ? new Date(testRun.milestone.startedAt)
                                : undefined,
                              completedAt: testRun.milestone.completedAt
                                ? new Date(testRun.milestone.completedAt)
                                : undefined,
                              isCompleted: testRun.milestone.isCompleted,
                              milestoneType: testRun.milestone.milestoneType,
                            }
                          : undefined,
                        projectId: testRun.projectId,
                        testCases: testCasesByTestRunId[testRun.id] || [],
                        createdBy: testRun.createdBy,
                        forecastManual: testRun.forecastManual,
                        forecastAutomated: testRun.forecastAutomated,
                      }}
                      onComplete={handleOpenDialogParam}
                      isAdmin={isAdminParam}
                      isNew={false}
                      onDuplicate={onDuplicateTestRunParam}
                    />
                  </div>
                )
              )}
            </div>
          )}

          {/* THEN render child milestones */}
          {milestone.children?.map((childMilestone) =>
            renderMilestoneWithTestRuns(childMilestone, depth + 1)
          )}
        </div>
      );
    };

    return (
      <>
        {currentGroupedRuns.unscheduled.length > 0 && (
          <div
            className="w-full bg-muted rounded-lg p-0 pb-2"
            key={JSON.stringify(currentGroupedRuns)}
          >
            {currentGroupedRuns.unscheduled.some(
              (testRun) => !testRun.isCompleted
            ) && (
              <div className="milestone-grid bg-primary/10 rounded-t-lg p-4">
                <div className="milestone-name flex items-center gap-1">
                  <DynamicIcon
                    name="calendar-off"
                    className="w-6 h-6 shrink-0"
                  />
                  <div className="truncate">{tSessions("noMilestone")}</div>
                </div>
                <div className="milestone-status"></div>
                <div className="milestone-dates flex justify-end">
                  {canAddEditRun && (
                    <AddTestRunModal
                      open={
                        isAddTestRunModalOpen && selectedMilestoneId === null
                      }
                      onOpenChange={(open) => {
                        setIsAddTestRunModalOpen(open);
                        if (!open) {
                          setModalSelectedTestCases([]);
                        }
                      }}
                      initialSelectedCaseIds={modalSelectedTestCases}
                      onSelectedCasesChange={setModalSelectedTestCases}
                      trigger={
                        <Button size="lg" className="gap-2">
                          <CirclePlus className="h-5 w-5" />
                          {tCommon("actions.create")}
                        </Button>
                      }
                    />
                  )}
                </div>
              </div>
            )}
            {currentGroupedRuns.unscheduled.map((testRun) => (
              <div key={testRun.id} className="pl-4 pr-4">
                <TestRunItem
                  testRun={{
                    id: testRun.id,
                    name: testRun.name,
                    isCompleted: testRun.isCompleted,
                    testRunType: testRun.testRunType,
                    configuration: testRun.configuration,
                    configurationGroupId: testRun.configurationGroupId,
                    state: testRun.state,
                    note:
                      typeof testRun.note === "string"
                        ? testRun.note
                        : testRun.note
                          ? JSON.stringify(testRun.note)
                          : undefined,
                    completedAt: testRun.completedAt
                      ? new Date(testRun.completedAt)
                      : undefined,
                    milestone: testRun.milestone
                      ? {
                          id: testRun.milestone.id,
                          name: testRun.milestone.name,
                          startedAt: testRun.milestone.startedAt
                            ? new Date(testRun.milestone.startedAt)
                            : undefined,
                          completedAt: testRun.milestone.completedAt
                            ? new Date(testRun.milestone.completedAt)
                            : undefined,
                          isCompleted: testRun.milestone.isCompleted,
                          milestoneType: testRun.milestone.milestoneType,
                        }
                      : undefined,
                    projectId: testRun.projectId,
                    testCases: testCasesByTestRunId[testRun.id] || [],
                    createdBy: testRun.createdBy,
                    forecastManual: testRun.forecastManual,
                    forecastAutomated: testRun.forecastAutomated,
                  }}
                  onComplete={handleOpenDialogParam}
                  isAdmin={isAdminParam}
                  isNew={false}
                  onDuplicate={onDuplicateTestRunParam}
                />
              </div>
            ))}
          </div>
        )}
        <div className="rounded-b-lg mb-4"></div>

        {currentMilestoneTree.map((milestone) =>
          renderMilestoneWithTestRuns(milestone, 0)
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full relative">
        <div className="flex flex-col w-full">
          {renderGroupedTestRuns(
            groupedTestRunData,
            sortedMilestoneTree,
            handleOpenDialog,
            isAdmin,
            onDuplicateTestRun
          )}
        </div>
      </div>

      {selectedTestRun && (
        <CompleteTestRunDialog
          trigger={
            <Button variant="outline" size="sm">
              {tCommon("actions.complete")}
            </Button>
          }
          testRunId={selectedTestRun.id}
          projectId={selectedTestRun.projectId}
          stateId={selectedTestRun.state.id}
          stateName={selectedTestRun.state.name}
        />
      )}
    </div>
  );
};

export default TestRunDisplay;
