import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { Loading } from "@/components/Loading";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { MilestoneSourceBadge } from "@/components/MilestoneSourceBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { MilestoneGroupChevron } from "@/components/MilestoneGroupChevron";
import type {
  MilestonesGetPayload,
  TestRunsGetPayload,
} from "~/zenstack/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjectTestRunStream } from "~/hooks/useTestRunLiveStream";
import { useCoalescedWakeUp } from "~/hooks/useCoalescedWakeUp";
import { testRunCasesQueryMatchesRuns } from "./wakeUpInvalidation";
import {
  CheckCircle,
  CirclePlus,
  GripVertical,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import type { BatchTestRunSummaryResponse } from "~/app/api/test-runs/summaries/route";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import type { PendingReviewSummary } from "@/components/reviews/PendingReviewBadge";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { ItemTypes } from "~/types/dndTypes";
import { cn } from "~/utils";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import {
  ColorMap,
  createColorMap,
  getStatus,
  getStatusStyle,
  MilestonesWithTypes,
  sortMilestones,
} from "~/utils/milestoneUtils";
import { BulkActionBar } from "@/components/bulk/BulkActionBar";
import { VirtualizedCardList } from "@/components/VirtualizedCardList";
import { transformMilestones } from "@/components/forms/MilestoneSelect";
import type { OverflowAction } from "@/components/ui/action-bar";
import AddTestRunModal from "./AddTestRunModal";
import BulkCompleteTestRunsDialog from "./BulkCompleteTestRunsDialog";
import BulkDeleteTestRunsDialog from "./BulkDeleteTestRunsDialog";
import BulkEditTestRunsDialog from "./BulkEditTestRunsDialog";
import {
  collapsedStorageKey,
  collectRenderedMilestoneKeys,
  countRunsInSubtree,
  parseStoredCollapsedGroups,
  UNSCHEDULED_GROUP_KEY,
} from "./milestoneGroups";
import TestRunItem from "./TestRunItem";

const _testRunPropSelect = {
  id: true,
  name: true,
  isCompleted: true,
  testRunType: true,
  completedAt: true,
  compositionLockedAt: true,
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
  // testCases, tags, issues, and results are fetched separately to avoid N+1 queries
} as const;

export type TestRunsWithDetails = TestRunsGetPayload<{
  select: typeof _testRunPropSelect;
}>;

const _milestonesPropInclude = {
  milestoneType: { include: { icon: true } },
  children: {
    include: {
      milestoneType: { include: { icon: true } },
    },
  },
} as const;

export type MilestonePropItem = MilestonesGetPayload<{
  include: typeof _milestonesPropInclude;
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

// Drag-and-drop item type for test runs
interface DraggedTestRun {
  type: typeof ItemTypes.TEST_RUN;
  id: number;
  name: string;
  currentMilestoneId: number | null;
}

// Draggable wrapper for test run items
interface DraggableTestRunWrapperProps {
  testRunId: number;
  testRunName: string;
  currentMilestoneId: number | null;
  canDrag: boolean;
  children: React.ReactNode;
}

const DraggableTestRunWrapper: React.FC<DraggableTestRunWrapperProps> = ({
  testRunId,
  testRunName,
  currentMilestoneId,
  canDrag,
  children,
}) => {
  const [{ isDragging }, drag, preview] = useDrag(
    () => ({
      type: ItemTypes.TEST_RUN,
      item: {
        type: ItemTypes.TEST_RUN,
        id: testRunId,
        name: testRunName,
        currentMilestoneId,
      } as DraggedTestRun,
      canDrag: () => canDrag,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [testRunId, testRunName, currentMilestoneId, canDrag]
  );

  return (
    <div
      ref={(node) => {
        preview(node);
      }}
      className={cn("relative group", isDragging && "opacity-50")}
    >
      {canDrag && (
        <div
          ref={(node) => {
            drag(node);
          }}
          className="absolute -start-4 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-10"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      {children}
    </div>
  );
};

// Droppable wrapper for milestone groups
interface DroppableMilestoneGroupProps {
  milestoneId: number | null; // null for unscheduled
  milestoneName: string;
  onDropTestRun: (testRunId: number, targetMilestoneId: number | null) => void;
  children: React.ReactNode;
  className?: string;
}

const DroppableMilestoneGroup: React.FC<DroppableMilestoneGroupProps> = ({
  milestoneId,
  milestoneName: _milestoneName,
  onDropTestRun,
  children,
  className,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ItemTypes.TEST_RUN,
      canDrop: (item: DraggedTestRun) => {
        // Can drop if moving to a different milestone
        return item.currentMilestoneId !== milestoneId;
      },
      drop: (item: DraggedTestRun) => {
        onDropTestRun(item.id, milestoneId);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [milestoneId, onDropTestRun]
  );

  return (
    <div
      ref={(node) => {
        drop(node);
      }}
      className={cn(
        className,
        isOver && canDrop && "ring-2 ring-primary ring-inset bg-primary/5",
        isOver && !canDrop && "ring-2 ring-muted-foreground/30 ring-inset"
      )}
    >
      {children}
    </div>
  );
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

const _findMilestonePath = (
  milestone: MilestonesWithTypes,
  targetMilestoneId: number,
  path: MilestonesWithTypes[] = []
): MilestonesWithTypes[] | null => {
  if (milestone.id === targetMilestoneId) {
    return [...path, milestone];
  }

  for (const child of milestone.children) {
    const result = _findMilestonePath(child, targetMilestoneId, [
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
  const { resolvedTheme } = useTheme();
  const { data: colors, isLoading: isColorsLoading } = useClientQueries(
    schema
  ).color.useFindMany({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const numericProjectId = parseInt(projectId as string, 10);
  const { permissions: testRunPermissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId, "TestRuns");
  const canAddEditRun = testRunPermissions?.canAddEdit ?? false;
  const canCloseRun = testRunPermissions?.canClose ?? false;
  const canDeleteRun = testRunPermissions?.canDelete ?? false;
  const bulkSelectable = canAddEditRun || canCloseRun || canDeleteRun;

  // Mutation for updating test run milestone
  const queryClient = useQueryClient();
  const updateTestRunMutation = useClientQueries(schema).testRuns.useUpdate();

  const handleDropTestRun = useCallback(
    async (testRunId: number, targetMilestoneId: number | null) => {
      try {
        await updateTestRunMutation.mutateAsync({
          where: { id: testRunId },
          data: { milestoneId: targetMilestoneId },
        });
        // Invalidate test runs query to refresh the data
        void queryClient.invalidateQueries({ queryKey: ["testRuns"] });
      } catch (error) {
        console.error("Failed to update test run milestone:", error);
      }
    },
    [updateTestRunMutation, queryClient]
  );

  const [selectedMilestoneId, setSelectedMilestoneId] = useState<number | null>(
    null
  );
  const [isAddTestRunModalOpen, setIsAddTestRunModalOpen] = useState(false);
  const [colorMap, setColorMap] = useState<ColorMap | null>(null);
  const [, setNewTestRunId] = useState<number | null>(null);
  const [modalSelectedTestCases, setModalSelectedTestCases] = useState<
    number[]
  >([]);

  const testRunIds = useMemo(() => testRuns.map((run) => run.id), [testRuns]);

  // Bulk-fetch PENDING ReviewRequests for the visible page (D-06; one round
  // trip per page render — never per-row, per RESEARCH §"Pitfall 6").
  const { enabled: reviewFeatureEnabled } =
    useReviewFeatureEnabled(numericProjectId);
  const { data: pendingReviewsForVisibleRuns } = useClientQueries(
    schema
  ).reviewRequest.useFindMany(
    {
      where: {
        entityType: "RUN",
        entityId: { in: testRunIds },
        status: "PENDING",
        isDeleted: false,
      },
      select: {
        id: true,
        status: true,
        entityId: true,
        assigneeUserId: true,
        assigneeRoleId: true,
        assigneeUser: { select: { name: true } },
        assigneeRole: { select: { name: true } },
      },
    } as any,
    {
      enabled: reviewFeatureEnabled === true && testRunIds.length > 0,
    } as any
  );
  const pendingByTestRunId = useMemo(() => {
    const map = new Map<number, PendingReviewSummary>();
    const rows = pendingReviewsForVisibleRuns as
      Array<PendingReviewSummary & { entityId: number }> | undefined;
    rows?.forEach((row) => {
      map.set(row.entityId, row);
    });
    return map;
  }, [pendingReviewsForVisibleRuns]);

  // Batch-fetch test run summaries for all test runs
  const { data: batchSummaries, isLoading: isBatchSummariesLoading } =
    useQuery<BatchTestRunSummaryResponse>({
      queryKey: ["batchTestRunSummaries", testRunIds],
      queryFn: async () => {
        if (testRunIds.length === 0) {
          return { summaries: {} };
        }
        const response = await fetch(
          `/api/test-runs/summaries?testRunIds=${testRunIds.join(",")}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch batch test run summaries");
        }
        return response.json();
      },
      enabled: testRunIds.length > 0,
      staleTime: 30000, // Cache for 30 seconds
    });

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

  // SSE wake-up for every in-progress run on this list page via a single
  // project-level stream. One EventSource covers every run in the project;
  // publishers fan each wake-up out to both the per-run and per-project
  // channels server-side, so the detail page (per-run consumer) and this
  // page (per-project consumer) each see exactly one connection. The
  // earlier per-run plural hook saturated browsers' HTTP/1.1 6-connection-
  // per-origin cap on projects with many in-progress runs and made the
  // page itself unloadable.
  //
  // Each wake-up invalidates four query trees so every visible piece of
  // the tile reflects the new state:
  //   - batchTestRunSummaries: per-tile aggregated counts and completion bar
  //   - zenstack/TestRuns:     run name, workflow state, isCompleted, etc.
  //                            (read via useFindManyTestRuns at page level)
  //   - zenstack/TestRunCases: each tile's per-case status (read inside
  //                            TestRunItem via useClientQueries(schema).testRunCases.useFindMany)
  //   - zenstack/ReviewRequest: the pendingRequest sidebars on each tile
  // The "zenstack" prefix is required because @zenstackhq/tanstack-query
  // stamps every generated hook's query key with it (see runtime-v5/react.js
  // getQueryKey -> [QUERY_KEY_PREFIX, model, operation, args, options]).
  // Invalidating ["TestRuns"] alone would silently no-op against those
  // hooks.
  //
  // Three of those trees hold one query per page; TestRunCases holds one per
  // mounted tile, so it is the only one where a bare prefix turns a
  // single-run change into a refetch per tile. It is narrowed below.
  //
  // The stream stays dormant when no run on this page is in progress —
  // nothing live to update — matching the detail page's gating on
  // !testRunData?.isCompleted.
  const onWakeUpFlush = useCallback(
    (runIds: ReadonlySet<number | null>) => {
      // Bare prefix on purpose: the page's AutomationRunsCard keys its
      // summaries query on its own id subset, so invalidating only this
      // list's exact key would leave the card stale.
      void queryClient.invalidateQueries({
        queryKey: ["batchTestRunSummaries"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRuns"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "ReviewRequest"],
      });

      // A wake-up with no run id can't be attributed, so fall back to the
      // whole tree rather than silently leaving a tile stale.
      if (runIds.has(null)) {
        void queryClient.invalidateQueries({
          queryKey: ["zenstack", "TestRunCases"],
        });
        return;
      }
      // The run id can't be pushed into the query key — it lives inside the
      // key's `args` slot, past where prefix matching reaches. A predicate
      // ANDs with the prefix and can read it; see wakeUpInvalidation.ts.
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRunCases"],
        predicate: (query) =>
          testRunCasesQueryMatchesRuns(query.queryKey, runIds),
      });
    },
    [queryClient]
  );
  const onLiveWakeUp = useCoalescedWakeUp(onWakeUpFlush);
  useProjectTestRunStream({
    projectId: !isNaN(numericProjectId) ? numericProjectId : null,
    enabled: incompleteTestRuns.length > 0,
    onWakeUp: onLiveWakeUp,
  });

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

  // Integrations backing the milestones on this page, so the source badges
  // below can resolve their Jira project ("space") segment. Fetched ONCE for
  // the whole list rather than per group header — same shape the milestones
  // list uses (MilestoneDisplay).
  const integrationIds = useMemo(() => {
    const ids = new Set<number>();
    for (const milestone of milestonesProp) {
      if (milestone.integrationId != null) ids.add(milestone.integrationId);
    }
    return Array.from(ids);
  }, [milestonesProp]);

  const { data: integrationProjects } = useClientQueries(
    schema
  ).integrationProject.useFindMany(
    {
      where: {
        isActive: true,
        projectIntegration: {
          projectId: numericProjectId,
          integrationId: { in: integrationIds },
        },
      },
      select: {
        externalProjectKey: true,
        externalProjectName: true,
        projectIntegration: { select: { integrationId: true } },
      },
    },
    { enabled: !isNaN(numericProjectId) && integrationIds.length > 0 }
  );

  // Collapsed milestone groups, remembered per project. Keys are milestone
  // ids as strings plus UNSCHEDULED_GROUP_KEY; absence means expanded, so a
  // brand-new group shows up open rather than inheriting a stale collapse.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set()
  );

  // Hydrated in an effect, not in the initializer: localStorage isn't
  // available during SSR and reading it inline would hydrate-mismatch.
  useEffect(() => {
    if (isNaN(numericProjectId)) return;
    try {
      setCollapsedGroups(
        parseStoredCollapsedGroups(
          window.localStorage.getItem(collapsedStorageKey(numericProjectId))
        )
      );
    } catch {
      // localStorage unavailable (private mode) — start fully expanded.
    }
  }, [numericProjectId]);

  const persistCollapsedGroups = useCallback(
    (next: Set<string>) => {
      if (isNaN(numericProjectId)) return;
      try {
        window.localStorage.setItem(
          collapsedStorageKey(numericProjectId),
          JSON.stringify(Array.from(next))
        );
      } catch {
        // Persistence is best-effort.
      }
    },
    [numericProjectId]
  );

  const setGroupOpen = useCallback(
    (groupKey: string, open: boolean) => {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        if (open) next.delete(groupKey);
        else next.add(groupKey);
        persistCollapsedGroups(next);
        return next;
      });
    },
    [persistCollapsedGroups]
  );

  // Every group key currently on screen — the alt-click expand/collapse-all
  // gesture reaches exactly these.
  const renderedGroupKeys = useMemo(() => {
    const keys: string[] = [];
    if (groupedTestRunData.unscheduled.length > 0) {
      keys.push(UNSCHEDULED_GROUP_KEY);
    }
    for (const milestone of sortedMilestoneTree) {
      keys.push(...collectRenderedMilestoneKeys(milestone, groupedTestRunData));
    }
    return keys;
  }, [groupedTestRunData, sortedMilestoneTree]);

  const setAllGroupsCollapsed = useCallback(
    (collapsed: boolean) => {
      const next = collapsed ? new Set(renderedGroupKeys) : new Set<string>();
      setCollapsedGroups(next);
      persistCollapsedGroups(next);
    },
    [renderedGroupKeys, persistCollapsedGroups]
  );

  const allRunsCompleted = useMemo(
    () => testRuns.every((run) => run.isCompleted),
    [testRuns]
  );

  // --- Bulk selection state ---
  const [selectedRunIds, setSelectedRunIds] = useState<Set<number>>(
    () => new Set()
  );
  const [bulkDialog, setBulkDialog] = useState<
    "edit" | "complete" | "delete" | null
  >(null);

  // Prune selections that no longer exist in the list (deleted, completed
  // away from this tab, filtered out) so bulk actions can't touch invisible
  // rows.
  useEffect(() => {
    setSelectedRunIds((prev) => {
      const valid = new Set(testRuns.map((run) => run.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [testRuns]);

  const toggleRunSelected = useCallback((id: number, checked: boolean) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const clearRunSelection = useCallback(() => setSelectedRunIds(new Set()), []);

  const selectedRuns = useMemo(
    () => testRuns.filter((run) => selectedRunIds.has(run.id)),
    [testRuns, selectedRunIds]
  );
  // Mirrors the single-item gating: field edits exclude completed and
  // automated runs, complete excludes completed, delete applies to any.
  const editEligibleIds = useMemo(
    () =>
      selectedRuns
        .filter(
          (run) => !run.isCompleted && !isAutomatedTestRunType(run.testRunType)
        )
        .map((run) => run.id),
    [selectedRuns]
  );
  const completeEligibleIds = useMemo(
    () => selectedRuns.filter((run) => !run.isCompleted).map((run) => run.id),
    [selectedRuns]
  );
  const deleteEligibleIds = useMemo(
    () => selectedRuns.map((run) => run.id),
    [selectedRuns]
  );

  const milestoneOptions = useMemo(
    () => transformMilestones(milestonesProp),
    [milestonesProp]
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

  const handleAddTestRun = (milestoneId: number | null) => {
    setSelectedMilestoneId(milestoneId);
    setIsAddTestRunModalOpen(true);
  };

  if (isColorsLoading || isLoadingPermissions || !colorMap) return <Loading />;
  if (!testRuns || testRuns.length === 0) return null;

  const bulkActions: OverflowAction[] = [
    {
      key: "edit",
      icon: SquarePen,
      label: tCommon("bulk.editAction", { count: editEligibleIds.length }),
      onClick: () => setBulkDialog("edit"),
      disabled: editEligibleIds.length === 0,
      hidden: !canAddEditRun,
      testId: "testrun-bulk-edit",
    },
    {
      key: "complete",
      icon: CheckCircle,
      label: tCommon("bulk.completeAction", {
        count: completeEligibleIds.length,
      }),
      onClick: () => setBulkDialog("complete"),
      disabled: completeEligibleIds.length === 0,
      hidden: !canCloseRun,
      testId: "testrun-bulk-complete",
    },
    {
      key: "delete",
      icon: Trash2,
      label: tCommon("bulk.deleteAction", { count: deleteEligibleIds.length }),
      onClick: () => setBulkDialog("delete"),
      disabled: deleteEligibleIds.length === 0,
      hidden: !canDeleteRun,
      destructive: true,
      testId: "testrun-bulk-delete",
    },
  ];

  const bulkBar = bulkSelectable ? (
    <BulkActionBar
      selectedCount={selectedRunIds.size}
      onClearSelection={clearRunSelection}
      actions={bulkActions}
      testIdPrefix="testrun"
    />
  ) : null;

  const bulkDialogs = (
    <>
      {bulkDialog === "edit" && (
        <BulkEditTestRunsDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          testRunIds={editEligibleIds}
          projectId={numericProjectId}
          milestoneOptions={milestoneOptions}
          onDone={clearRunSelection}
        />
      )}
      {bulkDialog === "complete" && (
        <BulkCompleteTestRunsDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          testRunIds={completeEligibleIds}
          projectId={numericProjectId}
          onDone={clearRunSelection}
        />
      )}
      {bulkDialog === "delete" && (
        <BulkDeleteTestRunsDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          testRunIds={deleteEligibleIds}
          onDone={clearRunSelection}
        />
      )}
    </>
  );

  if (allRunsCompleted) {
    const sortedCompletedTestRuns = [...testRuns].sort((a, b) => {
      return (
        new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
      );
    });
    return (
      <div className="flex flex-col items-center w-full">
        <div className="w-full">
          {bulkBar}
          {/* space-y-0: the rows carry their own my-2, so the list's default
              vertical rhythm would double the gap. */}
          <VirtualizedCardList
            items={sortedCompletedTestRuns}
            getKey={(testRun) => testRun.id}
            className="space-y-0"
            data-testid="completed-test-runs-list"
            renderItem={(testRun) => (
              <TestRunItem
                selectable={bulkSelectable}
                selected={selectedRunIds.has(testRun.id)}
                onSelectedChange={(checked) =>
                  toggleRunSelected(testRun.id, checked)
                }
                testRun={testRun}
                onDuplicate={onDuplicateTestRun}
                summaryData={batchSummaries?.summaries[testRun.id]}
                summaryLoading={isBatchSummariesLoading}
                pendingRequest={pendingByTestRunId.get(testRun.id)}
                // Completed runs render as a flat list (not grouped by
                // milestone), so the milestone is shown here — unlike the
                // active tab's grouped view, where it would be redundant.
                showMilestone={true}
              />
            )}
          />
        </div>
        {bulkDialogs}
      </div>
    );
  }

  const renderGroupedTestRuns = (
    currentGroupedRuns: GroupedTestRuns,
    currentMilestoneTree: MilestonesWithTypes[],
    onDuplicateTestRunParam?: (run: { id: number; name: string }) => void,
    summariesData?: BatchTestRunSummaryResponse
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
      const { badge } = getStatusStyle(
        status,
        resolvedTheme || "light",
        colorMap
      );

      // Check if there are test runs under this milestone
      const hasTestRunsUnderMilestone =
        currentGroupedRuns.milestones[milestone.id]?.testRuns.length > 0;

      const groupKey = String(milestone.id);
      const isOpen = !collapsedGroups.has(groupKey);
      const subtreeRunCount = countRunsInSubtree(milestone, currentGroupedRuns);

      return (
        <DroppableMilestoneGroup
          key={milestone.id}
          milestoneId={milestone.id}
          milestoneName={milestone.name}
          onDropTestRun={handleDropTestRun}
          className={
            depth > 0
              ? "w-full ps-4 bg-muted rounded-lg mb-4"
              : "w-full rounded-lg bg-muted mb-4"
          }
        >
          {/* Collapsing a milestone hides its runs AND its child milestone
              groups — they live inside this CollapsibleContent, which is what
              keeps the nesting readable when a deep tree is folded away. The
              header itself stays put, so the group remains a drop target. */}
          <Collapsible
            open={isOpen}
            onOpenChange={(open) => setGroupOpen(groupKey, open)}
          >
            <div
              className={`@container milestone-grid bg-primary/10 p-2 pe-4 ${
                depth === 0 ? "rounded-t-lg" : ""
              }`}
            >
              {/* Milestone Name */}
              <div className="flex items-center gap-1 justify-start min-w-0">
                {depth > 0 && (
                  <DynamicIcon
                    name="corner-down-right"
                    className="w-6 h-6 text-primary/50 shrink-0 bg-transparent"
                  />
                )}
                {/* Only the chevron toggles: the header also holds the
                    milestone link and the Add Run button, so a whole-row
                    trigger would swallow both. */}
                <MilestoneGroupChevron
                  isOpen={isOpen}
                  testId={`milestone-group-toggle-${milestone.id}`}
                  onClick={(e) => {
                    if (e.altKey) setAllGroupsCollapsed(isOpen);
                    else setGroupOpen(groupKey, !isOpen);
                  }}
                />
                <div className="truncate min-w-0">
                  <MilestoneIconAndName
                    collapsibleIcon
                    milestone={milestone}
                    // The full source badge renders right beside this — no
                    // duplicate glyph inside the name.
                    showSourceIcon={false}
                  />
                </div>
                <MilestoneSourceBadge
                  milestone={milestone}
                  projectId={numericProjectId}
                  integrationProjects={integrationProjects}
                  // This page groups BY milestone but doesn't manage them;
                  // unlinking stays on the milestones pages.
                  showUnlinkAction={false}
                />
                <Badge
                  variant="outline"
                  className="shrink-0 hidden @lg:inline-flex text-xs font-normal text-muted-foreground"
                  data-testid={`milestone-group-count-${milestone.id}`}
                >
                  {t("milestoneGroup.runCount", { count: subtreeRunCount })}
                </Badge>
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
                    <>
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
                      {isAddTestRunModalOpen &&
                        selectedMilestoneId === milestone.id && (
                          <AddTestRunModal
                            defaultMilestoneId={milestone.id}
                            open={isAddTestRunModalOpen}
                            onClose={() => {
                              setIsAddTestRunModalOpen(false);
                              setModalSelectedTestCases([]);
                              setSelectedMilestoneId(null);
                            }}
                            initialSelectedCaseIds={modalSelectedTestCases}
                            onSelectedCasesChange={setModalSelectedTestCases}
                          />
                        )}
                    </>
                  )}
                  <DateTextDisplay
                    responsive
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

            {/* overflow-hidden is what the height keyframes clip against;
                without it the rows spill out at full height for the whole
                animation instead of being wiped. */}
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slide-up data-[state=open]:animate-slide-down">
              {/* Render test runs under this milestone FIRST */}
              {hasTestRunsUnderMilestone && (
                <div className="test-runs-container bg-muted pe-4 pb-2 mb-2">
                  {/* space-y-0: the rows carry their own my-2, so the list's
                      default vertical rhythm would double the gap. */}
                  <VirtualizedCardList
                    items={
                      currentGroupedRuns.milestones[milestone.id]?.testRuns ??
                      []
                    }
                    getKey={(testRun) => testRun.id}
                    className="space-y-0"
                    data-testid={`milestone-test-runs-list-${milestone.id}`}
                    renderItem={(testRun) => (
                      <div style={{ paddingInlineStart: "2.5rem" }}>
                        <DraggableTestRunWrapper
                          testRunId={testRun.id}
                          testRunName={testRun.name}
                          currentMilestoneId={testRun.milestoneId}
                          canDrag={canAddEditRun && !testRun.isCompleted}
                        >
                          <TestRunItem
                            selectable={bulkSelectable}
                            selected={selectedRunIds.has(testRun.id)}
                            onSelectedChange={(checked) =>
                              toggleRunSelected(testRun.id, checked)
                            }
                            testRun={testRun}
                            isNew={false}
                            onDuplicate={onDuplicateTestRunParam}
                            summaryData={summariesData?.summaries[testRun.id]}
                            summaryLoading={isBatchSummariesLoading}
                            pendingRequest={pendingByTestRunId.get(testRun.id)}
                            showMilestone={false}
                          />
                        </DraggableTestRunWrapper>
                      </div>
                    )}
                  />
                </div>
              )}

              {/* THEN render child milestones */}
              {milestone.children?.map((childMilestone) =>
                renderMilestoneWithTestRuns(childMilestone, depth + 1)
              )}
            </CollapsibleContent>
          </Collapsible>
        </DroppableMilestoneGroup>
      );
    };

    // No header means no chevron to reopen with, so the group has to stay
    // expanded in that (runs-all-completed) case regardless of stored state.
    const showUnscheduledHeader = currentGroupedRuns.unscheduled.some(
      (testRun) => !testRun.isCompleted
    );
    const isUnscheduledOpen =
      !showUnscheduledHeader || !collapsedGroups.has(UNSCHEDULED_GROUP_KEY);

    return (
      <>
        {currentGroupedRuns.unscheduled.length > 0 && (
          <DroppableMilestoneGroup
            milestoneId={null}
            milestoneName={tSessions("noMilestone")}
            onDropTestRun={handleDropTestRun}
            className="w-full bg-muted rounded-lg p-0 pb-2"
          >
            <Collapsible
              open={isUnscheduledOpen}
              onOpenChange={(open) => setGroupOpen(UNSCHEDULED_GROUP_KEY, open)}
            >
              {showUnscheduledHeader && (
                <div className="@container milestone-grid bg-primary/10 rounded-t-lg p-4">
                  <div className="milestone-name flex items-center gap-1">
                    <MilestoneGroupChevron
                      isOpen={isUnscheduledOpen}
                      testId="milestone-group-toggle-unscheduled"
                      onClick={(e) => {
                        if (e.altKey) setAllGroupsCollapsed(isUnscheduledOpen);
                        else
                          setGroupOpen(
                            UNSCHEDULED_GROUP_KEY,
                            !isUnscheduledOpen
                          );
                      }}
                    />
                    <DynamicIcon
                      name="calendar-off"
                      className="w-6 h-6 shrink-0"
                    />
                    <div className="truncate">{tSessions("noMilestone")}</div>
                    <Badge
                      variant="outline"
                      className="shrink-0 hidden @lg:inline-flex text-xs font-normal text-muted-foreground"
                      data-testid="milestone-group-count-unscheduled"
                    >
                      {t("milestoneGroup.runCount", {
                        count: currentGroupedRuns.unscheduled.length,
                      })}
                    </Badge>
                  </div>
                  <div className="milestone-status"></div>
                  <div className="milestone-dates flex justify-end">
                    {canAddEditRun && (
                      <>
                        <Button
                          onClick={() => handleAddTestRun(null)}
                          aria-label={t("add.title")}
                          className="group gap-0 transition-all duration-200 hover:gap-2"
                        >
                          <CirclePlus className="h-4 w-4" />
                          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                            {t("add.title")}
                          </span>
                        </Button>
                        {isAddTestRunModalOpen &&
                          selectedMilestoneId === null && (
                            <AddTestRunModal
                              open={isAddTestRunModalOpen}
                              onClose={() => {
                                setIsAddTestRunModalOpen(false);
                                setModalSelectedTestCases([]);
                              }}
                              initialSelectedCaseIds={modalSelectedTestCases}
                              onSelectedCasesChange={setModalSelectedTestCases}
                            />
                          )}
                      </>
                    )}
                  </div>
                </div>
              )}
              {/* overflow-hidden is what the height keyframes clip against;
                without it the rows spill out at full height for the whole
                animation instead of being wiped. */}
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-slide-up data-[state=open]:animate-slide-down">
                {/* space-y-0: the rows carry their own my-2, so the list's
                    default vertical rhythm would double the gap. */}
                <VirtualizedCardList
                  items={currentGroupedRuns.unscheduled}
                  getKey={(testRun) => testRun.id}
                  className="space-y-0"
                  data-testid="unscheduled-test-runs-list"
                  renderItem={(testRun) => (
                    <div className="ps-4 pe-4">
                      <DraggableTestRunWrapper
                        testRunId={testRun.id}
                        testRunName={testRun.name}
                        currentMilestoneId={testRun.milestoneId}
                        canDrag={canAddEditRun && !testRun.isCompleted}
                      >
                        <TestRunItem
                          selectable={bulkSelectable}
                          selected={selectedRunIds.has(testRun.id)}
                          onSelectedChange={(checked) =>
                            toggleRunSelected(testRun.id, checked)
                          }
                          testRun={testRun}
                          isNew={false}
                          onDuplicate={onDuplicateTestRunParam}
                          summaryData={summariesData?.summaries[testRun.id]}
                          summaryLoading={isBatchSummariesLoading}
                          pendingRequest={pendingByTestRunId.get(testRun.id)}
                        />
                      </DraggableTestRunWrapper>
                    </div>
                  )}
                />
              </CollapsibleContent>
            </Collapsible>
          </DroppableMilestoneGroup>
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
          {bulkBar}
          {renderGroupedTestRuns(
            groupedTestRunData,
            sortedMilestoneTree,
            onDuplicateTestRun,
            batchSummaries
          )}
        </div>
      </div>

      {bulkDialogs}
    </div>
  );
};

export default TestRunDisplay;
