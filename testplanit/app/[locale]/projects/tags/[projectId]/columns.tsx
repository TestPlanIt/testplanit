import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

export interface ExtendedTags {
  id: number;
  name: string;
  casesCount: number;
  sessionsCount: number;
  runsCount: number;
}

export const useColumns = (
  projectId: string,
  t: any,
  isLoadingCounts: boolean = false
): ColumnDef<ExtendedTags>[] => {
  const projectIdNumber = Number(projectId);

  return useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        accessorFn: (row) => row.name,
        header: t("common.name"),
        enableSorting: true,
        enableResizing: true,
        sortingFn: "alphanumeric",
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
        accessorKey: "casesCount",
        accessorFn: (row) => row.casesCount,
        header: t("common.fields.testCases"),
        enableSorting: true,
        enableResizing: true,
        sortingFn: "basic",
        size: 130,
        cell: ({ row }) => (
          <div className="text-center">
            <CasesListDisplay
              count={row.original.casesCount}
              filter={{
                ...(isNaN(projectIdNumber)
                  ? {}
                  : { projectId: projectIdNumber }),
                caseTags: {
                  some: {
                    tag: {
                      id: row.original.id,
                    },
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        ),
      },
      {
        id: "sessions",
        accessorKey: "sessionsCount",
        accessorFn: (row) => row.sessionsCount,
        header: t("common.fields.sessions"),
        enableSorting: true,
        enableResizing: true,
        sortingFn: "basic",
        size: 130,
        cell: ({ row }) => (
          <div className="text-center">
            <SessionsListDisplay
              count={row.original.sessionsCount}
              filter={{
                projectId: projectIdNumber,
                tags: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        ),
      },
      {
        id: "runs",
        accessorKey: "runsCount",
        accessorFn: (row) => row.runsCount,
        header: t("common.fields.testRuns"),
        enableSorting: true,
        enableResizing: true,
        sortingFn: "basic",
        size: 130,
        cell: ({ row }) => (
          <div className="text-center">
            <TestRunsListDisplay
              count={row.original.runsCount}
              filter={{
                projectId: projectIdNumber,
                tags: {
                  some: {
                    id: row.original.id,
                  },
                },
              }}
              isLoading={isLoadingCounts}
            />
          </div>
        ),
      },
    ],
    [projectId, projectIdNumber, t, isLoadingCounts]
  );
};
