import { ColumnDef } from "@tanstack/react-table";
import { Tags } from "@prisma/client";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";

export interface ExtendedTags extends Tags {
  repositoryCases: { id: number; name: string }[];
  sessions: {
    isCompleted: any;
    id: number;
    name: string;
  }[];
  testRuns: { id: number; name: string; isCompleted?: boolean }[];
}

export const getColumns = (
  projectId: string,
  activeCaseMap: Record<number, string>,
  activeSessionMap: Record<number, string>,
  activeRunMap: Record<number, string>,
  t: any,
  isLoadingCounts: boolean = false
): ColumnDef<ExtendedTags>[] => {
  const projectIdNumber = Number(projectId);

  return [
    {
      id: "name",
      accessorKey: "name",
      accessorFn: (row) => row.name,
      header: t("common.fields.name"),
      enableSorting: false,
      enableResizing: true,
      meta: { isPinned: "left" },
      enableHiding: false,
      size: 500,
      cell: ({ row }) => (
        <TagsDisplay
          id={row.original.id}
          name={row.original.name}
          link={`/projects/tags/${projectId}/${row.original.id}`}
        />
      ),
    },
    {
      id: "cases",
      accessorKey: "repositoryCases",
      accessorFn: (row) => row.repositoryCases,
      header: t("common.fields.testCases"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const repositoryCaseIds = row.original.repositoryCases
          .filter((c) =>
            Object.prototype.hasOwnProperty.call(activeCaseMap, c.id)
          )
          .map((c) => c.id);

        return (
          <div className="text-center">
            <CasesListDisplay
              caseIds={repositoryCaseIds}
              count={repositoryCaseIds.length}
              filter={{
                ...(isNaN(projectIdNumber)
                  ? {}
                  : { projectId: projectIdNumber }),
                tags: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
    {
      id: "sessions",
      accessorKey: "sessions",
      accessorFn: (row) => row.sessions,
      header: t("common.fields.sessions"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const filteredSessions = row.original.sessions.filter((s) =>
          Object.prototype.hasOwnProperty.call(activeSessionMap, s.id)
        );
        const sessionCount = filteredSessions.length;

        return (
          <div className="text-center">
            <SessionsListDisplay
              sessions={filteredSessions.map((session) => ({
                id: session.id,
                name: session.name,
                projectId: Number(projectId),
                isCompleted: !!session.isCompleted,
              }))}
              count={sessionCount}
              filter={{
                projectId: Number(projectId),
                tags: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
    {
      id: "runs",
      accessorKey: "testRuns",
      accessorFn: (row) => row.testRuns,
      header: t("common.fields.testRuns"),
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const filteredRuns = row.original.testRuns.filter((r) =>
          Object.prototype.hasOwnProperty.call(activeRunMap, r.id)
        );
        const runCount = filteredRuns.length;

        return (
          <div className="text-center">
            <TestRunsListDisplay
              testRuns={filteredRuns.map((run) => ({
                id: run.id,
                name: run.name,
                projectId: Number(projectId),
                isCompleted: !!run.isCompleted,
              }))}
              count={runCount}
              filter={{
                projectId: Number(projectId),
                tags: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        );
      },
    },
  ];
};
