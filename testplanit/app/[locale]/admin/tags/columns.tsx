import { ColumnDef } from "@tanstack/react-table";
import { Tags } from "@prisma/client";
import { EditTagModal } from "./EditTag";
import { DeleteTagModal } from "./DeleteTag";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { useTranslations } from "next-intl";

export interface ExtendedTags extends Tags {
  repositoryCases: { id: number }[];
  sessions: { id: number }[];
  testRuns: { id: number }[];
  projects?: { id: number; name: string; iconUrl: string | null }[];
  repositoryCasesCount?: number;
  sessionsCount?: number;
  testRunsCount?: number;
}

export const getColumns = (
  tCommon: ReturnType<typeof useTranslations<"common">>,
  isLoadingCounts: boolean = false
): ColumnDef<ExtendedTags>[] => [
  {
    id: "name",
    accessorKey: "name",
    accessorFn: (row) => row.name,
    header: tCommon("name"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 500,
    maxSize: 500,
    cell: ({ row }) => row.original.name,
  },
  {
    id: "cases",
    accessorKey: "repositoryCases",
    accessorFn: (row) => row.repositoryCases,
    header: tCommon("fields.testCases"),
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
    header: tCommon("fields.testRuns"),
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
    header: tCommon("fields.sessions"),
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
    header: tCommon("fields.projects"),
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
  {
    id: "actions",
    header: tCommon("actions.actionsLabel"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    meta: { isPinned: "right" },
    size: 120,
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <EditTagModal key={`edit-${row.original.id}`} tag={row.original} />
        <DeleteTagModal key={`delete-${row.original.id}`} tag={row.original} />
      </div>
    ),
  },
];
