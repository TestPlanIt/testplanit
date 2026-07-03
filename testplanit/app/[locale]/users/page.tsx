"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { ExtendedUser, useUserColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function UserList() {
  return <Users />;
}

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

  // Single full-set fetch feeds the virtualized table directly; the table
  // renders only the visible window, so there's no page seam and no separate
  // count query (the loaded array length IS the total).
  const { data, isLoading } = useClientQueries(schema).user.useFindMany(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        role: true,
        groups: true,
        projects: true,
      },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          { isActive: true },
          { isDeleted: false },
        ],
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: false,
    }
  );

  const users = useMemo(() => (data ?? []) as ExtendedUser[], [data]);

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
                    total: users.length.toLocaleString(),
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
                isLoading={isLoading}
                fillViewport
                resetKey={`${debouncedSearchString}|${sortConfig?.column}|${sortConfig?.direction}`}
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
