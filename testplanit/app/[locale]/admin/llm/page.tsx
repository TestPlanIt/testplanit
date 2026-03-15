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
import { CirclePlus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  useFindManyLlmIntegration,
  useUpdateLlmIntegration
} from "~/lib/hooks/llm-integration";
import {
  useUpdateLlmProviderConfig,
  useUpdateManyLlmProviderConfig
} from "~/lib/hooks/llm-provider-config";
import { useGroupByLlmUsage } from "~/lib/hooks/llm-usage";
import { AddLlmIntegration } from "./AddLlmIntegration";
import { ExtendedLlmIntegration, getColumns } from "./columns";

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
  const [refreshing, setRefreshing] = useState(false);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { mutateAsync: updateLlmIntegration } = useUpdateLlmIntegration();
  const { mutateAsync: updateLlmProviderConfig } = useUpdateLlmProviderConfig();
  const { mutateAsync: updateManyLlmProviderConfig } =
    useUpdateManyLlmProviderConfig();

  // Stabilize mutation refs — ZenStack's mutateAsync changes identity every render
  const updateLlmIntegrationRef = useRef(updateLlmIntegration);
  updateLlmIntegrationRef.current = updateLlmIntegration;
  const updateLlmProviderConfigRef = useRef(updateLlmProviderConfig);
  updateLlmProviderConfigRef.current = updateLlmProviderConfig;
  const updateManyLlmProviderConfigRef = useRef(updateManyLlmProviderConfig);
  updateManyLlmProviderConfigRef.current = updateManyLlmProviderConfig;

  const handleToggle = useCallback(
    async (
      id: number,
      key: string,
      value: boolean,
      llmProviderConfigId?: number
    ) => {
      try {
        if (key === "isDefault" && llmProviderConfigId && value) {
          await updateManyLlmProviderConfigRef.current({
            where: { isDefault: true },
            data: { isDefault: false },
          });
          await updateLlmProviderConfigRef.current({
            where: { id: llmProviderConfigId },
            data: { isDefault: true },
          });
        } else if (
          (key === "streamingEnabled" || key === "isDefault") &&
          llmProviderConfigId
        ) {
          await updateLlmProviderConfigRef.current({
            where: { id: llmProviderConfigId },
            data: { [key]: value },
          });
        } else {
          await updateLlmIntegrationRef.current({
            where: { id },
            data: { [key]: value },
          });
        }
      } catch (error) {
        console.error(`Failed to update ${key} for Integration ${id}`, error);
      }
    },
    []
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

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  // Fetch current-month cost per integration for the Budget Usage column
  const startOfMonth = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }, []);

  const { data: monthlyUsageGroups } = useGroupByLlmUsage(
    {
      by: ["llmIntegrationId"],
      _sum: { totalCost: true },
      where: {
        createdAt: { gte: startOfMonth },
        llmIntegrationId: { not: null },
      },
    },
    { enabled: !!session?.user, refetchInterval: 10_000 }
  );

  const usageByIntegrationIdRef = useRef(new Map<number, number>());
  useMemo(() => {
    const map = new Map<number, number>();
    for (const row of monthlyUsageGroups ?? []) {
      if (row.llmIntegrationId != null) {
        map.set(row.llmIntegrationId, Number(row._sum?.totalCost ?? 0));
      }
    }
    usageByIntegrationIdRef.current = map;
  }, [monthlyUsageGroups]);

  const columns = useMemo(
    () =>
      getColumns(
        userPreferences,
        handleToggle,
        tCommon,
        t,
        usageByIntegrationIdRef,
        integrations?.length ?? 0
      ),
    [userPreferences, handleToggle, tCommon, t, integrations?.length]
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
      toast.error(tGlobal("common.errors.error"), {
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
                {tGlobal("admin.menu.llm")}
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
                        className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
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
