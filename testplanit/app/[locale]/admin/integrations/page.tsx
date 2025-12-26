"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";
import { Integration } from "@prisma/client";
import {
  useFindManyIntegration,
  useDeleteIntegration,
} from "@/lib/hooks/integration";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedIntegration, getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, CirclePlus, Plug } from "lucide-react";
import { IntegrationModal } from "@/components/admin/integrations/IntegrationModal";

type PageSizeOption = number | "All";

export default function IntegrationsPage() {
  return (
    <PaginationProvider>
      <IntegrationList />
    </PaginationProvider>
  );
}

function IntegrationList() {
  const t = useTranslations("admin.integrations");
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
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [integrationToDelete, setIntegrationToDelete] =
    useState<Integration | null>(null);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  // Query for total filtered integrations (for pagination)
  const { data: totalFilteredIntegrations, isLoading: isTotalLoading } =
    useFindManyIntegration(
      {
        orderBy: sortConfig
          ? { [sortConfig.column]: sortConfig.direction }
          : { name: "asc" },
        include: {
          projectIntegrations: {
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
  } = useFindManyIntegration(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        projectIntegrations: {
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

  const { mutate: deleteIntegration } = useDeleteIntegration();

  const handleAddIntegration = useCallback(() => {
    setSelectedIntegration(null);
    setModalOpen(true);
  }, []);

  const handleEditIntegration = useCallback((integration: Integration) => {
    setSelectedIntegration(integration);
    setModalOpen(true);
  }, []);

  const handleDeleteClick = useCallback((integration: Integration) => {
    setIntegrationToDelete(integration);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!integrationToDelete) return;

    deleteIntegration(
      { where: { id: integrationToDelete.id } },
      {
        onSuccess: () => {
          toast.success(tGlobal("admin.integrations.deleteSuccess"), {
            description: tGlobal("admin.integrations.deleteSuccessDescription"),
          });
          refetch();
        },
        onError: (error) => {
          toast.error(t("errors.deleteFailed"), {
            description: error.message,
          });
        },
      }
    );
    setDeleteDialogOpen(false);
    setIntegrationToDelete(null);
  }, [integrationToDelete, deleteIntegration, t, tGlobal, refetch]);

  const handleTestConnection = useCallback(
    async (integration: Integration) => {
      try {
        const toastId = toast.loading("Testing Connection");

        const response = await fetch("/api/integrations/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            integrationId: integration.id,
          }),
        });

        const data = await response.json();

        if (data.success) {
          toast.success(t("testSuccess"), {
            id: toastId,
            description: t("testSuccessDescription"),
          });
          refetch();
        } else {
          toast.error(t("testFailed"), {
            id: toastId,
            description: data.error || t("testFailedDescription"),
          });
        }
      } catch (error) {
        console.error("Test connection error:", error);
        toast.error(t("testError"), {
          description: t("testErrorDescription"),
        });
      }
    },
    [t, refetch]
  );

  const columns = useMemo(
    () =>
      getColumns(
        session,
        handleEditIntegration,
        handleDeleteClick,
        handleTestConnection,
        tCommon,
        t
      ),
    [
      session,
      handleEditIntegration,
      handleDeleteClick,
      handleTestConnection,
      tCommon,
      t,
    ]
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
              <CardTitle
                data-testid="integrations-admin-page-title"
                className="items-center flex"
              >
                <Plug className="inline mr-2 h-8 w-8" />
                {tGlobal("admin.menu.integrations")}
              </CardTitle>
              <CardDescription data-testid="integrations-admin-page-description">
                {t("description")}
              </CardDescription>
            </div>
            <Button onClick={handleAddIntegration}>
              <CirclePlus className="h-4 w-4" />
              <span className="hidden md:inline">{tCommon("actions.add")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="integration-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="integration-column-selection"
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
                      key="integration-pagination-info"
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
            <DataTable<ExtendedIntegration, unknown>
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

      {modalOpen && (
        <IntegrationModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setSelectedIntegration(null);
          }}
          integration={selectedIntegration}
          onSuccess={() => {
            refetch();
            setModalOpen(false);
            setSelectedIntegration(null);
          }}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              {tGlobal("admin.integrations.deleteIntegration")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                {t("delete.confirmMessage", {
                  name: integrationToDelete?.name || tCommon("labels.unknown"),
                })}
              </p>
              <div className="mt-3 space-y-2 text-sm">
                <p className="font-medium text-foreground">
                  {t("delete.warningTitle")}
                </p>
                <ul className="list-disc pl-5 space-y-1 text-destructive">
                  <li>{t("delete.warning1")}</li>
                  <li>{t("delete.warning2")}</li>
                  <li>{t("delete.warning3")}</li>
                  <li>{t("delete.warning4")}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
