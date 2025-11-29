import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Sessions,
  Templates,
  Configurations,
  Workflows,
  User,
  Color,
  FieldIcon,
} from "@prisma/client";
import { useFindManyColor } from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import { CirclePlus } from "lucide-react";
import SessionItem from "./SessionItem";
import DynamicIcon from "@/components/DynamicIcon";
import { sortMilestones } from "~/utils/milestoneUtils";
import {
  getStatus,
  getCondition,
  getStatusStyle,
  createColorMap,
  ColorMap,
} from "~/utils/milestoneUtils";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { AddSessionModal } from "./AddSessionModal";
import { CompleteSessionDialog } from "./[sessionId]/CompleteSessionDialog";
import { MilestonesWithTypes } from "~/utils/milestoneUtils";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { useTranslations } from "next-intl";

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

interface SessionItemProps {
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
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
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
  const [openMilestones, setOpenMilestones] = useState<Record<number, boolean>>(
    {}
  );

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

  const dateFormat = session?.user?.preferences?.dateFormat || "MMM dd, yyyy";

  const handleOpenDialog = (testSession: SessionsWithDetails) => {
    setSelectedSession(testSession);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedSession(null);
  };

  const toggleMilestone = (milestoneId: number) => {
    setOpenMilestones((prev) => ({
      ...prev,
      [milestoneId]: !prev[milestoneId],
    }));
  };

  // Group testSessions by milestone only for incomplete sessions
  const sortedMilestones = sortMilestones(milestones);
  const groupedSessions = groupSessions(sortedSessions, sortedMilestones);

  const renderGroupedSessions = (
    groupedSessions: GroupedSessions,
    milestones: MilestonesWithTypes[],
    handleOpenDialog: (testSession: SessionsWithDetails) => void,
    dateFormat: string
  ) => {
    const milestoneTree = buildMilestoneTree(milestones);

    const hasSessions = (milestone: MilestonesWithTypes): boolean => {
      if (groupedSessions.milestones[milestone.id]?.testSessions.length > 0) {
        return true;
      }

      return milestone.children?.some(hasSessions) ?? false;
    };

    const renderMilestoneWithSessions = (
      milestone: MilestonesWithTypes,
      depth: number = 0,
      dateFormat: string
    ) => {
      if (!hasSessions(milestone)) return null;

      const status = getStatus(milestone);
      const condition = getCondition(milestone);
      const { badge } = getStatusStyle(status, "light", colorMap);

      // Check if there are sessions under this milestone
      const hasSessionsUnderMilestone =
        groupedSessions.milestones[milestone.id]?.testSessions.length > 0;

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
            className={`milestone-grid bg-primary/10 p-2 pr-4 ${depth === 0 ? "rounded-t-lg" : ""}`}
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
                {canAddEdit && (
                  <AddSessionModal
                    defaultMilestoneId={milestone.id}
                    trigger={
                      <Button variant="link" className="p-0">
                        <CirclePlus className="h-4 w-4" />
                        <span className="hidden md:inline">
                          {tCommon("actions.add")}
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

          {/* Render sessions under this milestone FIRST */}
          {hasSessionsUnderMilestone && (
            <div className="sessions-container bg-muted pr-4 pb-2 mb-2">
              {groupedSessions.milestones[milestone.id]?.testSessions.map(
                (testSession) => (
                  <div key={testSession.id} style={{ paddingLeft: "1.5rem" }}>
                    <SessionItem
                      key={testSession.id}
                      testSession={testSession}
                      isCompleted={testSession.isCompleted}
                      onComplete={handleOpenDialog}
                      canComplete={canCloseSession}
                      isNew={newSessionId === testSession.id}
                    />
                  </div>
                )
              )}
            </div>
          )}

          {/* THEN render child milestones */}
          {milestone.children?.map((childMilestone) =>
            renderMilestoneWithSessions(childMilestone, depth + 1, dateFormat)
          )}
        </div>
      );
    };

    return (
      <>
        {groupedSessions.unscheduled.length > 0 && (
          <div
            className="w-full bg-muted rounded-lg p-0 pb-2"
            key={JSON.stringify(groupedSessions)}
          >
            {groupedSessions.unscheduled.some(
              (testSession) => !testSession.isCompleted
            ) && (
              <div className="milestone-grid bg-primary/10 rounded-t-lg p-4">
                <div className="milestone-name flex items-center gap-1">
                  <DynamicIcon
                    name="calendar-off"
                    className="w-6 h-6 shrink-0"
                  />
                  <div className="truncate">{t("noMilestone")}</div>
                </div>
                <div className="milestone-status"></div>
                <div className="milestone-dates flex justify-end">
                  {canAddEdit && (
                    <AddSessionModal
                      trigger={
                        <Button variant="default" size="sm">
                          <CirclePlus className="h-4 w-4" />
                          <span className="hidden md:inline">
                            {t("actions.add")}
                          </span>
                        </Button>
                      }
                    />
                  )}
                </div>
              </div>
            )}
            {groupedSessions.unscheduled.map((testSession) => (
              <div key={testSession.id} className="pl-4 pr-4">
                <SessionItem
                  testSession={testSession}
                  isCompleted={testSession.isCompleted}
                  onComplete={handleOpenDialog}
                  canComplete={canCloseSession}
                  isNew={newSessionId === testSession.id}
                />
              </div>
            ))}
          </div>
        )}
        <div className="rounded-b-lg mb-4"></div>

        {milestoneTree.map((milestone) =>
          renderMilestoneWithSessions(milestone, 0, dateFormat)
        )}
      </>
    );
  };

  const displayMode =
    testSessions.length > 0 && testSessions[0].isCompleted
      ? "completed"
      : "active";

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full relative">
        <div className="flex flex-col w-full">
          {displayMode === "active" ? (
            // Render grouped sessions for active tab
            renderGroupedSessions(
              groupedSessions,
              sortedMilestones,
              handleOpenDialog,
              dateFormat
            )
          ) : (
            // Render flat list for completed tab
            <div className="space-y-2 mt-4">
              {sortedSessions.map((testSession) => (
                <SessionItem
                  key={testSession.id}
                  testSession={testSession}
                  isCompleted={testSession.isCompleted}
                  onComplete={handleOpenDialog} // Still needed for potential future actions?
                  canComplete={canCloseSession} // Pass permission, though menu won't show
                  isNew={newSessionId === testSession.id}
                  showMilestone={true} // Show milestone within the item for context
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedSession && (
        <CompleteSessionDialog
          open={isDialogOpen}
          onOpenChange={handleCloseDialog}
          session={selectedSession}
          projectId={selectedSession.projectId}
        />
      )}
    </div>
  );
};

export default SessionDisplay;
