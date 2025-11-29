"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import {
  useFindManyLlmIntegration,
  useUpdateLlmIntegration,
} from "~/lib/hooks/llm-integration";
import { useUpdateLlmProviderConfig } from "~/lib/hooks/llm-provider-config";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedLlmIntegration, getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AddLlmIntegration } from "./AddLlmIntegration";
import { Button } from "@/components/ui/button";
import { CirclePlus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

type PageSizeOption = number | "All";

export default function LlmAdminPage() {
  return (
    <PaginationProvider>
      <LlmIntegrationList />
    </PaginationProvider>
  );
}

function LlmIntegrationList() {
  const t = useTranslations("admin.llm");
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
  const [refreshing, setRefreshing] = useState(false);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { mutateAsync: updateLlmIntegration } = useUpdateLlmIntegration();
  const { mutateAsync: updateLlmProviderConfig } = useUpdateLlmProviderConfig();

  const handleToggle = useCallback(
    async (
      id: number,
      key: string,
      value: boolean,
      llmProviderConfigId?: number
    ) => {
      try {
        if (key === "streamingEnabled" && llmProviderConfigId) {
          await updateLlmProviderConfig({
            where: { id: llmProviderConfigId },
            data: { streamingEnabled: value },
          });
        } else {
          await updateLlmIntegration({
            where: { id },
            data: { [key]: value },
          });
        }
      } catch (error) {
        console.error(`Failed to update ${key} for Integration ${id}`, error);
      }
    },
    [updateLlmIntegration, updateLlmProviderConfig]
  );

  // Query for total filtered integrations (for pagination)
  const { data: totalFilteredIntegrations, isLoading: isTotalLoading } =
    useFindManyLlmIntegration(
      {
        orderBy: sortConfig
          ? { [sortConfig.column]: sortConfig.direction }
          : { name: "asc" },
        include: {
          llmProviderConfig: true,
          projectLlmIntegrations: {
            where: {
              isActive: true,
              project: {
                isDeleted: false,
              },
            },
            select: { projectId: true },
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
      },
      {
        enabled: !!session?.user,
        refetchOnWindowFocus: true,
      }
    );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredIntegrations) {
      setTotalItems(totalFilteredIntegrations.length);
    }
  }, [totalFilteredIntegrations, setTotalItems]);

  // Query for paginated integrations
  const {
    data: integrations,
    isLoading,
    refetch,
  } = useFindManyLlmIntegration(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        llmProviderConfig: true,
        projectLlmIntegrations: {
          where: { isActive: true, project: { isDeleted: false } },
          select: { projectId: true },
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
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
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

  const columns = useMemo(
    () => getColumns(session, handleToggle, tCommon, t),
    [session, handleToggle, tCommon, t]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const testConnections = async () => {
    setRefreshing(true);
    try {
      const promises = (integrations || []).map(async (integration) => {
        const response = await fetch(
          `/api/admin/llm/integrations/${integration.id}/test`,
          {
            method: "POST",
          }
        );
        const data = await response.json();
        return { id: integration.id, isConnected: data.success };
      });

      const results = await Promise.all(promises);

      // Update connection status in memory (would need to be persisted in real app)
      const updatedIntegrations = (integrations || []).map((integration) => {
        const result = results.find((r) => r.id === integration.id);
        return result
          ? { ...integration, isConnected: result.isConnected }
          : integration;
      });

      toast.success(t("connectionTestComplete"), {
        description: t("allIntegrationsTested"),
      });

      // Refetch to update UI
      refetch();
    } catch (error) {
      console.error("Error testing connections:", error);
      toast.error(t("error"), {
        description: t("failedToTestConnections"),
      });
    } finally {
      setRefreshing(false);
    }
  };

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
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="llm-admin-page-title">
                <Sparkles className="inline mr-2 h-8 w-8" />
                {t("title")}
              </CardTitle>
            </div>
            <div>
              <Button onClick={() => setShowAddDialog(true)}>
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">{t("addIntegration")}</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="llm-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="llm-column-selection"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testConnections}
                      disabled={refreshing || (integrations?.length || 0) === 0}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
                      />
                      {t("testAll")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="llm-pagination-info"
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
            <DataTable<ExtendedLlmIntegration, unknown>
              columns={columns}
              data={integrations || []}
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
        <AddLlmIntegration
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
