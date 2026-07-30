import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import React from "react";

import { DateFormatter } from "@/components/DateFormatter";
import LoadingSpinner from "@/components/LoadingSpinner";
import { ProjectIcon } from "@/components/ProjectIcon";
import type { Projects } from "~/zenstack/models";

import { MemberList } from "@/components/MemberList";
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
} from "lucide-react";

// Define the expected shape of the _count object
interface ProjectCounts {
  milestones: number;
  testRuns: number;
  sessions: number;
  repositoryCases: number;
  issues: number;
}

interface ProjectCardProps {
  // Include the _count object in the project type
  project: Projects & { _count?: ProjectCounts | null };
  users: { userId: string }[];
  isLoadingIssueCounts?: boolean;
  /** In-progress automated runs — the same set the project runs page shows
   *  in its "Automation Runs in Progress" card. */
  automationRunCount?: number;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  users,
  isLoadingIssueCounts = false,
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
  const issueCount = project._count?.issues ?? 0;

  return (
    <Card
      onClick={handleCardClick}
      className={`group cursor-pointer transition-all duration-200 ease-in hover:ring-offset-2 hover:ring-4 hover:ring-primary ${project.isCompleted ? "bg-muted-foreground/20 border-muted-foreground" : "border-primary"}`}
    >
      <CardHeader>
        <CardTitle className="text-primary text-xl">
          <Link
            href={`/projects/overview/${project.id}`}
            className="flex items-center gap-1 hover:underline group/title"
          >
            <ProjectIcon iconUrl={project.iconUrl} height={25} width={25} />
            <div className="truncate">{project.name}</div>
            <LinkIcon className="w-4 h-4 inline ms-1 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
          </Link>
        </CardTitle>
        {project.note && (
          <CardDescription className="h-5 overflow-hidden text-ellipsis">
            {project.note}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="items-center gap-x-4 flex flex-wrap">
          {/* Display counts - only show if count > 0 */}
          {testCaseCount > 0 && (
            <Link
              href={`/projects/repository/${project.id}`}
              className="flex items-center gap-1"
              title={t("home.counts.testCases", {
                count: testCaseCount,
              })}
            >
              <ListChecks className="w-4 h-4 text-muted-foreground mt-1" />
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
              <Milestone className="w-4 h-4 text-muted-foreground mt-1" />
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
              <CirclePlay className="w-4 h-4 text-muted-foreground mt-1" />
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
              <Bot className="w-4 h-4 text-muted-foreground mt-1" />
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
              <Compass className="w-4 h-4 text-muted-foreground mt-1" />
              <span>{sessionCount.toLocaleString(locale)}</span>
            </Link>
          )}
          {isLoadingIssueCounts ? (
            <div className="flex items-center gap-1">
              <Bug className="w-4 h-4 text-muted-foreground mt-1" />
              <LoadingSpinner className="ms-1 w-2 h-2 text-muted-foreground" />
            </div>
          ) : (
            issueCount > 0 && (
              <Link
                href={`/projects/issues/${project.id}`}
                className="flex items-center gap-1"
                title={t("home.counts.issues", {
                  count: issueCount,
                })}
              >
                <Bug className="w-4 h-4 text-muted-foreground mt-1" />
                <span>{issueCount.toLocaleString(locale)}</span>
              </Link>
            )
          )}
        </div>
        <MemberList users={users} maxUsers={10} />
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground grid grid-cols-1 items-end">
        <div>
          {t("common.fields.created")}:{" "}
          {project.createdAt && (
            <DateFormatter
              date={project.createdAt}
              formatString={session?.user.preferences?.dateFormat}
              timezone={session?.user.preferences?.timezone}
            />
          )}
        </div>
        <div>{project.isCompleted ? "" : t("projects.status.active")}</div>
        {project.completedAt && (
          <div>
            {t("common.fields.completed")}:{" "}
            <DateFormatter
              date={project.completedAt}
              formatString={session?.user.preferences?.dateFormat}
              timezone={session?.user.preferences?.timezone}
            />
          </div>
        )}
      </CardFooter>
    </Card>
  );
};
