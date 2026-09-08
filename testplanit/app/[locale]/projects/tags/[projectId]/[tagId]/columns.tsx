import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { SessionTableDisplay } from "@/components/tables/SessionTableDisplay";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Lock, PlayCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";

export const useCaseColumns = (translations: {
  testCases: string;
  type: string;
  manual: string;
  automated: string;
}): ColumnDef<{
  id: number;
  name: string;
  source: any;
  automated?: boolean;
  hasParameters?: boolean;
  projectId: number;
}>[] => {
  const { testCases, type, manual, automated } = translations;

  return useMemo(
    () => [
      {
        id: "testCase",
        header: testCases,
        size: 600,
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
                hasParameters={row.original.hasParameters}
                maxLines={2}
              />
            </div>
          );
        },
      },
      {
        id: "type",
        header: type,
        size: 120,
        minSize: 80,
        maxSize: 200,
        enableResizing: true,
        cell: ({ row }) => {
          const isAutomated = row.original.automated;
          return (
            <Badge variant={isAutomated ? "default" : "secondary"}>
              {isAutomated ? automated : manual}
            </Badge>
          );
        },
      },
    ],
    [testCases, type, manual, automated]
  );
};

export const useSessionColumns = (translations: {
  sessions: string;
  status: string;
  completed: string;
  inProgress: string;
}): ColumnDef<{
  id: number;
  name: string;
  isCompleted: boolean;
  projectId: number;
}>[] => {
  const { sessions, status, completed, inProgress } = translations;

  return useMemo(
    () => [
      {
        id: "session",
        header: sessions,
        size: 600,
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
        header: status,
        size: 120,
        minSize: 80,
        maxSize: 200,
        enableResizing: true,
        cell: ({ row }) => {
          const isCompleted = row.original.isCompleted;
          return (
            <Badge
              variant={isCompleted ? "outline" : "default"}
              className={cn("gap-1", isCompleted && "text-muted-foreground")}
            >
              {isCompleted && <CheckCircle2 className="h-3 w-3" />}
              {isCompleted ? completed : inProgress}
            </Badge>
          );
        },
      },
    ],
    [sessions, status, completed, inProgress]
  );
};

const TestRunLinkDisplay: React.FC<{
  id: number;
  name: string;
  projectId: number;
  isCompleted: boolean;
  compositionLockedAt?: Date | string | null;
  maxLines?: number;
}> = ({
  id,
  name,
  projectId,
  isCompleted,
  compositionLockedAt,
  maxLines = 2,
}) => {
  const t = useTranslations("common.labels");
  if (!id) return null;

  const clampClass =
    maxLines === 1
      ? "truncate"
      : maxLines === 2
        ? "line-clamp-2"
        : "line-clamp-3";
  const textClass = cn(clampClass, "flex-1 text-start");
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
      {compositionLockedAt && <Lock className="w-3 h-3 shrink-0 mt-0.5" />}
    </Link>
  );

  if (!shouldShowTooltip) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>
        <span>{name}</span>
        {compositionLockedAt && (
          <p className="flex text-xs mt-1">
            <Lock className="w-3 h-3 shrink-0 me-1" />
            {t("compositionLocked")}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

export const useTestRunColumns = (translations: {
  testRuns: string;
  status: string;
  completed: string;
  inProgress: string;
}): ColumnDef<{
  id: number;
  name: string;
  isCompleted: boolean;
  compositionLockedAt?: Date | string | null;
  projectId: number;
}>[] => {
  const { testRuns, status, completed, inProgress } = translations;

  return useMemo(
    () => [
      {
        id: "testRun",
        header: testRuns,
        size: 600,
        minSize: 200,
        maxSize: 1200,
        enableResizing: true,
        meta: { isPinned: "left" },
        cell: ({ row }) => (
          <div className="w-full min-w-0 overflow-hidden">
            <TestRunLinkDisplay
              id={row.original.id}
              name={row.original.name}
              projectId={row.original.projectId}
              isCompleted={row.original.isCompleted}
              compositionLockedAt={row.original.compositionLockedAt}
              maxLines={2}
            />
          </div>
        ),
      },
      {
        id: "status",
        header: status,
        size: 120,
        minSize: 80,
        maxSize: 200,
        enableResizing: true,
        cell: ({ row }) => {
          const isCompleted = row.original.isCompleted;
          return (
            <Badge
              variant={isCompleted ? "outline" : "default"}
              className={cn("gap-1", isCompleted && "text-muted-foreground")}
            >
              {isCompleted && <CheckCircle2 className="h-3 w-3" />}
              {isCompleted ? completed : inProgress}
            </Badge>
          );
        },
      },
    ],
    [testRuns, status, completed, inProgress]
  );
};
