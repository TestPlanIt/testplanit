"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import { useFindManyUser } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedUser, getColumns } from "./columns";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { useDebounce } from "@/components/Debounce";

import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type PageSizeOption = number | "All";

export default function UserList() {
  return (
    <PaginationProvider>
      <Users />
    </PaginationProvider>
  );
}

function Users() {
  const { data: session, status } = useSession();
  const t = useTranslations("users");
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
  // Calculate effective page size and skip
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;
  const debouncedSearchString = useDebounce(searchString, 500);

  const { data: totalFilteredUsers } = useFindManyUser(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
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
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredUsers) {
      setTotalItems(totalFilteredUsers.length);
    }
  }, [totalFilteredUsers, setTotalItems]);

  const { data, isLoading } = useFindManyUser(
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
      take: effectivePageSize,
      skip: skip,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: false,
    }
  );

  const users = data as ExtendedUser[];

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

  if (status === "loading") return null;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  const columns = getColumns(tCommon);

  if (session && session.user.access !== "NONE") {
    return (
      <main>
        <Card id="usersPage">
          <CardHeader className="w-full">
            <div>
              <div>
                <CardTitle>{t("title", { count: totalItems })}</CardTitle>
              </div>
              <div></div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row items-start">
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
                    columns={columns}
                    onVisibilityChange={setColumnVisibility}
                  />
                </div>
              </div>

              <div
                id="pagination"
                className="flex flex-col w-full sm:w-2/3 items-end"
              >
                {totalItems > 0 && (
                  <>
                    <div className="justify-end">
                      <PaginationInfo
                        key="user-pagination-info"
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
            <div id="users-list" className="mt-4 flex justify-between">
              <DataTable
                columns={columns as any}
                data={users as any}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoading}
                pageSize={effectivePageSize}
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
