import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import React from "react";

import { DateFormatter } from "@/components/DateFormatter";
import { LastActiveDisplay } from "@/components/LastActiveDisplay";
import { ProjectIcon } from "@/components/ProjectIcon";
import type { ProjectCardStats } from "~/lib/services/projectCardStats";
import type { Projects } from "~/zenstack/models";

import { MemberList } from "@/components/MemberList";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Link, useRouter } from "@/lib/navigation";
import {
  Bot,
  Bug,
  CirclePlay,
  Compass,
  LinkIcon,
  ListChecks,
  Milestone,
  UserCheck,
} from "lucide-react";

// Define the expected shape of the _count object
interface ProjectCounts {
  milestones: number;
  testRuns: number;
  sessions: number;
  repositoryCases: number;
}

interface ProjectCardProps {
  // Include the _count object in the project type
  project: Projects & { _count?: ProjectCounts | null };
  users: { userId: string }[];
  /** Live figures for the project; absent until they have loaded. */
  stats?: ProjectCardStats;
  /** People already loaded by the page, for the member avatars. */
  members?: { id: string; name: string; image: string | null }[];
  /** In-progress automated runs — the same set the project runs page shows
   *  in its "Automation Runs in Progress" card. */
  automationRunCount?: number;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  users,
  stats,
  members,
  automationRunCount = 0,
}) => {
  const { data: session } = useSession();
  const locale = useLocale();
  const t = useTranslations();
  const router = useRouter();

  // Navigate to the project overview when the card is clicked, unless the
  // click originated from a nested link or button (e.g. the count links,
  // which navigate to their own destinations).
  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a, button")) return;
    router.push(`/projects/overview/${project.id}`);
  };

  // Extract counts, defaulting to 0 if not present
  const milestoneCount = project._count?.milestones ?? 0;
  const runCount = project._count?.testRuns ?? 0;
  const sessionCount = project._count?.sessions ?? 0;
  const testCaseCount = project._count?.repositoryCases ?? 0;
  const issueCount = stats?.issues ?? 0;
  const pendingCount = stats?.myPending ?? 0;

  return (
    <Card
      onClick={handleCardClick}
      className={`group cursor-pointer transition-all duration-200 ease-in hover:ring-4 hover:ring-primary hover:ring-offset-2 ${project.isCompleted ? "border-muted-foreground bg-muted-foreground/20" : "border-primary"}`}
    >
      <CardHeader>
        <CardTitle className="text-xl text-primary">
          <Link
            href={`/projects/overview/${project.id}`}
            className="group/title flex items-center gap-1 hover:underline"
          >
            <ProjectIcon iconUrl={project.iconUrl} height={25} width={25} />
            <div className="truncate">{project.name}</div>
            <LinkIcon className="ms-1 inline h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100" />
            {project.isCompleted && (
              <Badge
                variant="secondary"
                className="ms-auto shrink-0"
                data-testid="project-completed-badge"
              >
                {t("common.fields.completed")}
              </Badge>
            )}
          </Link>
        </CardTitle>
        {project.note && (
          <CardDescription className="truncate">{project.note}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-4">
          {/* Display counts - only show if count > 0 */}
          {testCaseCount > 0 && (
            <Link
              href={`/projects/repository/${project.id}`}
              className="flex items-center gap-1"
              title={t("home.counts.testCases", {
                count: testCaseCount,
              })}
            >
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <span>{testCaseCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {milestoneCount > 0 && (
            <Link
              href={`/projects/milestones/${project.id}`}
              className="flex items-center gap-1"
              title={t("home.counts.activeMilestones", {
                count: milestoneCount,
              })}
            >
              <Milestone className="h-4 w-4 text-muted-foreground" />
              <span>{milestoneCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {runCount > 0 && (
            <Link
              href={`/projects/runs/${project.id}`}
              className="flex items-center gap-1"
              title={t("home.counts.activeRuns", {
                count: runCount,
              })}
            >
              <CirclePlay className="h-4 w-4 text-muted-foreground" />
              <span>{runCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {automationRunCount > 0 && (
            <Link
              href={`/projects/runs/${project.id}?runType=automated`}
              className="flex items-center gap-1"
              title={t("home.counts.automationRunsInProgress", {
                count: automationRunCount,
              })}
            >
              <Bot className="h-4 w-4 text-muted-foreground" />
              <span>{automationRunCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {sessionCount > 0 && (
            <Link
              href={`/projects/sessions/${project.id}`}
              className="flex items-center gap-1"
              title={t("home.counts.activeSessions", {
                count: sessionCount,
              })}
            >
              <Compass className="h-4 w-4 text-muted-foreground" />
              <span>{sessionCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {issueCount > 0 && (
            <Link
              href={`/projects/issues/${project.id}`}
              className="flex items-center gap-1"
              title={t("home.counts.issues", {
                count: issueCount,
              })}
            >
              <Bug className="h-4 w-4 text-muted-foreground" />
              <span>{issueCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {pendingCount > 0 && (
            <Link
              href={`/projects/runs/${project.id}`}
              className="flex items-center gap-1 font-medium text-primary"
              title={t("home.counts.assignedToYou", {
                count: pendingCount,
              })}
              data-testid="project-pending-count"
            >
              <UserCheck className="h-4 w-4" />
              <span>{pendingCount.toLocaleString(locale)}</span>
            </Link>
          )}
        </div>
        <MemberList users={users} maxUsers={10} directory={members} />
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        {project.isCompleted && project.completedAt ? (
          <div>
            {t("common.fields.completed")}:{" "}
            <DateFormatter
              date={project.completedAt}
              formatString={session?.user.preferences?.dateFormat}
              timezone={session?.user.preferences?.timezone}
            />
          </div>
        ) : stats?.lastActivityAt ? (
          <div
            className="flex items-center gap-1"
            data-testid="project-last-activity"
          >
            {t("home.lastActivity")}
            <LastActiveDisplay date={stats.lastActivityAt} />
          </div>
        ) : (
          stats && <div>{t("home.noActivity")}</div>
        )}
      </CardFooter>
    </Card>
  );
};
