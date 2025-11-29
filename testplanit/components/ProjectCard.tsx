import React from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Projects } from "@prisma/client";
import { ProjectIcon } from "@/components/ProjectIcon";
import { DateFormatter } from "@/components/DateFormatter";
import LoadingSpinner from "@/components/LoadingSpinner";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Link } from "@/lib/navigation";
import { MemberList } from "@/components/MemberList";
import {
  LinkIcon,
  Milestone,
  CirclePlay,
  Compass,
  ListChecks,
  Bug,
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
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  users,
  isLoadingIssueCounts = false,
}) => {
  const { data: session } = useSession();
  const t = useTranslations();

  // Extract counts, defaulting to 0 if not present
  const milestoneCount = project._count?.milestones ?? 0;
  const runCount = project._count?.testRuns ?? 0;
  const sessionCount = project._count?.sessions ?? 0;
  const testCaseCount = project._count?.repositoryCases ?? 0;
  const issueCount = project._count?.issues ?? 0;

  return (
    <Card
      className={`group transition-colors ${project.isCompleted ? "bg-muted-foreground/20 border-muted-foreground" : "border-primary"}`}
    >
      <CardHeader>
        <CardTitle className="text-primary text-xl">
          <Link
            href={`/projects/overview/${project.id}`}
            className="flex items-center gap-1 hover:underline group/title"
          >
            <ProjectIcon iconUrl={project.iconUrl} height={25} width={25} />
            <div className="truncate">{project.name}</div>
            <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
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
              <span>{testCaseCount.toLocaleString()}</span>
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
              <span>{milestoneCount.toLocaleString()}</span>
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
              <span>{runCount.toLocaleString()}</span>
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
              <span>{sessionCount.toLocaleString()}</span>
            </Link>
          )}
          {isLoadingIssueCounts ? (
            <div className="flex items-center gap-1">
              <Bug className="w-4 h-4 text-muted-foreground mt-1" />
              <LoadingSpinner className="ml-1 w-2 h-2 text-muted-foreground" />
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
                <span>{issueCount.toLocaleString()}</span>
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
