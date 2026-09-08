import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useTranslations } from "next-intl";
import React from "react";
import SessionItem from "~/app/[locale]/projects/sessions/[projectId]/SessionItem";
import { usePendingReviewsByEntity } from "~/hooks/usePendingReviewsByEntity";

interface SessionsSectionProps {
  projectId: number;
}

const SessionsSection: React.FC<SessionsSectionProps> = ({ projectId }) => {
  const t = useTranslations();

  const { data: sessions, isLoading: isLoadingSessions } = useClientQueries(
    schema
  ).sessions.useFindMany({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isDeleted: false },
        { isCompleted: false },
      ],
    },
    // Mirrors the sessions page selection so SessionItem renders identically here.
    select: {
      id: true,
      name: true,
      isCompleted: true,
      completedAt: true,
      createdAt: true,
      note: true,
      projectId: true,
      configurationGroupId: true,
      configuration: true,
      state: { include: { icon: true, color: true } },
      createdBy: true,
      assignedTo: true,
      milestone: {
        include: {
          milestoneType: { include: { icon: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const sessionIds = React.useMemo(
    () => sessions?.map((s) => s.id) ?? [],
    [sessions]
  );
  const pendingReviewsBySessionId = usePendingReviewsByEntity(
    "SESSION",
    sessionIds
  );

  if (isLoadingSessions) {
    return (
      <div className="flex justify-center items-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  if (!sessions?.length) return null;

  return (
    <div className="flex flex-col">
      <h2 className="text-primary mb-2">
        {t("projects.overview.latestSessions")}
      </h2>
      {sessions.map((testSession) => (
        <SessionItem
          key={testSession.id}
          testSession={testSession}
          isCompleted={testSession.isCompleted}
          projectId={projectId}
          showActions={false}
          pendingRequest={pendingReviewsBySessionId.get(testSession.id)}
        />
      ))}
    </div>
  );
};

export default SessionsSection;
