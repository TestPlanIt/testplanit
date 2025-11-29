import { ColumnDef } from "@tanstack/react-table";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { SessionTableDisplay } from "@/components/tables/SessionTableDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Link } from "~/lib/navigation";
import { PlayCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "~/utils";

export const getCaseColumns = (translations: {
  testCases: string;
  project: string;
  noProject: string;
}): ColumnDef<{
  id: number;
  name: string;
  source: any;
  projectId?: number;
  projectName?: string;
  iconUrl?: string | null;
}>[] => {
  return [
    {
      id: "testCase",
      header: translations.testCases,
      size: 400,
      minSize: 200,
      maxSize: 800,
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
              maxLines={2}
            />
          </div>
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
      cell: ({ row }) => {
        const projectName = row.original.projectName || translations.noProject;
        const projectId = row.original.projectId || 0;
        const iconUrl = row.original.iconUrl || null;
        return (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            <span className="shrink-0">
              <ProjectIcon iconUrl={iconUrl} width={20} height={20} />
            </span>
            <div className="min-w-0 flex-1">
              <ProjectNameCell
                value={projectName}
                projectId={projectId}
                size="sm"
              />
            </div>
          </div>
        );
      },
    },
  ];
};

export const getSessionColumns = (translations: {
  sessions: string;
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
      size: 400,
      minSize: 200,
      maxSize: 800,
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
      id: "project",
      header: translations.project,
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      size: 250,
      minSize: 150,
      maxSize: 500,
      cell: ({ row }) => {
        const projectName = row.original.projectName || translations.noProject;
        const projectId = row.original.projectId || 0;
        const iconUrl = row.original.iconUrl || null;
        return (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            <span className="shrink-0">
              <ProjectIcon iconUrl={iconUrl} width={20} height={20} />
            </span>
            <div className="min-w-0 flex-1">
              <ProjectNameCell
                value={projectName}
                projectId={projectId}
                size="sm"
              />
            </div>
          </div>
        );
      },
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
      size: 400,
      minSize: 200,
      maxSize: 800,
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
      id: "project",
      header: translations.project,
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      size: 250,
      minSize: 150,
      maxSize: 500,
      cell: ({ row }) => {
        const projectName = row.original.projectName || translations.noProject;
        const projectId = row.original.projectId || 0;
        const iconUrl = row.original.iconUrl || null;
        return (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            <span className="shrink-0">
              <ProjectIcon iconUrl={iconUrl} width={20} height={20} />
            </span>
            <div className="min-w-0 flex-1">
              <ProjectNameCell
                value={projectName}
                projectId={projectId}
                size="sm"
              />
            </div>
          </div>
        );
      },
    },
  ];
};
