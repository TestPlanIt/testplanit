import { ProjectIcon } from "@/components/ProjectIcon";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { SessionTableDisplay } from "@/components/tables/SessionTableDisplay";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, PlayCircle } from "lucide-react";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";

const ProjectCell: React.FC<{
  projectName: string;
  projectId: number;
  iconUrl: string | null;
  noProject: string;
}> = ({ projectName, projectId, iconUrl, noProject }) => {
  return (
    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
      <span className="shrink-0">
        <ProjectIcon iconUrl={iconUrl} width={20} height={20} />
      </span>
      <div className="min-w-0 flex-1">
        <ProjectNameCell
          value={projectName || noProject}
          projectId={projectId}
          size="sm"
        />
      </div>
    </div>
  );
};

export const getCaseColumns = (translations: {
  testCases: string;
  type: string;
  manual: string;
  automated: string;
  project: string;
  noProject: string;
}): ColumnDef<{
  id: number;
  name: string;
  source: any;
  automated?: boolean;
  projectId?: number;
  projectName?: string;
  iconUrl?: string | null;
}>[] => {
  return [
    {
      id: "testCase",
      header: translations.testCases,
      size: 500,
      minSize: 200,
      maxSize: 1200,
      enableResizing: true,
      meta: { isPinned: "left" },
      cell: ({ row }) => {
        return (
          <div className="w-full min-w-0 overflow-hidden">
            <CaseDisplay
              id={row.original.id}
              name={row.original.name}
              link={`/projects/repository/${row.original.projectId}/${row.original.id}`}
              source={row.original.source}
              automated={row.original.automated}
              maxLines={2}
            />
          </div>
        );
      },
    },
    {
      id: "type",
      header: translations.type,
      size: 120,
      minSize: 80,
      maxSize: 200,
      enableResizing: true,
      cell: ({ row }) => {
        const isAutomated = row.original.automated;
        return (
          <Badge variant={isAutomated ? "default" : "secondary"}>
            {isAutomated ? translations.automated : translations.manual}
          </Badge>
        );
      },
    },
    {
      id: "project",
      header: translations.project,
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      size: 150,
      minSize: 150,
      maxSize: 500,
      cell: ({ row }) => (
        <ProjectCell
          projectName={row.original.projectName || translations.noProject}
          projectId={row.original.projectId || 0}
          iconUrl={row.original.iconUrl || null}
          noProject={translations.noProject}
        />
      ),
    },
  ];
};

export const getSessionColumns = (translations: {
  sessions: string;
  status: string;
  completed: string;
  inProgress: string;
  project: string;
  noProject: string;
}): ColumnDef<{
  id: number;
  name: string;
  isCompleted: boolean;
  projectId?: number;
  projectName?: string;
  iconUrl?: string | null;
}>[] => {
  return [
    {
      id: "session",
      header: translations.sessions,
      size: 500,
      minSize: 200,
      maxSize: 1200,
      enableResizing: true,
      meta: { isPinned: "left" },
      cell: ({ row }) => (
        <div className="w-full min-w-0 overflow-hidden">
          <SessionTableDisplay
            id={row.original.id}
            name={row.original.name}
            link={`/projects/sessions/${row.original.projectId}/${row.original.id}`}
            maxLines={2}
            isCompleted={row.original.isCompleted}
          />
        </div>
      ),
    },
    {
      id: "status",
      header: translations.status,
      size: 120,
      minSize: 80,
      maxSize: 200,
      enableResizing: true,
      cell: ({ row }) => {
        const isCompleted = row.original.isCompleted;
        return (
          <Badge
            variant={isCompleted ? "outline" : "default"}
            className={cn(
              "gap-1",
              isCompleted && "text-muted-foreground"
            )}
          >
            {isCompleted && <CheckCircle2 className="h-3 w-3" />}
            {isCompleted ? translations.completed : translations.inProgress}
          </Badge>
        );
      },
    },
    {
      id: "project",
      header: translations.project,
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      size: 250,
      minSize: 150,
      maxSize: 500,
      cell: ({ row }) => (
        <ProjectCell
          projectName={row.original.projectName || translations.noProject}
          projectId={row.original.projectId || 0}
          iconUrl={row.original.iconUrl || null}
          noProject={translations.noProject}
        />
      ),
    },
  ];
};

const TestRunLinkDisplay: React.FC<{
  id: number;
  name: string;
  projectId: number;
  isCompleted: boolean;
  maxLines?: number;
}> = ({ id, name, projectId, isCompleted, maxLines = 2 }) => {
  if (!id) return null;

  const clampClass =
    maxLines === 1
      ? "truncate"
      : maxLines === 2
        ? "line-clamp-2"
        : "line-clamp-3";
  const textClass = cn(clampClass, "flex-1 text-left");
  const shouldShowTooltip = true;

  const content = (
    <Link
      href={`/projects/runs/${projectId}/${id}`}
      className={cn(
        "flex items-start gap-1 hover:text-primary group min-w-0 overflow-hidden",
        isCompleted ? "text-muted-foreground/80" : undefined
      )}
    >
      <PlayCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className={cn(textClass, "min-w-0")}>{name}</span>
    </Link>
  );

  if (!shouldShowTooltip) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>
          <span>{name}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const getTestRunColumns = (translations: {
  testRuns: string;
  status: string;
  completed: string;
  inProgress: string;
  project: string;
  noProject: string;
}): ColumnDef<{
  id: number;
  name: string;
  isCompleted: boolean;
  projectId?: number;
  projectName?: string;
  iconUrl?: string | null;
}>[] => {
  return [
    {
      id: "testRun",
      header: translations.testRuns,
      size: 500,
      minSize: 200,
      maxSize: 1200,
      enableResizing: true,
      meta: { isPinned: "left" },
      cell: ({ row }) => (
        <div className="w-full min-w-0 overflow-hidden">
          <TestRunLinkDisplay
            id={row.original.id}
            name={row.original.name}
            projectId={row.original.projectId || 0}
            isCompleted={row.original.isCompleted}
            maxLines={2}
          />
        </div>
      ),
    },
    {
      id: "status",
      header: translations.status,
      size: 120,
      minSize: 80,
      maxSize: 200,
      enableResizing: true,
      cell: ({ row }) => {
        const isCompleted = row.original.isCompleted;
        return (
          <Badge
            variant={isCompleted ? "outline" : "default"}
            className={cn(
              "gap-1",
              isCompleted && "text-muted-foreground"
            )}
          >
            {isCompleted && <CheckCircle2 className="h-3 w-3" />}
            {isCompleted ? translations.completed : translations.inProgress}
          </Badge>
        );
      },
    },
    {
      id: "project",
      header: translations.project,
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      size: 250,
      minSize: 150,
      maxSize: 500,
      cell: ({ row }) => (
        <ProjectCell
          projectName={row.original.projectName || translations.noProject}
          projectId={row.original.projectId || 0}
          iconUrl={row.original.iconUrl || null}
          noProject={translations.noProject}
        />
      ),
    },
  ];
};
