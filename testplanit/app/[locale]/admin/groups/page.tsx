"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { ExtendedGroups, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import { AddGroup } from "./AddGroup";
import { DeleteGroup } from "./DeleteGroup";
import { EditGroup } from "./EditGroup";

export default function GroupListPage() {
  return <GroupList />;
}

function GroupList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.groups");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ExtendedGroups | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<ExtendedGroups | null>(
    null
  );

  // Single full-set fetch feeds the virtualized table directly; the table
  // renders only the visible window, so there's no page seam and no separate
  // count query (the loaded array length IS the total).
  const { data, isLoading } = useClientQueries(schema).groups.useFindMany(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          {
            isDeleted: false,
          },
        ],
      },
      include: {
        assignedUsers: {
          where: {
            user: {
              isDeleted: false,
              isActive: true,
            },
          },
        },
        projectPermissions: {
          select: {
            projectId: true,
          },
          where: {
            project: {
              isDeleted: false,
            },
          },
        },
      },
    },
    {
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  const groups = useMemo(() => (data ?? []) as ExtendedGroups[], [data]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  const columns: CustomColumnDef<ExtendedGroups>[] = useColumns(
    tCommon,
    t,
    setEditingGroup,
    setDeletingGroup
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] = column.meta?.isVisible ?? true;
    });
    return initialVisibility;
  });

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <main>
        <Card>
          <CardHeader className="w-full">
            <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
              <div>
                <CardTitle>{tGlobal("common.fields.groups")}</CardTitle>
              </div>
              <div>
                <Button onClick={() => setAddGroupOpen(true)}>
                  <CirclePlus className="w-4 me-1" />
                  <span className="hidden md:inline">{t("add.button")}</span>
                  <span className="md:hidden">{tCommon("add")}</span>
                </Button>
                {addGroupOpen && (
                  <AddGroup
                    open={addGroupOpen}
                    onClose={() => setAddGroupOpen(false)}
                  />
                )}
              </div>
            </div>
            <CardDescription>{t("description.groupInfo")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row items-start justify-between gap-4">
              <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
                <div className="text-muted-foreground w-full text-nowrap">
                  <Filter
                    key="group-filter"
                    placeholder={t("filterPlaceholder")}
                    initialSearchString={searchString}
                    onSearchChange={setSearchString}
                  />
                </div>
              </div>

              {groups.length > 0 && (
                <p className="text-sm text-muted-foreground shrink-0">
                  {tGlobal("admin.auditLogs.showing", {
                    loaded: groups.length.toLocaleString(),
                    total: groups.length.toLocaleString(),
                  })}
                </p>
              )}
            </div>
            <div className="mt-4 w-full">
              <VirtualizedDataTable
                fillViewport
                columns={columns as any}
                data={groups}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoading}
                resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
                testIdPrefix="admin-groups-table"
                rowTestIdPrefix="admin-group-row"
              />
            </div>
          </CardContent>
        </Card>
        {editingGroup && (
          <EditGroup
            group={editingGroup}
            open={true}
            onClose={() => setEditingGroup(null)}
          />
        )}
        {deletingGroup && (
          <DeleteGroup
            group={deletingGroup}
            open={true}
            onClose={() => setDeletingGroup(null)}
          />
        )}
      </main>
    );
  }
  return null;
}
