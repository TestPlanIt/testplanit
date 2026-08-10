"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { IntegrationModal } from "@/components/admin/integrations/IntegrationModal";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
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
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Integration } from "~/zenstack/models";
import { CirclePlus, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import { useColumns } from "./columns";

export default function IntegrationsPage() {
  return <IntegrationList />;
}

function IntegrationList() {
  const locale = useLocale();
  const t = useTranslations("admin.integrations");
  const tCommon = useTranslations("common");
  const tApiTokens = useTranslations("admin.apiTokens");
  const tAdminMenu = useTranslations("admin.menu");
  const tGlobal = useTranslations();
  const { data: session, status } = useSession();
  const router = useRouter();
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

  // Single full-set fetch feeds the virtualized table directly; the table
  // renders only the visible window, so there's no page seam and no separate
  // count query (the loaded array length IS the total).
  const {
    data: integrations,
    isLoading,
    refetch,
  } = useClientQueries(schema).integration.useFindMany(
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

  const integrationRows = useMemo(() => integrations ?? [], [integrations]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const { mutate: deleteIntegration } =
    useClientQueries(schema).integration.useDelete();

  // Stabilize mutation ref — ZenStack's mutate changes identity every render
  const deleteIntegrationRef = useRef(deleteIntegration);
  useEffect(() => {
    deleteIntegrationRef.current = deleteIntegration;
  });

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

    deleteIntegrationRef.current(
      { where: { id: integrationToDelete.id } },
      {
        onSuccess: () => {
          toast.success(t("deleteSuccess"), {
            description: t("deleteSuccessDescription"),
          });
          void refetch();
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
  }, [integrationToDelete, t, refetch]);

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
          void refetch();
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

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns = useColumns(
    userPreferences,
    handleEditIntegration,
    handleDeleteClick,
    handleTestConnection,
    tCommon,
    t,
    tApiTokens
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
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="integrations-admin-page-title">
                {tAdminMenu("integrations")}
              </CardTitle>
              <HelpPopover helpKey="integrations" />
            </SectionHeader>
            <Button
              onClick={handleAddIntegration}
              aria-label={tCommon("add")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {tCommon("add")}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
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
                      storageKey="admin-integrations"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                </div>
              </div>
            </div>

            {integrationRows.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: integrationRows.length.toLocaleString(locale),
                  total: integrationRows.length.toLocaleString(locale),
                })}
              </p>
            )}
          </div>

          <div className="mt-4 w-full">
            <DataTable
              virtualized
              fillViewport
              columns={columns as any}
              data={integrationRows}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-integrations-table"
              rowTestIdPrefix="admin-integration-row"
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
            void refetch();
            setModalOpen(false);
            setSelectedIntegration(null);
          }}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-md border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              {t("deleteIntegration")}
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
                <ul className="list-disc ps-5 space-y-1 text-destructive">
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
