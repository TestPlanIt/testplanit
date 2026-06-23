"use client";

import { useSession } from "next-auth/react";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { CustomColumnDef } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedGroups, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
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
  return (
    <PaginationProvider>
      <GroupList />
    </PaginationProvider>
  );
}

function GroupList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.groups");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
    startIndex,
    endIndex,
    totalPages,
  } = usePagination();
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

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { data: totalFilteredGroups } = useClientQueries(schema).groups.useFindMany(
    {
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
    },
    {
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredGroups) {
      setTotalItems(totalFilteredGroups.length);
    }
  }, [totalFilteredGroups, setTotalItems]);

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
      take: effectivePageSize,
      skip: skip,
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

  const groups = data as ExtendedGroups[];

  const pageSizeOptions = usePageSizeOptions(totalItems);

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

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
    setCurrentPage(1);
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
                  <CirclePlus className="w-4 mr-1" />
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
            <div className="flex flex-row items-start">
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

              <div className="flex flex-col w-full sm:w-2/3 items-end">
                {totalItems > 0 && (
                  <>
                    <div className="justify-end">
                      <PaginationInfo
                        key="group-pagination-info"
                        startIndex={startIndex}
                        endIndex={endIndex}
                        totalRows={totalItems}
                        searchString={searchString}
                        pageSize={
                          typeof pageSize === "number" ? pageSize : "All"
                        }
                        pageSizeOptions={pageSizeOptions}
                        handlePageSizeChange={(size) => setPageSize(size)}
                      />
                    </div>
                    <div className="justify-end -mx-4">
                      <PaginationComponent
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <DataTable<ExtendedGroups, unknown>
                columns={columns}
                data={groups || []}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                isLoading={isLoading}
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
