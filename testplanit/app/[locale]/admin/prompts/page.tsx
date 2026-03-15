"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaginationProvider, usePagination
} from "~/lib/contexts/PaginationContext";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus, MessageSquareCode } from "lucide-react";
import { toast } from "sonner";
import {
  useFindManyPromptConfig,
  useUpdatePromptConfig
} from "~/lib/hooks/prompt-config";
import { AddPromptConfig } from "./AddPromptConfig";
import { ExtendedPromptConfig, getColumns } from "./columns";

type PageSizeOption = number | "All";

export default function PromptsAdminPage() {
  return (
    <PaginationProvider>
      <PromptConfigList />
    </PaginationProvider>
  );
}

function PromptConfigList() {
  const t = useTranslations("admin.prompts");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
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
  const [showAddDialog, setShowAddDialog] = useState(false);

  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { mutateAsync: updatePromptConfig } = useUpdatePromptConfig();

  const updatePromptConfigRef = useRef(updatePromptConfig);
  updatePromptConfigRef.current = updatePromptConfig;

  // Query for total filtered configs (for pagination)
  const { data: totalFilteredConfigs } = useFindManyPromptConfig(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        prompts: true,
      },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive" as const,
            },
          },
          { isDeleted: false },
        ],
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  useEffect(() => {
    if (totalFilteredConfigs) {
      setTotalItems(totalFilteredConfigs.length);
    }
  }, [totalFilteredConfigs, setTotalItems]);

  // Paginated query
  const {
    data: configs,
    isLoading,
    refetch,
  } = useFindManyPromptConfig(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        prompts: true,
        projects: true,
      },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive" as const,
            },
          },
          { isDeleted: false },
        ],
      },
      take: effectivePageSize,
      skip: skip,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  const handleToggleDefault = useCallback(
    async (id: string, currentIsDefault: boolean) => {
      if (currentIsDefault) return; // Can't un-default the current default

      try {
        // Find and unset current default
        const currentDefaults = configs?.filter((c) => c.isDefault) || [];
        for (const config of currentDefaults) {
          if (config.id !== id) {
            await updatePromptConfigRef.current({
              where: { id: config.id },
              data: { isDefault: false },
            });
          }
        }

        // Set new default (force active)
        await updatePromptConfigRef.current({
          where: { id },
          data: { isDefault: true, isActive: true },
        });

        toast.success(t("defaultChanged"));
      } catch (error) {
        console.error("Failed to update default:", error);
        toast.error(tGlobal("common.errors.error"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configs]
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

  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns = useMemo(
    () => getColumns(userPreferences, handleToggleDefault, tCommon, t),
    [userPreferences, handleToggleDefault, tCommon, t]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (status === "loading") return null;

  if (!session || session.user.access !== "ADMIN") {
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
    setCurrentPage(1);
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="prompts-admin-page-title">
                <MessageSquareCode className="inline mr-2 h-8 w-8" />
                {t("title")}
              </CardTitle>
            </div>
            <div>
              <Button onClick={() => setShowAddDialog(true)}>
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">
                  {t("addPromptConfig")}
                </span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="prompts-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="prompts-column-selection"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="prompts-pagination-info"
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
            <DataTable<ExtendedPromptConfig, unknown>
              columns={columns}
              data={(configs as ExtendedPromptConfig[]) || []}
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

      {showAddDialog && (
        <AddPromptConfig
          open={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          onSuccess={() => {
            setShowAddDialog(false);
            refetch();
          }}
        />
      )}
    </main>
  );
}
