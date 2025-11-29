import { ColumnDef } from "@tanstack/react-table";
import { Tags } from "@prisma/client";
import { TagsDisplay } from "@/components/tables/TagDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";

export interface ExtendedTags extends Tags {
  repositoryCases: { id: number }[];
  sessions: { id: number; isCompleted: boolean }[];
  testRuns: { id: number; isCompleted: boolean }[];
  projects?: { id: number; name: string; iconUrl: string | null }[];
  repositoryCasesCount?: number;
  sessionsCount?: number;
  testRunsCount?: number;
}

export const getColumns = (
  translations: {
    name: string;
    testCases: string;
    sessions: string;
    testRuns: string;
    projects: string;
  },
  isLoadingCounts: boolean = false
): ColumnDef<ExtendedTags>[] => {
  return [
    {
      id: "name",
      accessorKey: "name",
      accessorFn: (row) => row.name,
      header: translations.name,
      enableSorting: false,
      enableResizing: true,
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
      accessorFn: (row) => row.repositoryCases,
      header: translations.testCases,
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const count = row.original.repositoryCasesCount;
        return (
          <div className="text-center">
            <CasesListDisplay
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
          </div>
        );
      },
    },
    {
      id: "testRuns",
      accessorKey: "testRuns",
      accessorFn: (row) => row.testRuns,
      header: translations.testRuns,
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const count = row.original.testRunsCount;
        return (
          <div className="text-center">
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
          </div>
        );
      },
    },
    {
      id: "sessions",
      accessorKey: "sessions",
      accessorFn: (row) => row.sessions,
      header: translations.sessions,
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const count = row.original.sessionsCount;
        return (
          <div className="text-center">
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
          </div>
        );
      },
    },
    {
      id: "projects",
      accessorKey: "projects",
      header: translations.projects,
      enableSorting: false,
      enableResizing: true,
      size: 75,
      cell: ({ row }) => {
        const projects = row.original.projects || [];
        return (
          <div className="text-center">
            <ProjectListDisplay projects={projects} isLoading={isLoadingCounts} />
          </div>
        );
      },
    },
  ];
};
