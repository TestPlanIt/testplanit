"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";
import { useFindManyAppConfig } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AddAppConfigModal } from "./AddAppConfig";
import { AppConfigRow } from "./types";

type PageSizeOption = number | "All";

export default function AppConfigsPage() {
  return (
    <PaginationProvider>
      <AppConfigs />
    </PaginationProvider>
  );
}

function AppConfigs() {
  const t = useTranslations("admin.appConfig");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
  } = usePagination();
  const [searchString, setSearchString] = useState("");
  const [valueSearchString, setValueSearchString] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "key",
    direction: "asc",
  });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const debouncedSearchString = useDebounce(searchString, 300);
  const debouncedValueSearchString = useDebounce(valueSearchString, 300);

  const { data: appConfigs, isLoading } = useFindManyAppConfig({
    where: {
      key: {
        contains: debouncedSearchString,
        mode: "insensitive",
      },
    },
    orderBy: {
      [sortConfig.column]: sortConfig.direction,
    },
    skip: (currentPage - 1) * (typeof pageSize === "number" ? pageSize : 0),
    take: typeof pageSize === "number" ? pageSize : undefined,
  });

  // Transform AppConfig to AppConfigRow and filter by value
  const tableData: AppConfigRow[] = useMemo(() => {
    let filteredConfigs = appConfigs || [];

    // Filter by value if value search string exists
    if (debouncedValueSearchString) {
      filteredConfigs = filteredConfigs.filter((config) => {
        const valueString =
          typeof config.value === "object"
            ? JSON.stringify(config.value)
            : String(config.value);
        return valueString
          .toLowerCase()
          .includes(debouncedValueSearchString.toLowerCase());
      });
    }

    return filteredConfigs.map((config) => ({
      ...config,
      id: config.key, // Use key as id since it's unique
      name: config.key, // Use key as name to satisfy DataRow
    }));
  }, [appConfigs, debouncedValueSearchString]);

  const totalPages = Math.ceil(
    totalItems / (typeof pageSize === "number" ? pageSize : totalItems)
  );
  const startIndex =
    (currentPage - 1) * (typeof pageSize === "number" ? pageSize : 0) + 1;
  const endIndex = Math.min(
    startIndex + (typeof pageSize === "number" ? pageSize : totalItems) - 1,
    totalItems
  );

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

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1);
  };

  const columns = useMemo(() => getColumns(tCommon), [tCommon]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
          <CardTitle data-testid="app-config-title">{tGlobal("admin.menu.appConfig")}</CardTitle>
          <AddAppConfigModal />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-row items-start">
          <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px] space-y-2">
            <div className="text-muted-foreground w-full text-nowrap">
              <Filter
                key="app-config-filter"
                placeholder={t("filterPlaceholder")}
                initialSearchString={searchString}
                onSearchChange={setSearchString}
                dataTestId="app-config-filter-input"
              />
            </div>
            <div className="text-muted-foreground w-full text-nowrap">
              <Filter
                key="app-config-value-filter"
                placeholder="Filter by value..."
                initialSearchString={valueSearchString}
                onSearchChange={setValueSearchString}
                dataTestId="app-config-value-filter-input"
              />
            </div>
          </div>

          <div className="flex flex-col w-full sm:w-2/3 items-end">
            {totalItems > 0 && (
              <>
                <div className="justify-end">
                  <PaginationInfo
                    key="app-config-pagination-info"
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
          <DataTable<AppConfigRow, unknown>
            columns={columns}
            data={tableData}
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
  );
}
