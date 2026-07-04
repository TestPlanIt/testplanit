"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useAccessibleProjectsForUsers } from "~/hooks/useAccessibleProjectsForUsers";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { ExtendedUser, useUserColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function UserList() {
  return <Users />;
}

const PAGE_SIZE = 50;

function Users() {
  const { data: session, status } = useSession();
  const t = useTranslations("users");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const [sortConfig, setSortConfig] = useState<
    | {
        column: string;
        direction: "asc" | "desc";
      }
    | undefined
  >({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const router = useRouter();
  const debouncedSearchString = useDebounce(searchString, 500);

  const usersWhere = useMemo(
    () => ({
      AND: [
        {
          name: {
            contains: debouncedSearchString,
            mode: "insensitive" as const,
          },
        },
        { isActive: true },
        { isDeleted: false },
      ],
    }),
    [debouncedSearchString]
  );

  // Trailing `id` tiebreaker keeps offset pagination stable when the primary
  // sort key isn't unique (otherwise pages can duplicate or skip rows).
  const orderBy = useMemo(
    () =>
      sortConfig
        ? [
            { [sortConfig.column]: sortConfig.direction },
            { id: "asc" as const },
          ]
        : [{ name: "asc" as const }, { id: "asc" as const }],
    [sortConfig]
  );

  const infiniteBaseArgs = useMemo(
    () => ({ orderBy, where: usersWhere, take: PAGE_SIZE }),
    [orderBy, usersWhere]
  );

  const { data: totalCount } = useClientQueries(schema).user.useCount(
    { where: usersWhere },
    { enabled: !!session?.user, refetchOnWindowFocus: false }
  );

  // Fetch-on-scroll: pages of users load as the sentinel scrolls into view, so
  // an instance with tens of thousands of users never loads the full set.
  const {
    data: infinitePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useClientQueries(schema).user.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled: !!session?.user,
    refetchOnWindowFocus: false,
  });

  const baseRows = useMemo(
    () => infinitePages?.pages.flat() ?? [],
    [infinitePages]
  );

  const resetKey = `${debouncedSearchString}|${sortConfig?.column}|${sortConfig?.direction}`;

  // Resolve each loaded page's effective accessible projects incrementally
  // (bounded per-page batches), instead of one ~8-query action per rendered row.
  const userIds = useMemo(() => baseRows.map((u) => u.id), [baseRows]);
  const projectsByUser = useAccessibleProjectsForUsers(userIds, resetKey);

  const users = useMemo(
    () =>
      baseRows.map((u) => ({
        ...u,
        accessibleProjects: projectsByUser[u.id],
      })) as ExtendedUser[],
    [baseRows, projectsByUser]
  );

  const columns = useUserColumns(tCommon);

  if (status === "loading") return null;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  if (session && session.user.access !== "NONE") {
    return (
      <main>
        <Card id="usersPage">
          <CardHeader className="w-full">
            <div>
              <div>
                <CardTitle>{tCommon("fields.users")}</CardTitle>
              </div>
              <div></div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row items-start justify-between gap-4">
              <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
                <Filter
                  key="user-filter"
                  placeholder={t("filter")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="mt-4">
                  <ColumnSelection
                    key="user-column-selection"
                    storageKey="users-directory"
                    columns={columns}
                    onVisibilityChange={setColumnVisibility}
                  />
                </div>
              </div>

              {users.length > 0 && (
                <p className="text-sm text-muted-foreground shrink-0">
                  {tGlobal("admin.auditLogs.showing", {
                    loaded: users.length.toLocaleString(),
                    total: (totalCount ?? users.length).toLocaleString(),
                  })}
                </p>
              )}
            </div>
            <div id="users-list" className="mt-4 w-full">
              <VirtualizedDataTable
                columns={columns as any}
                data={users as any}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoading || isFetchingNextPage}
                hasMore={!!hasNextPage}
                onLoadMore={fetchNextPage}
                fillViewport
                resetKey={resetKey}
                testIdPrefix="users-directory-table"
                rowTestIdPrefix="users-directory-row"
              />
            </div>
          </CardContent>
        </Card>
      </main>
    );
  } else {
    router.push("/404");
    return null;
  }
}
