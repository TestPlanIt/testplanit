"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaginationProvider, usePagination
} from "~/lib/contexts/PaginationContext";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import {
  useFindManyRoles, useUpdateManyRoles, useUpdateRoles
} from "~/lib/hooks";
import { ExtendedRoles, getColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  Card, CardContent,
  CardDescription, CardHeader,
  CardTitle
} from "@/components/ui/card";
import { AddRoleModal } from "./AddRoles";

type PageSizeOption = number | "All";

export default function RoleListPage() {
  return (
    <PaginationProvider>
      <RoleList />
    </PaginationProvider>
  );
}

function RoleList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.roles");
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

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { data: totalFilteredRoles, isLoading: isTotalLoading } =
    useFindManyRoles(
      {
        orderBy: sortConfig
          ? { [sortConfig.column]: sortConfig.direction }
          : { name: "asc" },
        include: {
          users: true,
        },
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
    if (totalFilteredRoles) {
      setTotalItems(totalFilteredRoles.length);
    }
  }, [totalFilteredRoles, setTotalItems]);

  const { data: roles, isLoading } = useFindManyRoles(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        users: {
          where: {
            isDeleted: false,
            isActive: true,
          },
        },
      },
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
    },
    {
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  const rolesData = roles as ExtendedRoles[];

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

  const { mutateAsync: updateRole } = useUpdateRoles();
  const { mutateAsync: updateManyRoles } = useUpdateManyRoles();

  // Stabilize mutation refs — ZenStack's mutateAsync changes identity every render
  const updateRoleRef = useRef(updateRole);
  const updateManyRolesRef = useRef(updateManyRoles);
  // eslint-disable-next-line react-hooks/refs
  updateRoleRef.current = updateRole;
  // eslint-disable-next-line react-hooks/refs
  updateManyRolesRef.current = updateManyRoles;

  const handleToggleDefault = useCallback(
    async (id: number, isDefault: boolean) => {
      try {
        if (isDefault) {
          await updateManyRolesRef.current({
            where: { isDefault: true },
            data: { isDefault: false },
          });
          await updateRoleRef.current({
            where: { id },
            data: { isDefault: true },
          });
        }
      } catch (error) {
        console.error("Failed to update role:", error);
      }
    },
    []
  );

  const columns = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => getColumns(handleToggleDefault, tCommon),
    [handleToggleDefault, tCommon]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

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

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle>{tGlobal("common.labels.roles")}</CardTitle>
            </div>
            <div>
              <AddRoleModal />
            </div>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="role-filter"
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
                      key="role-pagination-info"
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalItems}
                      searchString={searchString}
                      pageSize={typeof pageSize === "number" ? pageSize : "All"}
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
            <DataTable<ExtendedRoles, unknown>
              columns={columns}
              data={rolesData || []}
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
