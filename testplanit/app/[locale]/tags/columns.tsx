import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import type { Tags } from "~/zenstack/models";
import { ColumnDef } from "@/components/tables/tableFeatures";
import { useMemo } from "react";
import { CountsLoading } from "@/components/tables/CountsLoading";

export interface ExtendedTags extends Tags {
  repositoryCases: { id: number }[];
  sessions: { id: number; isCompleted: boolean }[];
  testRuns: { id: number; isCompleted: boolean }[];
  projects?: { id: number; name: string; iconUrl: string | null }[];
  repositoryCasesCount?: number;
  sessionsCount?: number;
  testRunsCount?: number;
}

export const useTagColumns = (translations: {
  name: string;
  testCases: string;
  sessions: string;
  testRuns: string;
  projects: string;
}): ColumnDef<ExtendedTags>[] => {
  const { name, testCases, sessions, testRuns, projects } = translations;
  return useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        accessorFn: (row) => row.name,
        header: name,
        enableSorting: true,
        enableResizing: true,
        sortFn: "alphanumeric",
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 500,
        cell: ({ row }) => (
          <TagsDisplay
            id={row.original.id}
            name={row.original.name}
            link={`/tags/${row.original.id}`}
          />
        ),
      },
      {
        id: "cases",
        accessorKey: "repositoryCases",
        accessorFn: (row) => row.repositoryCasesCount ?? 0,
        header: testCases,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 130,
        cell: ({ row }) => {
          const count = row.original.repositoryCasesCount;
          return (
            <div className="text-center">
              <CountsLoading>
                {(isLoadingCounts) => (
                  <CasesListDisplay
                    count={count}
                    filter={{
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
                )}
              </CountsLoading>
            </div>
          );
        },
      },
      {
        id: "testRuns",
        accessorKey: "testRuns",
        accessorFn: (row) => row.testRunsCount ?? 0,
        header: testRuns,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 130,
        cell: ({ row }) => {
          const count = row.original.testRunsCount;
          return (
            <div className="text-center">
              <CountsLoading>
                {(isLoadingCounts) => (
                  <TestRunsListDisplay
                    count={count}
                    filter={{
                      tags: {
                        some: {
                          id: row.original.id,
                        },
                      },
                    }}
                    isLoading={isLoadingCounts}
                  />
                )}
              </CountsLoading>
            </div>
          );
        },
      },
      {
        id: "sessions",
        accessorKey: "sessions",
        accessorFn: (row) => row.sessionsCount ?? 0,
        header: sessions,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 130,
        cell: ({ row }) => {
          const count = row.original.sessionsCount;
          return (
            <div className="text-center">
              <CountsLoading>
                {(isLoadingCounts) => (
                  <SessionsListDisplay
                    count={count}
                    filter={{
                      tags: {
                        some: {
                          id: row.original.id,
                        },
                      },
                    }}
                    isLoading={isLoadingCounts}
                  />
                )}
              </CountsLoading>
            </div>
          );
        },
      },
      {
        id: "projects",
        accessorKey: "projects",
        accessorFn: (row) => (row.projects || []).length,
        header: projects,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 130,
        cell: ({ row }) => {
          const projects = row.original.projects || [];
          return (
            <div className="text-center">
              <CountsLoading>
                {(isLoadingCounts) => (
                  <ProjectListDisplay
                    projects={projects}
                    isLoading={isLoadingCounts}
                  />
                )}
              </CountsLoading>
            </div>
          );
        },
      },
    ],
    [name, testCases, sessions, testRuns, projects]
  );
};
