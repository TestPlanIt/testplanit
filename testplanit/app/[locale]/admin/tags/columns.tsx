import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { SessionsListDisplay } from "@/components/tables/SessionListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { Button } from "@/components/ui/button";
import type { Tags } from "~/zenstack/models";
import { ColumnDef } from "@/components/tables/tableFeatures";
import { SquarePen, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CountsLoading } from "@/components/tables/CountsLoading";

export interface ExtendedTags extends Tags {
  repositoryCases: { id: number }[];
  sessions: { id: number }[];
  testRuns: { id: number }[];
  projects?: { id: number; name: string; iconUrl: string | null }[];
  repositoryCasesCount?: number;
  sessionsCount?: number;
  testRunsCount?: number;
}

export const useColumns = (
  tCommon: ReturnType<typeof useTranslations<"common">>,
  onEditTag?: (tag: ExtendedTags) => void,
  onDeleteTag?: (tag: ExtendedTags) => void
): ColumnDef<ExtendedTags>[] =>
  useMemo(
    () => [
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
        accessorFn: (row) => row.testRuns,
        header: tCommon("fields.testRuns"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
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
        accessorFn: (row) => row.sessions,
        header: tCommon("fields.sessions"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
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
        header: tCommon("fields.projects"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
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
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableResizing: true,
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 80,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1 bg-primary-foreground whitespace-nowrap">
            <Button
              variant="ghost"
              className="h-auto px-2 py-1"
              onClick={() => onEditTag?.(row.original)}
              aria-label={tCommon("actions.edit")}
            >
              <SquarePen className="h-5 w-5" />
            </Button>
            <Button
              variant="destructive"
              className="h-auto px-2 py-1"
              onClick={() => onDeleteTag?.(row.original)}
              aria-label={tCommon("actions.delete")}
            >
              <Trash className="h-5 w-5" />
            </Button>
          </div>
        ),
      },
    ],
    [tCommon, onEditTag, onDeleteTag]
  );
