import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { Loading } from "@/components/Loading";
import { MilestoneGroupChevron } from "@/components/MilestoneGroupChevron";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  Color,
  Configurations,
  FieldIcon,
  Sessions,
  Templates,
  User,
  Workflows,
} from "~/zenstack/models";
import { CheckCircle, CirclePlus, SquarePen, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PendingReviewSummary } from "@/components/reviews/PendingReviewBadge";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { BulkActionBar } from "@/components/bulk/BulkActionBar";
import { transformMilestones } from "@/components/forms/MilestoneSelect";
import type { OverflowAction } from "@/components/ui/action-bar";
import {
  ColorMap,
  createColorMap,
  getStatus,
  getStatusStyle,
  MilestonesWithTypes,
  sortMilestones,
} from "~/utils/milestoneUtils";
import {
  AddSessionModal,
  type SessionDuplicationPreset,
} from "./AddSessionModal";
import BulkCompleteSessionsDialog from "./BulkCompleteSessionsDialog";
import BulkDeleteSessionsDialog from "./BulkDeleteSessionsDialog";
import BulkEditSessionsDialog from "./BulkEditSessionsDialog";
import {
  buildSessionListRows,
  collapsedStorageKey,
  collectRenderedMilestoneKeys,
  parseStoredCollapsedGroups,
  type SessionListRow,
  UNSCHEDULED_GROUP_KEY,
} from "./milestoneGroups";
import SessionItem from "./SessionItem";
import { WindowVirtualizedList } from "@/components/WindowVirtualizedList";
import { CompleteSessionDialog } from "./[sessionId]/CompleteSessionDialog";

export type SessionsWithDetails = Sessions & {
  template: Templates;
  configuration: Configurations | null;
  state: Workflows & {
    icon: FieldIcon;
    color: Color;
  };
  assignedTo: User | null;
  createdBy: User;
  milestoneId?: number | null;
  milestone?: {
    id: number;
    name: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    isCompleted?: boolean;
    milestoneType: {
      id: number;
      name: string;
      icon: FieldIcon | null;
    };
    children: {
      id: number;
      name: string;
      milestoneType: {
        id: number;
        name: string;
      };
    }[];
  } | null;
  project: {
    name: string;
  };
  issues?: { id: number; name: string; externalId?: string | null }[];
};

interface SessionDisplayProps {
  testSessions: SessionsWithDetails[];
  milestones: MilestonesWithTypes[];
  canAddEdit: boolean;
  canCloseSession: boolean;
}

type GroupedSessions = {
  unscheduled: SessionsWithDetails[];
  milestones: {
    [milestoneId: number]: {
      milestone: MilestonesWithTypes;
      testSessions: SessionsWithDetails[];
    };
  };
};

const buildMilestoneTree = (
  milestones: MilestonesWithTypes[]
): MilestonesWithTypes[] => {
  const milestoneMap: { [key: number]: MilestonesWithTypes } = {};
  const rootMilestones: MilestonesWithTypes[] = [];

  milestones.forEach((milestone) => {
    milestoneMap[milestone.id] = { ...milestone, children: [] };
  });

  milestones.forEach((milestone) => {
    if (milestone.parentId) {
      milestoneMap[milestone.parentId].children.push(
        milestoneMap[milestone.id]
      );
    } else {
      rootMilestones.push(milestoneMap[milestone.id]);
    }
  });

  return rootMilestones;
};

const groupSessions = (
  testSessions: SessionsWithDetails[],
  milestones: MilestonesWithTypes[]
): GroupedSessions => {
  const grouped: GroupedSessions = {
    unscheduled: [],
    milestones: {},
  };

  const milestoneTree = buildMilestoneTree(milestones);

  const addSessionsToMilestone = (
    milestone: MilestonesWithTypes,
    testSessions: SessionsWithDetails[]
  ) => {
    if (!grouped.milestones[milestone.id]) {
      grouped.milestones[milestone.id] = {
        milestone,
        testSessions: [],
      };
    }

    testSessions.forEach((testSession) => {
      if (testSession.milestoneId === milestone.id) {
        grouped.milestones[milestone.id].testSessions.push(testSession);
      }
    });

    milestone.children.forEach((child) => {
      addSessionsToMilestone(child, testSessions);
    });
  };

  testSessions.forEach((testSession) => {
    if (!testSession.milestoneId) {
      grouped.unscheduled.push(testSession);
    }
  });

  milestoneTree.forEach((milestone) => {
    addSessionsToMilestone(milestone, testSessions);
  });

  // Remove milestone groups that have no testSessions
  Object.keys(grouped.milestones).forEach((milestoneId) => {
    const milestoneGroup = grouped.milestones[Number(milestoneId)];
    if (milestoneGroup.testSessions.length === 0) {
      delete grouped.milestones[Number(milestoneId)];
    }
  });

  // Sort unscheduled testSessions by createdAt date
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

interface _SessionItemProps {
  testSession: SessionsWithDetails;
  isCompleted: boolean;
  onComplete: (testSession: SessionsWithDetails) => void;
  canComplete: boolean;
  isNew: boolean;
}

const SessionDisplay: React.FC<SessionDisplayProps> = ({
  testSessions,
  milestones,
  canAddEdit,
  canCloseSession,
}) => {
  const { data: session } = useSession();
  const { resolvedTheme } = useTheme();
  const { data: colors, isLoading: isColorsLoading } = useClientQueries(
    schema
  ).color.useFindMany({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });
  const t = useTranslations("sessions");
  const tMilestones = useTranslations("milestones");
  const tCommon = useTranslations("common");
  const [colorMap, setColorMap] = useState<ColorMap | null>(null);
  const [selectedSession, setSelectedSession] =
    useState<SessionsWithDetails | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSessionId, setNewSessionId] = useState<number | null>(null);
  const [, setOpenMilestones] = useState<Record<number, boolean>>({});

  // Bulk-fetch PENDING ReviewRequests for the visible page (D-06; one round
  // trip per page render — never per-row, per RESEARCH §"Pitfall 6").
  const sessionProjectId = testSessions[0]?.projectId;
  const visibleSessionIds = useMemo(
    () => testSessions.map((s) => s.id),
    [testSessions]
  );
  const { enabled: reviewFeatureEnabled } =
    useReviewFeatureEnabled(sessionProjectId);
  const { data: pendingReviewsForVisibleSessions } = useClientQueries(
    schema
  ).reviewRequest.useFindMany(
    {
      where: {
        entityType: "SESSION",
        entityId: { in: visibleSessionIds },
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
      enabled: reviewFeatureEnabled === true && visibleSessionIds.length > 0,
    } as any
  );
  const pendingBySessionId = useMemo(() => {
    const map = new Map<number, PendingReviewSummary>();
    const rows = pendingReviewsForVisibleSessions as
      Array<PendingReviewSummary & { entityId: number }> | undefined;
    rows?.forEach((row) => {
      map.set(row.entityId, row);
    });
    return map;
  }, [pendingReviewsForVisibleSessions]);

  // --- Bulk selection state ---
  const numericProjectId = sessionProjectId ?? NaN;
  const { permissions: sessionPermissions } = useProjectPermissions(
    numericProjectId,
    "Sessions"
  );
  const canDeleteSession = sessionPermissions?.canDelete ?? false;
  const bulkSelectable = canAddEdit || canCloseSession || canDeleteSession;

  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<number>>(
    () => new Set()
  );
  const [bulkDialog, setBulkDialog] = useState<
    "edit" | "complete" | "delete" | null
  >(null);

  // Prune selections that no longer exist in the list so bulk actions can't
  // touch invisible rows.
  useEffect(() => {
    setSelectedSessionIds((prev) => {
      const valid = new Set(testSessions.map((s) => s.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [testSessions]);

  const toggleSessionSelected = useCallback((id: number, checked: boolean) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const clearSessionSelection = useCallback(
    () => setSelectedSessionIds(new Set()),
    []
  );

  const selectedSessionsList = useMemo(
    () => testSessions.filter((s) => selectedSessionIds.has(s.id)),
    [testSessions, selectedSessionIds]
  );
  // Field edits and completion exclude completed sessions (their fields are
  // frozen); delete applies to any selection.
  const editEligibleIds = useMemo(
    () => selectedSessionsList.filter((s) => !s.isCompleted).map((s) => s.id),
    [selectedSessionsList]
  );
  const completeEligibleSessions = useMemo(
    () => selectedSessionsList.filter((s) => !s.isCompleted),
    [selectedSessionsList]
  );
  const deleteEligibleIds = useMemo(
    () => selectedSessionsList.map((s) => s.id),
    [selectedSessionsList]
  );

  const milestoneOptions = useMemo(
    () => transformMilestones(milestones),
    [milestones]
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

  // Single AddSessionModal state (handles both add and duplicate)
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalMilestoneId, setAddModalMilestoneId] = useState<
    number | undefined
  >(undefined);
  const [duplicationPreset, setDuplicationPreset] =
    useState<SessionDuplicationPreset | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<{
    id: number;
    name: string;
  } | null>(null);

  // Fetch source session data when duplicateSource is set
  const { data: duplicateSessionData, isLoading: isDuplicateLoading } =
    useClientQueries(schema).sessions.useFindUnique(
      {
        where: { id: duplicateSource?.id ?? 0 },
        select: {
          name: true,
          configId: true,
          milestoneId: true,
          stateId: true,
          assignedToId: true,
          templateId: true,
          estimate: true,
          note: true,
          mission: true,
          configuration: { select: { id: true, name: true } },
          tags: { select: { id: true } },
          issues: { select: { id: true } },
        },
      },
      { enabled: !!duplicateSource }
    );

  const { data: duplicateFieldValues } = useClientQueries(
    schema
  ).sessionFieldValues.useFindMany(
    {
      where: { sessionId: duplicateSource?.id ?? 0 },
      select: { fieldId: true, value: true },
    },
    { enabled: !!duplicateSource }
  );

  // Auto-open AddSessionModal once data is fetched
  useEffect(() => {
    if (duplicateSource && duplicateSessionData && !isDuplicateLoading) {
      const preset: SessionDuplicationPreset = {
        originalSessionId: duplicateSource.id,
        originalName: duplicateSessionData.name || duplicateSource.name,
        originalConfigId: duplicateSessionData.configId,
        originalConfigName:
          (duplicateSessionData as any).configuration?.name || null,
        originalMilestoneId: duplicateSessionData.milestoneId,
        originalStateId: duplicateSessionData.stateId,
        originalAssignedToId: duplicateSessionData.assignedToId,
        originalTemplateId: duplicateSessionData.templateId,
        originalEstimate: duplicateSessionData.estimate,
        originalNote: duplicateSessionData.note,
        originalMission: duplicateSessionData.mission,
        originalTagIds:
          duplicateSessionData.tags?.map((t: { id: number }) => t.id) || [],
        originalIssueIds:
          duplicateSessionData.issues?.map((i: { id: number }) => i.id) || [],
        originalFieldValues:
          duplicateFieldValues?.map((fv: { fieldId: number; value: any }) => ({
            fieldId: fv.fieldId,
            value: fv.value,
          })) || [],
      };
      setDuplicationPreset(preset);
      setAddModalMilestoneId(undefined);
      setAddModalOpen(true);
    }
  }, [
    duplicateSource,
    duplicateSessionData,
    duplicateFieldValues,
    isDuplicateLoading,
  ]);

  useEffect(() => {
    if (colors) {
      const map = createColorMap(colors);
      setColorMap(map);
    }
  }, [colors]);

  useEffect(() => {
    const handleSessionCreated = (event: CustomEvent) => {
      setNewSessionId(event.detail);
      setTimeout(() => {
        const element = document.getElementById(`session-${event.detail}`);
        if (element) {
          element.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }, 100);
      setTimeout(() => setNewSessionId(null), 5000);
    };

    window.addEventListener(
      "sessionCreated",
      handleSessionCreated as EventListener
    );
    return () => {
      window.removeEventListener(
        "sessionCreated",
        handleSessionCreated as EventListener
      );
    };
  }, []);

  if (isColorsLoading || !colorMap) return <Loading />;
  if (testSessions?.length === 0) return null;

  const sortedSessions = testSessions.sort((a, b) => {
    if (a.isCompleted && b.isCompleted) {
      return (
        new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
      );
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  if (!session) return null;

  const handleOpenDialog = (testSession: SessionsWithDetails) => {
    setSelectedSession(testSession);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedSession(null);
  };

  const handleDuplicateSession = (session: { id: number; name: string }) => {
    setDuplicateSource(session);
  };

  const handleOpenAddModal = (milestoneId?: number) => {
    setDuplicationPreset(null);
    setDuplicateSource(null);
    setAddModalMilestoneId(milestoneId);
    setAddModalOpen(true);
  };

  const handleAddModalClose = () => {
    setAddModalOpen(false);
    setDuplicationPreset(null);
    setDuplicateSource(null);
    setAddModalMilestoneId(undefined);
  };

  const _toggleMilestone = (milestoneId: number) => {
    setOpenMilestones((prev) => ({
      ...prev,
      [milestoneId]: !prev[milestoneId],
    }));
  };

  // Group testSessions by milestone only for incomplete sessions
  const sortedMilestones = sortMilestones(milestones);
  const groupedSessions = groupSessions(sortedSessions, sortedMilestones);

  // Every group key currently on screen — the alt-click expand/collapse-all
  // gesture reaches exactly these.
  const renderedGroupKeys: string[] = [];
  if (groupedSessions.unscheduled.length > 0) {
    renderedGroupKeys.push(UNSCHEDULED_GROUP_KEY);
  }
  buildMilestoneTree(sortedMilestones).forEach((milestone) => {
    renderedGroupKeys.push(
      ...collectRenderedMilestoneKeys(milestone, groupedSessions)
    );
  });

  const setAllGroupsCollapsed = (collapsed: boolean) => {
    const next = collapsed ? new Set(renderedGroupKeys) : new Set<string>();
    setCollapsedGroups(next);
    persistCollapsedGroups(next);
  };

  const sessionListRows = buildSessionListRows<
    SessionsWithDetails,
    MilestonesWithTypes
  >({
    unscheduled: groupedSessions.unscheduled,
    grouped: groupedSessions,
    tree: buildMilestoneTree(sortedMilestones),
    collapsedGroups,
    // No header means no chevron to reopen with, so the group has to stay
    // expanded in that (sessions-all-completed) case regardless of stored state.
    showUnscheduledHeader: groupedSessions.unscheduled.some(
      (testSession) => !testSession.isCompleted
    ),
    getSessionId: (testSession) => testSession.id,
  });

  const renderSessionListRow = (
    row: SessionListRow<SessionsWithDetails, MilestonesWithTypes>
  ) => {
    // Nesting is carried by indentation rather than by nested containers —
    // the rows are siblings in one virtualizer, so there is nothing to nest in.
    const indent = { paddingInlineStart: `${row.depth}rem` };

    if (row.kind === "item") {
      const testSession = row.item;
      return (
        <div className="pe-4 ps-4" style={indent}>
          <SessionItem
            testSession={testSession}
            isCompleted={testSession.isCompleted}
            onComplete={handleOpenDialog}
            onDuplicate={handleDuplicateSession}
            canComplete={canCloseSession}
            canDuplicate={canAddEdit}
            isNew={newSessionId === testSession.id}
            // Only the unscheduled group leaves the milestone unsaid by its
            // own header, and its sessions are the ones at depth 0.
            showMilestone={row.depth === 0}
            pendingRequest={pendingBySessionId.get(testSession.id)}
            selectable={bulkSelectable}
            selected={selectedSessionIds.has(testSession.id)}
            onSelectedChange={(checked) =>
              toggleSessionSelected(testSession.id, checked)
            }
          />
        </div>
      );
    }

    if (row.kind === "unscheduled-header") {
      const isOpen = !collapsedGroups.has(UNSCHEDULED_GROUP_KEY);
      return (
        <div className="@container milestone-grid bg-primary/10 p-4">
          <div className="milestone-name flex items-center gap-1">
            <MilestoneGroupChevron
              isOpen={isOpen}
              testId="milestone-group-toggle-unscheduled"
              onClick={(e) => {
                if (e.altKey) setAllGroupsCollapsed(isOpen);
                else setGroupOpen(UNSCHEDULED_GROUP_KEY, !isOpen);
              }}
            />
            <DynamicIcon name="calendar-off" className="w-6 h-6 shrink-0" />
            <div className="truncate">{t("noMilestone")}</div>
            <Badge
              variant="outline"
              className="shrink-0 hidden @lg:inline-flex text-xs font-normal text-muted-foreground"
              data-testid="milestone-group-count-unscheduled"
            >
              {t("milestoneGroup.sessionCount", {
                count: groupedSessions.unscheduled.length,
              })}
            </Badge>
          </div>
          <div className="milestone-status"></div>
          <div className="milestone-dates flex justify-end">
            {canAddEdit && (
              <Button
                variant="default"
                onClick={() => handleOpenAddModal()}
                aria-label={t("actions.add")}
                className="group gap-0 transition-all duration-200 hover:gap-2"
              >
                <CirclePlus className="h-4 w-4" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                  {t("actions.add")}
                </span>
              </Button>
            )}
          </div>
        </div>
      );
    }

    const { milestone, subtreeItemCount } = row;
    const groupKey = String(milestone.id);
    const isOpen = !collapsedGroups.has(groupKey);
    const status = getStatus(milestone);
    const { badge } = getStatusStyle(
      status,
      resolvedTheme || "light",
      colorMap
    );

    return (
      <div
        className="@container milestone-grid bg-primary/10 p-2 pe-4"
        style={indent}
      >
        <div className="flex items-center gap-1 justify-start min-w-0">
          {row.depth > 0 && (
            <DynamicIcon
              name="corner-down-right"
              className="w-6 h-6 text-primary/50 shrink-0 bg-transparent"
            />
          )}
          {/* Only the chevron toggles: the header also holds the milestone
              link and the Add Session button, so a whole-row trigger would
              swallow both. */}
          <MilestoneGroupChevron
            isOpen={isOpen}
            testId={`milestone-group-toggle-${milestone.id}`}
            onClick={(e) => {
              if (e.altKey) setAllGroupsCollapsed(isOpen);
              else setGroupOpen(groupKey, !isOpen);
            }}
          />
          <div className="truncate min-w-0">
            <MilestoneIconAndName milestone={milestone} />
          </div>
          <Badge
            variant="outline"
            className="shrink-0 hidden @lg:inline-flex text-xs font-normal text-muted-foreground"
            data-testid={`milestone-group-count-${milestone.id}`}
          >
            {t("milestoneGroup.sessionCount", { count: subtreeItemCount })}
          </Badge>
        </div>

        <div className="milestone-status flex gap-2 justify-center">
          <Badge
            style={{ backgroundColor: badge }}
            className="text-secondary-background border-2 border-secondary-foreground text-sm"
          >
            {tMilestones(`statusLabels.${status}` as any)}
          </Badge>
        </div>

        <div className="milestone-dates flex justify-end">
          <div className="grow text-sm text-muted-foreground">
            {canAddEdit && (
              <Button
                variant="link"
                className="p-0"
                onClick={() => handleOpenAddModal(milestone.id)}
              >
                <CirclePlus className="h-4 w-4" />
                <span className="hidden md:inline">{tCommon("add")}</span>
              </Button>
            )}
            <DateTextDisplay
              responsive
              startDate={
                milestone.startedAt ? new Date(milestone.startedAt) : null
              }
              endDate={
                milestone.completedAt ? new Date(milestone.completedAt) : null
              }
              isCompleted={milestone.isCompleted}
            />
          </div>
        </div>
      </div>
    );
  };

  const displayMode =
    testSessions.length > 0 && testSessions[0].isCompleted
      ? "completed"
      : "active";

  const bulkActions: OverflowAction[] = [
    {
      key: "edit",
      icon: SquarePen,
      label: tCommon("bulk.editAction", { count: editEligibleIds.length }),
      onClick: () => setBulkDialog("edit"),
      disabled: editEligibleIds.length === 0,
      hidden: !canAddEdit,
      testId: "session-bulk-edit",
    },
    {
      key: "complete",
      icon: CheckCircle,
      label: tCommon("bulk.completeAction", {
        count: completeEligibleSessions.length,
      }),
      onClick: () => setBulkDialog("complete"),
      disabled: completeEligibleSessions.length === 0,
      hidden: !canCloseSession,
      testId: "session-bulk-complete",
    },
    {
      key: "delete",
      icon: Trash2,
      label: tCommon("bulk.deleteAction", { count: deleteEligibleIds.length }),
      onClick: () => setBulkDialog("delete"),
      disabled: deleteEligibleIds.length === 0,
      hidden: !canDeleteSession,
      destructive: true,
      testId: "session-bulk-delete",
    },
  ];

  const bulkBar = bulkSelectable ? (
    <BulkActionBar
      selectedCount={selectedSessionIds.size}
      onClearSelection={clearSessionSelection}
      actions={bulkActions}
      testIdPrefix="session"
    />
  ) : null;

  const bulkDialogs = (
    <>
      {bulkDialog === "edit" && sessionProjectId != null && (
        <BulkEditSessionsDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          sessionIds={editEligibleIds}
          projectId={sessionProjectId}
          milestoneOptions={milestoneOptions}
          onDone={clearSessionSelection}
        />
      )}
      {bulkDialog === "complete" && sessionProjectId != null && (
        <BulkCompleteSessionsDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          sessions={completeEligibleSessions}
          projectId={sessionProjectId}
          onDone={clearSessionSelection}
        />
      )}
      {bulkDialog === "delete" && (
        <BulkDeleteSessionsDialog
          open
          onOpenChange={(open) => !open && setBulkDialog(null)}
          sessionIds={deleteEligibleIds}
          onDone={clearSessionSelection}
        />
      )}
    </>
  );

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full">
        <div className="flex flex-col w-full">
          {bulkBar}
          {displayMode === "active" ? (
            <div className="w-full bg-muted rounded-lg pb-2">
              <WindowVirtualizedList
                items={sessionListRows}
                getKey={(row) => row.key}
                data-testid="session-list"
                renderItem={renderSessionListRow}
              />
            </div>
          ) : (
            // Flat, ungrouped list for the completed tab.
            <div className="mt-4">
              <WindowVirtualizedList
                items={sortedSessions}
                getKey={(testSession) => testSession.id}
                data-testid="completed-session-list"
                renderItem={(testSession) => (
                  <SessionItem
                    testSession={testSession}
                    isCompleted={testSession.isCompleted}
                    onComplete={handleOpenDialog}
                    onDuplicate={handleDuplicateSession}
                    canComplete={canCloseSession}
                    canDuplicate={canAddEdit}
                    isNew={newSessionId === testSession.id}
                    showMilestone={true}
                    pendingRequest={pendingBySessionId.get(testSession.id)}
                    selectable={bulkSelectable}
                    selected={selectedSessionIds.has(testSession.id)}
                    onSelectedChange={(checked) =>
                      toggleSessionSelected(testSession.id, checked)
                    }
                  />
                )}
              />
            </div>
          )}
        </div>
      </div>

      {bulkDialogs}
      {selectedSession && (
        <CompleteSessionDialog
          open={isDialogOpen}
          onOpenChange={handleCloseDialog}
          session={selectedSession}
          projectId={selectedSession.projectId}
        />
      )}

      {addModalOpen && (
        <AddSessionModal
          open={addModalOpen}
          onClose={handleAddModalClose}
          defaultMilestoneId={addModalMilestoneId}
          duplicationPreset={duplicationPreset}
        />
      )}
    </div>
  );
};

export default SessionDisplay;
