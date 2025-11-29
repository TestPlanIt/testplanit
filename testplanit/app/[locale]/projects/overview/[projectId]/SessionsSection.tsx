import React from "react";
import { Link } from "~/lib/navigation";
import { Compass, LinkIcon } from "lucide-react";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { useFindManySessions } from "~/lib/hooks";
import Loading from "@/components/LoadingSpinner";
import { useTranslations } from "next-intl";
import SessionResultsSummary from "~/components/SessionResultsSummary";

interface SessionsSectionProps {
  projectId: number;
}

const SessionsSection: React.FC<SessionsSectionProps> = ({ projectId }) => {
  const t = useTranslations();

  const { data: sessions, isLoading: isLoadingSessions } = useFindManySessions({
    where: {
      AND: [
        { projectId: Number(projectId) },
        { isDeleted: false },
        { isCompleted: false },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const { data: sessionsCount, isLoading: isLoadingCount } =
    useFindManySessions({
      where: {
        AND: [
          { projectId: Number(projectId) },
          { isDeleted: false },
          { isCompleted: false },
        ],
      },
      select: {
        id: true,
      },
    });

  if (isLoadingSessions || isLoadingCount) {
    return (
      <div className="flex justify-center items-center py-8">
        <Loading />
      </div>
    );
  }

  if (!sessions?.length) return null;

  return (
    <div className="flex flex-col">
      <p className="text-sm text-muted-foreground mb-4">
        <Link className="group" href={`/projects/sessions/${projectId}`}>
          {t("projects.overview.seeAllActiveSessions", {
            count: sessionsCount?.length ?? 0,
          })}
          <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
      </p>
      <div className="flex flex-col">
        <h2 className="text-primary mb-2">
          {t("projects.overview.latestSessions")}
        </h2>
        <ul className="flex flex-col w-full space-y-4">
          {sessions.map((testSession) => (
            <li key={testSession.id} className="ml-6">
              <div className="grid grid-cols-[1fr,2fr] gap-4 items-center">
                {/* Left column - Session name and created date */}
                <div className="flex flex-col space-y-1 min-w-0">
                  {/* First row - Session name */}
                  <Link
                    href={`/projects/sessions/${projectId}/${testSession.id}`}
                    className="block"
                  >
                    <div className="flex items-center group">
                      <Compass className="h-5 w-5 shrink-0 mr-2" />
                      <span className="font-medium truncate pr-1">
                        {testSession.name}
                      </span>
                      <LinkIcon className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </Link>

                  {/* Second row - Created date */}
                  <div className="text-sm text-muted-foreground ml-7 flex items-center min-w-0">
                    <span className="shrink-0 whitespace-nowrap mr-1">
                      {t("projects.overview.created")}
                      {": "}
                    </span>
                    <span className="truncate">
                      <DateTextDisplay startDate={testSession.createdAt} />
                    </span>
                  </div>
                </div>

                {/* Right column - SessionResultsSummary (spans both rows) */}
                <div className="flex justify-end min-w-0">
                  <SessionResultsSummary
                    sessionId={testSession.id}
                    className="w-full"
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default SessionsSection;
