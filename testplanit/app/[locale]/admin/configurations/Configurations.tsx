import { useState, useEffect, useMemo, useCallback } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import { usePagination } from "~/lib/contexts/PaginationContext";
import {
  useFindManyConfigurations,
  useUpdateConfigurations,
} from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns, ConfigWithVariants } from "./configColumns";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import AddConfigurationWizard from "./AddConfigurationWizard";
import { CustomColumnMeta } from "@/components/tables/ColumnSelection";

type PageSizeOption = number | "All";

export default function ConfigurationList(): React.ReactElement {
  return <Configurations />;
}

function Configurations(): React.ReactElement | null {
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const router = useRouter();
  const t = useTranslations("admin.configurations");
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
  const [selectedPage, setSelectedPage] = useState<string | undefined>(
    undefined
  );
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  // Fetch ALL configurations (no pagination, no search filter in query)
  const { data: allConfigurations, isLoading } = useFindManyConfigurations(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      where: {
        isDeleted: false,
      },
      include: { variants: { include: { variant: true } } },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  // Filter configurations client-side based on search string
  const filteredConfigurations = useMemo(() => {
    if (!allConfigurations) return [];

    if (!debouncedSearchString.trim()) {
      return allConfigurations;
    }

    const searchLower = debouncedSearchString.trim().toLowerCase();
    return allConfigurations.filter((config) =>
      config.name.toLowerCase().includes(searchLower)
    );
  }, [allConfigurations, debouncedSearchString]);

  // Update total items based on filtered configurations count
  useEffect(() => {
    setTotalItems(filteredConfigurations.length);
  }, [filteredConfigurations, setTotalItems]);

  // Apply client-side pagination
  const configurations = useMemo(() => {
    return filteredConfigurations.slice(skip, skip + effectivePageSize);
  }, [filteredConfigurations, skip, effectivePageSize]);

  const { mutate: updateConfiguration } = useUpdateConfigurations();

  const handleToggle = useCallback(
    (id: number, isEnabled: boolean) => {
      updateConfiguration({
        where: { id },
        data: { isEnabled },
      });
    },
    [updateConfiguration]
  );

  const columns = useMemo(
    () => getColumns(tCommon, handleToggle),
    [tCommon, handleToggle]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] =
        (column.meta as CustomColumnMeta)?.isVisible ?? true;
    });
    return initialVisibility;
  });

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

  if (isAuthLoading) {
    return null;
  }

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

  if (isAuthenticated && session?.user.access === "ADMIN") {
    return (
      <main>
        <Card>
          <CardHeader className="w-full">
            <div className="flex items-center justify-between text-primary">
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <CardTitle>{tGlobal("common.fields.configurations")}</CardTitle>
              </div>
              <div>
                <AddConfigurationWizard />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-row items-start">
              <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
                <div className="text-muted-foreground w-full text-nowrap">
                  <Filter
                    key="configuration-filter"
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
                        key="configuration-pagination-info"
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
              <DataTable<ConfigWithVariants, unknown>
                columns={columns}
                data={configurations || []}
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
