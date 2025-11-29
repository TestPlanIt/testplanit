"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import { useFindManyGroups } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedGroups, getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { CustomColumnDef } from "@/components/tables/ColumnSelection";

import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { AddGroupModal } from "./AddGroup";

type PageSizeOption = number | "All";

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
  const [selectedPage, setSelectedPage] = useState<string | undefined>(
    undefined
  );
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { data: totalFilteredGroups } = useFindManyGroups(
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

  const { data, isLoading } = useFindManyGroups(
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

  const pageSizeOptions: PageSizeOption[] = useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);

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

  const columns: CustomColumnDef<ExtendedGroups>[] = useMemo(
    () => getColumns(tCommon),
    [tCommon]
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
                <CardTitle>{t("title")}</CardTitle>
              </div>
              <div>
                <AddGroupModal />
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
      </main>
    );
  }
  return null;
}
